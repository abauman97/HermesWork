# Git installation design and verification

Validated 2026-11-09 against official Hermes 0.23.0, distribution commit
`2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`, image
`nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`.
The installer source was read from `/opt/hermes` before implementation. The existing
Docker fixture and native/source-contract tests were also inspected first.

## Installer evidence

These are Hermes source paths, not plugin implementation paths:

- `hermes_cli/plugins_cmd_git.py::_clone_plugin_repo`: a normal URL without a ref
  clones the Git default branch. It does not retrieve an Actions artifact.
- `hermes_cli/plugins_cmd_install.py::_install_plugin_core`, `cmd_install`,
  `_install_plugin_python_deps`: clone/scan/publish, explicit `--enable` and
  `--yes-deps`, and Python dependency consent. A root `package.json` offers a
  separate Node sidecar installation; it is not a frontend build contract.
- `pm/plugin_declarations.py::read_python_declaration`: a root `pyproject.toml`
  with `[project]` owns Python packaging and dependency declarations.
  `pm/workspace.py::_workspace_member` builds the package in the PM generation;
  `_runtime_member_metadata` removes development groups from runtime resolution.
- `hermes_cli/desktop_plugin_halves.py::desktop_source`,
  `reconcile_desktop_halves_report`: detect `desktop/plugin.js` and copy that tree
  into the app-level Desktop plugin directory with a package marker.
- `hermes_cli/web_server_dashboard.py::_mount_one_plugin_api`: loads the trusted,
  enabled package's `dashboard/plugin_api.py` under `/api/plugins/<name>`.

The runtime package stays at repository root. All npm tooling, TSX and frontend
fixtures move under `frontend/`. `desktop/` contains only the generated runtime
bundle. Python dependencies remain in the buildable root pyproject; no manifest-only
workaround or external-runtime bypass is used. Hermes supplies SDK/React imports.
No ChatHermes source, assets, process or credentials are needed.

## Automation

`.github/workflows/build.yml` has one build/publish job. It runs only on pushes
to `main` and manual runs selecting `main`; there is no PR workflow. Like the
ChatHermes build/release workflow, its only work is installing locked dependencies,
building, verifying required output and committing assets. It does not run tests,
typecheck, lint, archive packaging or installer/backend checks. These remain local
checks, with reproduction commands below and in README.md. No artifacts are
uploaded or downloaded, and no custom secrets are required.

The job is restricted to push/dispatch events on `refs/heads/main` and alone has
`contents: write` and persisted credentials. There is no concurrency group:
pending replacement must never drop the newest revision when runs arrive out of
order. Publishers coordinate through an atomic push lease instead.
The checkout and required `SOURCE_SHA` are pinned to `github.sha`, including manual
runs. `scripts/publish-assets.sh` removes old output, installs locked dependencies
and builds at that exact source revision. It requires a nonempty, non-symlink bundle.
Newer source on main before/during the build or at push time causes a successful
skip, leaving publication to the newer revision's workflow. A rewritten main also
causes a skip. Only a linear chain of bot-authored and bot-committed updates changing
solely `desktop/plugin.js` may extend the source revision. These commits need no
new workflow; the publisher retries the same pinned bundle on top of them, up to
three push attempts, and exits without a commit if the output already matches.
Each push uses `--force-with-lease=refs/heads/main:<exact fetched SHA>` and a commit
whose parent is that SHA, so successful updates are always fast-forward. The explicit
lease rejects even a rollback to an ancestor between fetch and push; retries skip
rolled-back or rewritten main instead of restoring removed history. There is no
unconditional force push. A rejected push without a changed main fails immediately
with a permissions/rules diagnostic. The script runs from a temporary copy so
checkout resets cannot replace it mid-run.

Local generated assets are ignored; keep generated bundle changes out of source
PRs. There is no automated PR policy check. Published main necessarily tracks the
distribution file, so local rebuilds of that tracked copy can still show a diff.
Keep it out of source PRs. Actions owns asset commits on main. Unlike ChatHermes's
reference GitHub App publisher, this uses `GITHUB_TOKEN`, avoiding custom secrets and recursive push runs
([GitHub token behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
Configure Actions write access and main branch rules to allow that bot to push;
the workflow does not bypass branch protection. Remove obsolete required validation
job checks from branch rules if they were configured for the former workflow.
GitHub-hosted token permissions and branch-rule compatibility cannot be established
by local tests.

**Bootstrap:** main has no `desktop/plugin.js` before this change. The first
post-merge Actions run must publish it successfully before the one-line Git install
works. If it fails, correct repository permissions/rules and dispatch on `main`.
A locally packaged archive is insufficient. On subsequent source merges, wait for
publication before installing/updating to avoid cloning the previous bundle.

## Reproduce the installer and backend checks

After building the frontend from the repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run build
docker run --rm --user root --entrypoint sh \
  -e HERMES_PROJECTS_DISPOSABLE=1 \
  -v "$PWD:/source:ro" \
  nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002 \
  -c 'cp -R /source /tmp/plugin-tests && cd /tmp/plugin-tests && python3 scripts/test_installer.py && python3 scripts/check_backend.py'
```

`test_installer.py` requires the disposable-environment opt-in. It snapshots the
proposed repository's runtime and development trees from explicit file patterns
into a temporary Git repository, creates a fixture commit on `main`, then invokes
Hermes's actual CLI with `file://... --enable --yes-deps`, without a ref. These
fixture commits force-add the ignored bundle to simulate Actions publication and
never touch the worktree's Git index, history, branches or remotes.
`HOME`, `HERMES_HOME` and Git configuration are isolated. The CLI, security scanner,
Git clone, dependency resolver and PM publisher are not mocked. There is no manual
pip installation, `--no-deps`, Node sidecar, frontend build during installation, or
plugin source directory added to PYTHONPATH.

The smoke process asks PM for its selected Python and starts a new process outside
the source checkout. Validation asserts import from PM's `plugin-sources`, backend
enablement in config, real Hermes API mounting, native project create/read/delete,
and byte-equal installed and reconciled Desktop bundles plus the pairing marker.
The test selects in-process plugin isolation in its disposable config so it can test
API mounting directly. It overrides the host secret-scope dependency only on its
local FastAPI TestClient; this smoke test does not establish authentication,
plugin-host subprocess isolation or real gateway restart behavior. The plugin
itself never overrides host authorization. Previous authenticated browser evidence
is in [validation.md](validation.md).

## Results and boundaries

- `npm --prefix frontend ci`: passed, 198 packages audited, zero vulnerabilities.
- `npm --prefix frontend run typecheck` and `run lint`: passed.
- `npm --prefix frontend test`: **39 passed**, including execution of the shipped
  ESM bundle against the test SDK and contribution registration/legacy-draft guard.
- `npm --prefix frontend run build`: passed; repeated output is byte-identical.
- `uv sync --locked`, `uv run ruff check .`,
  `uv run ty check hermes_projects dashboard`: passed.
- `HERMES_SOURCE=/opt/hermes PYTHONPATH=/opt/hermes:/opt/hermes/.venv/lib/python3.14/site-packages uv run pytest -q`:
  **21 passed**, including runtime layout, dependency declarations and archive tests.
- `uv build` and `uv run python scripts/package.py`: passed; wheel, sdist and unified
  runtime archive generated under ignored `dist/`.
- Real Git install: **passed** in a fresh official container with a disposable home;
  actual PM resolution/installation, enabled backend, native CRUD, host API mount,
  and Desktop reconciliation all passed. The container also ran the Python checks,
  all 21 tests and wheel/sdist build successfully.
- Earlier workflow syntax: `actionlint` 1.7.7 passed; see current verification below.
- Generated/installed/reconciled `plugin.js` SHA-256:
  `a63b6fc799b8b9ee9a4c7a8b62856e04d282b9158a5f729084925bc9775a6164`.

The local environment has a remote Docker daemon and no Docker CLI; the equivalent
container was created, populated and executed through the Docker Engine API.
Only a task-owned container was used and removed. No host core or other profile was
changed. GitHub-hosted Actions itself has not run, and branch protection is not
configured by this change. The existing six-browser-test results in validation.md
are historical; browser/Electron testing was not rerun for this packaging change.
No claim is made for other Hermes versions or operating systems.

`git ls-remote --symref origin HEAD` confirmed remote `main` still points at
`1b9b6f86312369636910b3b1b2fd467fc6a3952a`. That revision predates this layout. No
remote install of the proposed changes is possible without publication, so the
smoke uses an actual local Git source instead. No worktree commit, push or deployment
was made. After a maintainer merges the source changes and the first Actions publisher
successfully commits `desktop/plugin.js` to main, the supported operator command is:

```sh
hermes plugins install https://github.com/abauman97/HermesWork.git --enable --yes-deps
```

Then restart the serving gateway, reopen Desktop/reload Webapp, and opt into
**Projects** in **Capabilities → Plugins** as described in README.md.

## Build-only publication follow-up

The results above are historical packaging/installer evidence. The current workflow
runs no validation jobs; frontend and backend checks remain available locally.
Publication regressions exercise the exact shell script with disposable bare Git
remotes and deterministic npm fixture output. The fixture rejects every npm command
except locked installation and build. Coverage includes bootstrap, unchanged output,
source races, competing publishers, bot asset-only retries, out-of-order runs,
rollbacks, rewrites, missing output, build failure and permission rejection.
Successful publication is checked with non-fast-forward updates disabled on the
remote. Commits and pushes occur only in temporary test repositories.
The actual ignore policy is exercised separately; normal local builds stay ignored.

GitHub-hosted writes remain unverified until a successful merged/manual main run.
Repository permissions and remote branch protection are not changed here. A stale
run skips newer source rather than rebuilding it: wait for the newer run's asset
commit, or dispatch again on main if that run fails. The official-container installer
smoke and browser results above are historical and are not performed by the action.

Current local verification (2026-11-09):

- Locked npm installation and frontend build passed; all 39 frontend tests passed.
- All 28 publication/workflow/ignore tests passed; Ruff passed for the changed test.
- `actionlint` 1.7.7 and `git diff --check` passed.
- The publisher also ran with real npm against a disposable local bare remote:
  asset-only fast-forward publication, byte-identical bundle, unchanged rerun with
  no extra commit, and a clean disposable checkout all passed.
- The worktree bundle remains ignored with SHA-256
  `a63b6fc799b8b9ee9a4c7a8b62856e04d282b9158a5f729084925bc9775a6164`.

No worktree commit, network push or deployment was performed. The Python test run
reported a third-party pytest deprecation warning; npm reported a blocked esbuild
postinstall script under npm 12, but installation and both real builds succeeded.
