"""Create a complete unified plugin archive without installing into any Hermes home."""

import tarfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
if not (root / "desktop/plugin.js").is_file():
    raise SystemExit("Run npm ci && npm run build first")
out = root / "dist"
out.mkdir(exist_ok=True)
with tarfile.open(out / "hermes-projects-0.1.0.tar.gz", "w:gz") as archive:
    for name in [
        "plugin.yaml",
        "pyproject.toml",
        "__init__.py",
        "README.md",
        "hermes_projects",
        "dashboard",
        "desktop/plugin.js",
        "docs",
    ]:
        path = root / name
        files = sorted(path.rglob("*")) if path.is_dir() else [path]
        for file in files:
            if file.is_file() and "__pycache__" not in file.parts:
                archive.add(file, arcname=Path("hermes-projects") / file.relative_to(root))
print(out / "hermes-projects-0.1.0.tar.gz")
