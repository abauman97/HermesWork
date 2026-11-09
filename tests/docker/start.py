"""Fresh isolated state, only in this fixture container. Never reads the operator's profiles."""

import json
import os
import shutil
from pathlib import Path

home = Path("/tmp/hermes-projects-home")
home.mkdir(exist_ok=True)
source = Path("/opt/hermes-projects")
plugin = home / "plugins" / "hermes-projects"
if not plugin.exists():
    plugin.parent.mkdir(exist_ok=True)
    shutil.copytree(source, plugin, ignore=shutil.ignore_patterns(".git", ".venv", "node_modules"))
Path("/tmp/projects-workspace").mkdir(exist_ok=True)
Path("/tmp/projects-workspace/nested").mkdir(exist_ok=True)
Path("/tmp/projects-secondary").mkdir(exist_ok=True)
config = {
    "model": {
        "default": "projects-test",
        "provider": "custom",
        "base_url": "http://inference:8080/v1",
        "api_key": "synthetic-test-only",
    },
    "webapp": {"enabled": True, "host": "0.0.0.0", "port": 9137},
    "dashboard": {"basic_auth": {"username": "tester", "password": "projects-local-test"}},
    "plugins": {"enabled": ["hermes-projects"], "isolation": "in-process"},
    "desktop": {"repo_scan_enabled": False},
}
(home / "config.yaml").write_text(json.dumps(config))
secondary = home / "profiles" / "work"
secondary.mkdir(parents=True, exist_ok=True)
(secondary / "config.yaml").write_text(json.dumps(config))
(secondary / "plugins").mkdir(exist_ok=True)
if not (secondary / "plugins" / "hermes-projects").exists():
    (secondary / "plugins" / "hermes-projects").symlink_to(plugin, target_is_directory=True)
os.environ["HERMES_HOME"] = str(home)
os.environ["HERMES_DASHBOARD"] = "0"
os.execv("/opt/hermes/.venv/bin/python", ["python", "-m", "hermes_cli.main", "gateway", "run"])
