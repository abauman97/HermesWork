"""Real CLI smoke test. Run ONLY in a disposable official Hermes container.

Creates a temporary Git fixture commit (never commits to the working repository),
clones its default branch through Hermes and lets PM resolve the Python package.
No installer, scanner, resolver, or subprocess is mocked.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from runtime_files import runtime_files

ROOT = Path(__file__).resolve().parents[1]


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def main():
    if os.environ.get("HERMES_PROJECTS_DISPOSABLE") != "1":
        raise SystemExit(
            "Set HERMES_PROJECTS_DISPOSABLE=1 only inside a disposable Hermes container"
        )
    with tempfile.TemporaryDirectory(prefix="projects-git-install-") as tmp:
        temp = Path(tmp)
        source = temp / "source"
        source.mkdir()
        # Include development trees too: the installer sees the same repository
        # layout as a normal default-branch clone, rather than only a release archive.
        files = set(runtime_files(ROOT))
        for pattern in [
            ".gitignore",
            ".dockerignore",
            "uv.lock",
            "frontend/*.json",
            "frontend/*.ts",
            "frontend/*.js",
            "frontend/src/*.ts",
            "frontend/src/*.tsx",
            "frontend/tests/frontend/*.ts",
            "frontend/tests/frontend/*.tsx",
            "frontend/tests/e2e/*.ts",
            "scripts/*.py",
            "tests/backend/*.py",
            "tests/docker/*",
            ".github/workflows/*.yml",
        ]:
            files.update(path for path in ROOT.glob(pattern) if path.is_file())
        for file in sorted(files):
            target = source / file.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, target)
        # A real default-branch Git source of the proposed repository. No credentials,
        # operator Git configuration or working-repository metadata enter it.
        env = {
            "PATH": os.environ["PATH"],
            "HOME": str(temp / "user"),
            "HERMES_HOME": str(temp / "home"),
            "HERMES_DOCKER_EXEC_AS_ROOT": "1",
            "HERMES_DASHBOARD": "0",
            "PYTHONPATH": "/opt/hermes",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        }
        Path(env["HOME"]).mkdir()
        Path(env["HERMES_HOME"]).mkdir()
        (Path(env["HERMES_HOME"]) / "config.yaml").write_text(
            json.dumps({"plugins": {"isolation": "in-process"}})
        )
        run(["git", "init", "--initial-branch=main", str(source)], env=env)
        run(["git", "-C", str(source), "add", "."], env=env)
        run(
            [
                "git",
                "-C",
                str(source),
                "-c",
                "user.name=Installer fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-m",
                "Disposable runtime fixture",
            ],
            env=env,
            stdout=subprocess.DEVNULL,
        )
        # Same flags as the documented one-line HTTPS install; file:// exercises actual clone.
        run(
            [
                sys.executable,
                "-m",
                "hermes_cli.main",
                "plugins",
                "install",
                source.as_uri(),
                "--enable",
                "--yes-deps",
            ],
            cwd=temp,
            env=env,
        )
        plugin = Path(env["HERMES_HOME"]) / "plugins/hermes-projects"
        assert plugin.is_dir(), "Installer did not publish the plugin"
        assert not (plugin / "package.json").exists(), "Unexpected runtime npm dependencies"
        # Ask PM which interpreter it selected; never pip-install the plugin.
        selected = subprocess.check_output(
            [
                sys.executable,
                "-c",
                "from pm.environments import project_python; "
                "from pathlib import Path; print(project_python(Path('/opt/hermes')))",
            ],
            cwd=temp,
            env=env,
            text=True,
        ).strip()
        expected = hashlib.sha256((ROOT / "desktop/plugin.js").read_bytes()).hexdigest()
        run(
            [selected, str(ROOT / "scripts/validate_installed.py"), str(plugin), expected],
            cwd=temp,
            env=env,
        )
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "source": "temporary file:// Git default branch",
                    "bundle_sha256": expected,
                    "python": selected,
                }
            )
        )


if __name__ == "__main__":
    main()
