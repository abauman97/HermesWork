"""Run development checks inside the pinned, disposable official Hermes image."""

import os
import subprocess
import sys
from pathlib import Path

from pm import uv_launcher

uv = str(uv_launcher("uv"))
subprocess.run([uv, "sync", "--locked"], check=True)
for command in (["ruff", "check", "."], ["ty", "check", "hermes_projects", "dashboard"]):
    subprocess.run([uv, "run", *command], check=True)
env = dict(os.environ)
source = Path("/opt/hermes")
env["HERMES_SOURCE"] = str(source)
env["PYTHONPATH"] = os.pathsep.join([str(source), *sys.path])
subprocess.run([uv, "run", "pytest", "-q"], env=env, check=True)
subprocess.run([uv, "build"], check=True)
