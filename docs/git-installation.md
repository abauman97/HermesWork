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

`.github/workflows/build.yml` validates pushes, pull requests and manual runs.
Read-only validation checks out without persisted credentials, builds with locked
npm dependencies before executing bundle tests, and uploads an allowlisted runtime
archive. The separate Hermes job downloads that run's archive and extracts its
bundle before testing the official installer/backend in the pinned disposable image.
No PR artifact or PR checkout is used by the publisher. There is no
`pull_request_target` trigger or custom secret.

The publish job requires both validation jobs, is restricted to push/dispatch events
on `refs/heads/main`, and alone has `contents: write` and persisted credentials.
It has no workflow or job concurrency group: pending replacement must never drop
the newest revision when validation jobs finish out of order. Publishers coordinate
through an atomic push lease instead.
The checkout and required `VALIDATED_SHA` are both pinned to `github.sha`, including
manual runs. `scripts/publish-assets.sh` removes old output, installs locked dependencies,
typechecks, lints, builds and runs bundle tests at that exact validated revision.
Newer source on main before/during the build or at push time causes a successful
skip, leaving publication to the newer revision's workflow. A rewritten main also
causes a skip. Only a linear chain of bot-authored and bot-committed updates changing
solely `desktop/plugin.js` may extend the validated revision. These commits need no
new workflow; the publisher retries the same validated bundle on top of them, up to
three push attempts, and exits without a commit if the output already matches.
Each push uses `--force-with-lease=refs/heads/main:<exact fetched SHA>` and a commit
whose parent is that SHA, so successful updates are always fast-forward. The explicit
lease rejects even a rollback to an ancestor between fetch and push; retries skip
rolled-back or rewritten main instead of restoring removed history. There is no
unconditional force push. A rejected push without a changed main fails immediately
with a permissions/rules diagnostic. The script runs from a temporary copy so
checkout resets cannot replace it mid-run.

Local generated assets are ignored; a read-only PR check rejects bundle changes
against the PR base. Published main necessarily tracks the distribution file, so
local rebuilds of that tracked copy can still show a diff. Keep it out of source PRs.
Actions owns asset commits on main. Unlike ChatHermes's reference GitHub App publisher, this
uses `GITHUB_TOKEN`, avoiding custom secrets and recursive push runs
([GitHub token behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
Configure Actions write access and main branch rules to allow that bot to push;
the workflow does not bypass branch protection. Require the validation jobs for
source merges. GitHub-hosted token permissions and branch-rule compatibility cannot
be established by local tests.

**Bootstrap:** main has no `desktop/plugin.js` before this change. The first
post-merge Actions run must publish it successfully before the one-line Git install
works. If it fails, correct repository permissions/rules and dispatch on `main`.
An archive upload is insufficient. On subsequent source merges, wait for publication
before installing/updating to avoid cloning the previous bundle.

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

## Actions-owned publication follow-up

The prior results above describe the original packaging revision. Current local
verification exercises the actual publisher shell script against disposable bare
Git remotes, with npm replaced by deterministic fixture output: bootstrap,
unchanged output, newer source before/during builds and at push, concurrent bot
asset-only commits, competing publishers, out-of-order validation completion,
source and bot-asset rollbacks between the final fetch and push, manual runs pinned
to their triggering SHA, rewritten history, missing output, build failure and permission
rejection. Successful publication is also checked with non-fast-forward updates
disabled on the remote. The new regressions reject the previous push and concurrency
behavior. These tests
create commits and pushes only in temporary repositories. The normal frontend build
and tests verify the real generated ESM separately. The installer fixture explicitly
force-adds the ignored bundle to model the published main layout. The exact PR
bundle-policy command is also tested against source-only and generated-file changes,
both before and after bootstrap.

Current checks passed:

- Frontend typecheck, lint, build and all **39 tests**.
- Python Ruff and Ty checks; all **50 tests**, including **29 publication/policy tests**.
- `actionlint` **1.7.7** on the updated workflow and `git diff --check`.
- The local bundle remains ignored and byte-identical to the previously validated
  SHA-256 above, with no `desktop/plugin.js` change against main in the final PR diff.

The official-container installer smoke result above is historical; that container
smoke was not rerun for this follow-up. The changed fixture is configured for the
next read-only CI run.

GitHub-hosted writes remain unverified until the first successful merged/manual
main run. No repository permissions or remote branch protection were changed here.
