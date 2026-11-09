"""Native project CRUD. Authentication and profile authorization belong to Hermes's mount.

Do not expose this router as an unauthenticated standalone server.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .compat import matching_project, projects

router = APIRouter()
HANDOFF_REASON = (
    "Draft-first handoff is unsupported: the SDK omits composer submission identity. "
    "Use New Project Chat to persist an empty native session before composing. "
    "This endpoint did not create a session or message."
)


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Properties(StrictBody):
    description: str | None = Field(default=None, max_length=10000)
    icon: str | None = Field(default=None, max_length=100)
    color: str | None = Field(default=None, max_length=100)
    board_slug: str | None = Field(default=None, max_length=100)


class Metadata(Properties):
    name: str | None = Field(default=None, max_length=200)


class Create(Properties):
    name: str = Field(min_length=1, max_length=200)
    primary_path: str = Field(min_length=1, max_length=4096)


class Folder(StrictBody):
    path: str = Field(min_length=1, max_length=4096)
    action: Literal["add", "remove", "primary"]


def invoke(operation: Callable[..., Any]):
    try:
        with projects() as (native, conn):
            return operation(native, conn)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (ImportError, RuntimeError) as exc:
        raise HTTPException(503, "Native project services unavailable") from exc


def require(native, conn, project_id):
    project = native.get_project(conn, project_id)
    # Routes accept durable IDs only, never a slug which could resolve to a different record.
    if project is None or project.id != project_id:
        raise HTTPException(404, "Project not found in this profile")
    return project


def directory(value: str):
    path = Path(value).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise HTTPException(422, "Workspace must be an existing absolute directory on the host")
    return str(path.resolve())


@router.get("/capabilities")
def capabilities():
    return {"project_crud": True, "project_chat": True, "flow": "create-first"}


@router.get("/projects")
def list_projects():
    return invoke(
        lambda native, conn: {
            "projects": [p.to_dict() for p in native.list_projects(conn, include_archived=True)]
        }
    )


@router.post("/projects", status_code=201)
def create_project(body: Create):
    path = directory(body.primary_path)

    def create(native, conn):
        project_id = native.create_project(
            conn, **body.model_dump(exclude={"primary_path"}), primary_path=path
        )
        return {"project": require(native, conn, project_id).to_dict()}

    return invoke(create)


class PrepareChat(StrictBody):
    cwd: str | None = Field(default=None, max_length=4096)


@router.post("/projects/{project_id}/prepare-chat")
def prepare_chat(project_id: str, body: PrepareChat):
    """Read-only validation in the authenticated profile; creation stays SDK-routed."""

    def prepare(native, conn):
        project = require(native, conn, project_id)
        if project.archived:
            raise HTTPException(409, "Restore this project before creating a chat")
        cwd = directory(body.cwd or project.primary_path or "")
        records = [p.to_dict() for p in native.list_projects(conn)]
        owner = matching_project(records, cwd)
        if owner is None or owner["id"] != project_id:
            raise HTTPException(409, "Workspace belongs to a different native project")
        return {"project": project.to_dict(), "cwd": cwd}

    return invoke(prepare)


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    return invoke(lambda native, conn: {"project": require(native, conn, project_id).to_dict()})


@router.patch("/projects/{project_id}")
def update_project(project_id: str, body: Metadata):
    def update(native, conn):
        require(native, conn, project_id)
        native.update_project(conn, project_id, **body.model_dump(exclude_none=True))
        return {"project": require(native, conn, project_id).to_dict()}

    return invoke(update)


@router.post("/projects/{project_id}/folders")
def update_folder(project_id: str, body: Folder):
    # Removing a folder whose directory disappeared is valid; adding/selecting must resolve.
    path = body.path if body.action == "remove" else directory(body.path)

    def update(native, conn):
        require(native, conn, project_id)
        operation = {
            "add": native.add_folder,
            "remove": native.remove_folder,
            "primary": native.set_primary,
        }[body.action]
        operation(conn, project_id, path)
        return {"project": require(native, conn, project_id).to_dict()}

    return invoke(update)


@router.post("/projects/{project_id}/archive")
def archive(project_id: str, restore: bool = False):
    def update(native, conn):
        require(native, conn, project_id)
        (native.restore_project if restore else native.archive_project)(conn, project_id)
        return {"project": require(native, conn, project_id).to_dict()}

    return invoke(update)


@router.delete("/projects/{project_id}")
def delete(project_id: str):
    def remove(native, conn):
        require(native, conn, project_id)
        native.delete_project(conn, project_id)
        return {"deleted": True}

    return invoke(remove)


@router.post("/handoffs")
def handoff():
    # Refuse BEFORE parsing, staging attachments, reserving identities, or creating sessions.
    raise HTTPException(501, {"code": "project_handoff_unsupported", "message": HANDOFF_REASON})
