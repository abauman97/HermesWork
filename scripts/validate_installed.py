"""Validate runtime imports and Desktop reconciliation using PM's selected Python."""

import hashlib
import json
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_cli.desktop_plugin_halves import reconcile_desktop_halves_report
from hermes_cli.web_server_dashboard import _mount_one_plugin_api

import hermes_projects

plugin = Path(sys.argv[1])
expected = sys.argv[2]
home = Path(os.environ["HERMES_HOME"])
# The smoke process runs outside the checkout and imports the PM-installed backend.
assert "plugin-sources" in str(hermes_projects.__file__), hermes_projects.__file__
import hermes_yaml as yaml  # noqa: E402

config = yaml.safe_load((home / "config.yaml").read_text())
assert "hermes-projects" in config["plugins"]["enabled"], config
manifest = json.loads((plugin / "dashboard/manifest.json").read_text())
manifest.update({"_dir": str(plugin / "dashboard"), "source": "user", "_api_file": "plugin_api.py"})
app = FastAPI()
assert _mount_one_plugin_api(app, manifest, {"hermes-projects"}, set())
# This process tests route loading/CRUD. Host authorization is covered by the Webapp suite.
# Clear host dependencies only in this local TestClient, never in the plugin or real server.
from hermes_cli.web_server_dashboard import _plugin_route_secret_scope  # noqa: E402

app.dependency_overrides[_plugin_route_secret_scope] = lambda: None
with TestClient(app) as client:
    response = client.post(
        "/api/plugins/hermes-projects/projects",
        json={
            "name": "Git installer smoke",
            "primary_path": str(home),
        },
    )
    assert response.status_code == 201, response.text
    pid = response.json()["project"]["id"]
    assert client.get(f"/api/plugins/hermes-projects/projects/{pid}").status_code == 200
    assert client.delete(f"/api/plugins/hermes-projects/projects/{pid}").status_code == 200
report = reconcile_desktop_halves_report(home, home / "desktop-plugins")
assert not report["refused"], report
bundle = home / "desktop-plugins/hermes-projects/plugin.js"
assert hashlib.sha256(bundle.read_bytes()).hexdigest() == expected
marker = json.loads((bundle.parent / ".hermes-package.json").read_text())
assert marker["package"] == "hermes-projects"
assert hashlib.sha256((plugin / "desktop/plugin.js").read_bytes()).hexdigest() == expected
assert not list(bundle.parent.rglob("*.tsx")), "Development source reached Desktop payload"
print("PASS: PM-installed backend, native CRUD, host API mount, reconciled Desktop bundle")
