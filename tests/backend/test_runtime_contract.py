"""Evidence checks on official source: distinguish canonical runtime from the legacy sidecar."""

import ast
import os
from pathlib import Path

import pytest

SOURCE = Path(os.environ.get("HERMES_SOURCE", "/opt/hermes"))


def source(path):
    target = SOURCE / path
    if not target.is_file():
        pytest.skip(f"Official source not present: {target}")
    return target.read_text()


def fields(path, name):
    tree = ast.parse(source(path))
    cls = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == name)
    return {n.target.id for n in cls.body if isinstance(n, ast.AnnAssign)}


def test_canonical_create_has_identity_but_no_project_foreign_key():
    names = fields("tui_gateway/contracts/canonical_sessions.py", "CanonicalCreateParams")
    assert {"request_id", "cwd", "row_cwd"} <= names
    assert "project_id" not in names
    local = source("gateway/session_local.py")
    assert "local_identity(authority.profile_id, actor.subject, request_id)" in local
    assert "same_create_retry" in local


def test_canonical_submit_supports_identity_and_attachments():
    names = fields("tui_gateway/contracts/canonical_sessions.py", "CanonicalSubmitParams")
    assert {"submission_id", "input_id", "attachments"} <= names
    controls = source("gateway/session_controls.py")
    assert "self.authority.submit" in controls
    assert "Submission(request_id, ref, payload, 'queue')" in controls


def test_sdk_middleware_drops_origin_and_identity():
    submit = source("apps/desktop/src/app/chat/composer/hooks/use-middleware-submit.ts")
    assert "runComposerMiddleware({ text: value, attachments: options?.attachments })" in submit
    assert "submission_id" not in submit
    assert "composerScope" not in submit
    contract = source("apps/desktop/src/app/chat/composer/contrib.ts")
    draft = contract.split("export interface ComposerDraft {", 1)[1].split("}", 1)[0]
    assert "text:" in draft and "attachments?" in draft
    assert "sessionId" not in draft and "submission_id" not in draft


def test_sdk_profile_routing_open_and_create_adapter_contract():
    sdk = source("apps/desktop/src/sdk/index.ts")
    assert "requestPluginProfile<T>(route, method, params, timeoutMs, options)" in sdk
    assert "const explicitRoute = options.route ? { ...options.route } : null" in sdk
    routing = source("apps/desktop/src/sdk/profile-request.ts")
    assert "requestGatewayForAgent<T>(route.connectionId, route.profile, method, params)" in routing
    wire = source("apps/desktop/src/api/canonical-protocol.ts")
    assert "cwd_explicit" in wire and "request_id" in wire
    assert "source: 'gui'" in wire
    assert "stored_session_id" in wire


def test_native_membership_contract_is_deepest_cwd_or_repository():
    tree = source("tui_gateway/project_tree.py")
    assert "class _FolderIndex" in tree
    assert "def _project_for_session" in tree
    assert "dict.fromkeys((cwd, repo_root))" in tree
    assert "key=lambda hit: hit[1]" in tree
