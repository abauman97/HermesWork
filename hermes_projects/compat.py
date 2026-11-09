"""The only internal Python dependency. Never issue SQL or change native active project state.

Hermes supplies the authenticated request's home scope before calling the router.
Native project services resolve that scope, including isolated plugin-host processes.
"""

from contextlib import contextmanager
from importlib import import_module


@contextmanager
def projects():
    native = import_module("hermes_cli.projects_db")
    required = (
        "connect_closing",
        "get_project",
        "list_projects",
        "create_project",
        "update_project",
        "archive_project",
        "restore_project",
        "delete_project",
        "add_folder",
        "remove_folder",
        "set_primary",
    )
    if not all(callable(getattr(native, key, None)) for key in required):
        raise RuntimeError("This Hermes runtime lacks the required native project services")
    with native.connect_closing() as conn:
        yield native, conn


def matching_project(records: list[dict], cwd: str):
    """Reuse the audited tree resolver, including cwd/repository overlap and tie rules.

    This private read-only seam is version-pinned by contract and behavior tests.
    """
    tree = import_module("tui_gateway.project_tree")
    probe = import_module("tui_gateway.git_probe")
    index = getattr(tree, "_FolderIndex", None)
    match = getattr(tree, "_project_for_session", None)
    resolve = getattr(probe, "resolve", None)
    if not callable(index) or not callable(match) or not callable(resolve):
        raise RuntimeError("This Hermes runtime lacks the audited native membership resolver")
    return match({"cwd": cwd}, index(records), resolve)
