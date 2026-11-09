"""Explicit source list for release archives and disposable git installer fixtures."""

from pathlib import Path


def runtime_files(root: Path) -> list[Path]:
    names = ["plugin.yaml", "pyproject.toml", "__init__.py", "README.md", "after-install.md"]
    files = [root / name for name in names]
    files.extend(sorted((root / "hermes_projects").glob("*.py")))
    files.extend([root / "dashboard/manifest.json", root / "dashboard/plugin_api.py"])
    files.append(root / "desktop/plugin.js")
    files.extend(sorted((root / "docs").glob("*.md")))
    for path in files:
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or linked runtime file: {path}")
    return files
