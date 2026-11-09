"""Distribution regressions: a default-branch clone must be immediately installable."""

import json
import re
import runpy
import subprocess
import sys
import tarfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_runtime_layout_has_bundle_without_runtime_node_install():
    assert not (ROOT / "package.json").exists()
    assert (ROOT / "frontend/package-lock.json").is_file()
    assert not (ROOT / "desktop/src").exists()
    bundle = (ROOT / "desktop/plugin.js").read_text()
    assert len(bundle) > 1000
    imports = set(re.findall(r'from "([^"]+)"', bundle))
    assert imports == {"react", "react/jsx-runtime", "@hermes/plugin-sdk"}
    assert "hermes-projects" in bundle
    metadata = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert set(metadata["project"]["dependencies"]) == {"fastapi>=0.115", "pydantic>=2"}
    assert metadata["tool"]["hatch"]["build"]["targets"]["wheel"]["packages"] == ["hermes_projects"]
    manifest = json.loads((ROOT / "dashboard/manifest.json").read_text())
    assert manifest["api"] == "plugin_api.py"


def test_archive_is_complete_and_uses_explicit_runtime_allowlist():
    # Local credentials, caches and tooling can never be swept into the archive.
    runtime_files = runpy.run_path(str(ROOT / "scripts/runtime_files.py"))["runtime_files"]
    expected = {str(path.relative_to(ROOT)) for path in runtime_files(ROOT)}
    assert {
        "desktop/plugin.js",
        "dashboard/plugin_api.py",
        "hermes_projects/api.py",
        "plugin.yaml",
        "pyproject.toml",
        "after-install.md",
    } <= expected
    assert not any(name.startswith(("frontend/", ".", "tests/")) for name in expected)
    subprocess.run([sys.executable, str(ROOT / "scripts/package.py")], check=True)
    with tarfile.open(ROOT / "dist/hermes-projects-0.1.0.tar.gz") as archive:
        names = {str(Path(name).relative_to("hermes-projects")) for name in archive.getnames()}
        assert names == expected
        assert all(member.isfile() for member in archive.getmembers())
        assert (
            archive.extractfile("hermes-projects/desktop/plugin.js").read()
            == (ROOT / "desktop/plugin.js").read_bytes()
        )
