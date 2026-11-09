"""Create a complete unified plugin archive without installing into any Hermes home."""

import tarfile
from pathlib import Path

from runtime_files import runtime_files

root = Path(__file__).resolve().parents[1]
out = root / "dist"
out.mkdir(exist_ok=True)
with tarfile.open(out / "hermes-projects-0.1.0.tar.gz", "w:gz") as archive:
    for file in runtime_files(root):
        archive.add(file, arcname=Path("hermes-projects") / file.relative_to(root))
print(out / "hermes-projects-0.1.0.tar.gz")
