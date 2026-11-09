"""Use the installed native Hermes service with disposable homes, never live profiles."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_constants import reset_hermes_home_override, set_hermes_home_override

from hermes_projects.api import router


@pytest.fixture
def client(tmp_path):
    token = set_hermes_home_override(tmp_path / "home")
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client
    reset_hermes_home_override(token)


def create(client, tmp_path, **extra):
    return client.post(
        "/projects", json={"name": "Research", "primary_path": str(tmp_path), **extra}
    )


def test_crud_native_and_archive(client, tmp_path):
    from hermes_cli import projects_db as native

    result = create(client, tmp_path)
    assert result.status_code == 201, result.text
    project = result.json()["project"]
    pid = project["id"]
    assert pid.startswith("p_")
    assert project["primary_path"] == str(tmp_path.resolve())
    with native.connect_closing() as conn:
        assert native.get_project(conn, pid).name == "Research"
        assert native.get_active_id(conn) is None
    assert (
        client.patch(
            f"/projects/{pid}", json={"name": "Renamed", "description": "Notes"}
        ).status_code
        == 200
    )
    assert client.get(f"/projects/{pid}").json()["project"]["description"] == "Notes"
    assert client.post(f"/projects/{pid}/archive").json()["project"]["archived"]
    assert len(client.get("/projects").json()["projects"]) == 1
    assert not client.post(f"/projects/{pid}/archive?restore=true").json()["project"]["archived"]
    assert client.delete(f"/projects/{pid}").status_code == 200
    assert client.get(f"/projects/{pid}").status_code == 404
    assert client.get("/projects").json()["projects"] == []


def test_workspace_folder_operations(client, tmp_path):
    pid = create(client, tmp_path).json()["project"]["id"]
    folder = tmp_path / "other"
    folder.mkdir()
    url = f"/projects/{pid}/folders"
    assert client.post(url, json={"action": "add", "path": str(folder)}).status_code == 200
    assert client.post(url, json={"action": "primary", "path": str(folder)}).json()["project"][
        "primary_path"
    ] == str(folder)
    folder.rmdir()
    assert client.post(url, json={"action": "remove", "path": str(folder)}).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"name": " "},
        {"primary_path": "/path-that-does-not-exist-projects"},
        {"primary_path": "relative"},
        {"profile": "victim"},
        {"project_id": "fake"},
    ],
)
def test_invalid_create_has_no_side_effect(client, tmp_path, body):
    assert create(client, tmp_path, **body).status_code == 422
    assert client.get("/projects").json()["projects"] == []


def test_native_duplicate_path_validation(client, tmp_path):
    assert create(client, tmp_path).status_code == 201
    assert create(client, tmp_path).status_code == 422
    assert len(client.get("/projects").json()["projects"]) == 1


def test_unknown_id_and_slug_rejected(client, tmp_path):
    project = create(client, tmp_path).json()["project"]
    for pid in ["missing", project["slug"]]:
        assert client.get(f"/projects/{pid}").status_code == 404
        assert client.patch(f"/projects/{pid}", json={"name": "bad"}).status_code == 404
        assert client.delete(f"/projects/{pid}").status_code == 404


def test_profile_scope_isolation(client, tmp_path):
    first = create(client, tmp_path).json()["project"]["id"]
    token = set_hermes_home_override(tmp_path / "second-home")
    try:
        assert client.get("/projects").json()["projects"] == []
        assert client.get(f"/projects/{first}").status_code == 404
        assert create(client, tmp_path).status_code == 201
    finally:
        reset_hermes_home_override(token)
    assert client.get("/projects").json()["projects"][0]["id"] == first


def test_handoff_refuses_duplicates_and_attachments_without_native_calls(
    client, tmp_path, monkeypatch
):
    import hermes_projects.api as api

    monkeypatch.setattr(api, "projects", lambda: pytest.fail("Handoff touched native state"))
    payload = {
        "request_id": "same",
        "text": "Do not execute",
        "attachments": [{"path": "/etc/passwd"}],
    }
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: client.post("/handoffs", json=payload), range(8)))
    assert all(r.status_code == 501 for r in responses)
    assert not list(Path(tmp_path).rglob("state.db"))
    assert not list(Path(tmp_path).rglob("projects.db"))
    assert client.get("/capabilities").json()["project_chat"] is True


def test_prepare_chat_validates_actual_native_overlap_and_state(client, tmp_path):
    parent = create(client, tmp_path).json()["project"]["id"]
    child = tmp_path / "nested"
    child.mkdir()
    nested = create(client, child, name="Nested").json()["project"]["id"]
    assert client.post(f"/projects/{parent}/prepare-chat", json={}).json()["cwd"] == str(tmp_path)
    assert (
        client.post(f"/projects/{parent}/prepare-chat", json={"cwd": str(child)}).status_code == 409
    )
    assert client.post(f"/projects/{nested}/prepare-chat", json={}).status_code == 200
    assert client.post("/projects/missing/prepare-chat", json={}).status_code == 404
    client.post(f"/projects/{nested}/archive")
    assert client.post(f"/projects/{nested}/prepare-chat", json={}).status_code == 409
    child.rmdir()
    client.post(f"/projects/{nested}/archive?restore=true")
    assert client.post(f"/projects/{nested}/prepare-chat", json={}).status_code == 422


def test_prepare_missing_folder_and_resolved_symlink(client, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(workspace, target_is_directory=True)
    pid = create(client, alias).json()["project"]["id"]
    assert client.post(f"/projects/{pid}/prepare-chat", json={}).json()["cwd"] == str(workspace)
    client.post(f"/projects/{pid}/folders", json={"action": "remove", "path": str(workspace)})
    assert client.post(f"/projects/{pid}/prepare-chat", json={}).status_code == 422


def test_native_match_includes_repository_root_and_deepest_folder(tmp_path, monkeypatch):
    from tui_gateway import git_probe

    from hermes_projects.compat import matching_project

    # A linked worktree's common root can be elsewhere on disk. Use the native
    # resolver with an exact probe result, rather than duplicating its algorithm.
    root = str(tmp_path / "repo")
    cwd = str(tmp_path / "worktree")
    monkeypatch.setattr(git_probe, "resolve", lambda _: {"repo_root": root})
    records = [
        {"id": "broad", "folders": [{"path": str(tmp_path)}]},
        {"id": "repository", "folders": [{"path": root}]},
    ]
    assert matching_project(records, cwd)["id"] == "repository"
    records.append({"id": "worktree", "folders": [{"path": cwd}]})
    # Equal-depth matches prefer cwd over repository root, as native tree does.
    assert matching_project(records, cwd)["id"] == "worktree"
