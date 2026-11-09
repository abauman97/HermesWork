# Hermes Projects

A standalone unified Hermes plugin for native project management and **create-first
New Project Chat** in Desktop and Webapp. Create a project, open its details, then
choose New Project Chat. The plugin validates the workspace and profile, immediately
persists an empty native session, and opens Hermes's own composer. Choose models,
attach files, send and continue entirely through Hermes. There is no custom composer,
first-send interception, execution or streaming path.

Native Projects navigation, search, metadata editing, workspace folders, archive,
restore, confirmed deletion, activity and associated-session browsing remain supported.
Creation and navigation use exact SDK connection/profile descriptors. New chat creation
currently supports the serving host's **local connection**, including named profiles;
remote Desktop routes are explicitly refused because this backend cannot validate
their filesystem safely. See [runtime evidence](docs/runtime-audit.md).

Hermes derives project membership from workspace and repository folders, choosing the
deepest matching folder. It does not persist an immutable project ID on a session.
Folder changes, nested projects, deletion and compaction may affect later grouping;
immutable association is not claimed. Empty sessions are durable immediately and can
remain unused. The native project tree omits them until the first message. Project
session counts/history cover up to 5,000 eligible sessions, without pagination.

If creation is uncertain, **Retry / Open saved chat** reuses the same request identity
and frozen parameters. A per-tab sessionStorage receipt survives reload, retains a
completed session if navigation interrupts creation, and never stores prompts,
attachments or credentials. Returning to that project's details recovers the result.
Closing the tab discards its recovery receipt; any created session remains native.
Use **Forget saved request** and its explicit confirmation if a corrupt, moved-workspace
or obsolete-route receipt cannot recover. This removes only local recovery information;
it never deletes or creates a session. Check native history first: a later New Project
Chat can create another session if the uncertain operation already succeeded.
Do not clear browser storage to retry an uncertain request. Errors never trigger an
unscoped fallback. Workspace validity is checked before creation and again before
opening. Receipt retirement awaits native hydration; a hydration failure retains it.
Navigation before SDK open admission prevents opening. Once SDK open starts awaiting
gateway activation, Hermes offers no cancellation or caller navigation fence: navigating
elsewhere in that interval can still be displaced by the delayed open. This also
applies to profile/connection changes during that interval. No private-store workaround
is used. Hermes has no atomic validate-project-and-create contract, so subsequent
folder edits can always change membership.

Cold-refresh detail URLs and records survive, but Hermes can front a restored chat
tile while plugin routes load. Reopen Projects; if it shows the list, select the
project again. No timed navigation workaround or private store mutation is used.
Legacy manually entered `/#/?project=...` draft URLs remain unsupported: their
indicator directs users to Projects and a fail-closed guard blocks every mounted
composer while that URL is active. The create-first flow never generates that URL.
Clear project navigates to a normal draft and can reset the visible editor; copy any
needed text first. No selective per-composer interception is claimed.

## Build and package

Requires Node 26+ and Python 3.11+ with `uv` (validation used Node 26 and Python 3.14).

```sh
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend test
uv sync --locked
uv run ruff check .
uv run ty check hermes_projects dashboard
# Native integration and source-contract tests need official Hermes source:
PYTHONPATH=/opt/hermes:/opt/hermes/.venv/lib/python3.14/site-packages uv run pytest -q
uv build
uv run python scripts/package.py
```

`desktop/plugin.js` is generated plain ESM with only SDK/React external imports.
The archive `dist/hermes-projects-0.1.0.tar.gz` includes that file, Python backend,
manifest and installation metadata. Build before running bundle tests or packaging;
clean source checkouts do not contain the generated bundle. A wheel alone contains
the backend, not the unified plugin. See [Git installer evidence and current checks](docs/git-installation.md). Lockfiles capture tooling; `npm audit` is clean in the tested tree.
The dev dependency override for minimatch selects a patched release; lint/tests
verify it works with the current toolchain.

## Install from Git

After this change is merged to `main` **and the first Actions publication succeeds**,
install into the intended Hermes profile with one command:

```sh
hermes plugins install https://github.com/abauman97/HermesWork.git --enable --yes-deps
```

For a named profile, run the same command with Hermes's global `--profile <name>`
option before `plugins`. `--enable` selects the backend; `--yes-deps` explicitly
consents to Hermes PM preparing the Python package and its FastAPI/Pydantic
requirements with the enabled plugin set. Omit `--yes-deps` for interactive consent.
There is no manual pip step, Node dependency install, local build, archive download,
or ChatHermes runtime. PM refusal must be resolved before enabling; `--no-deps`
leaves the plugin disabled and does not provide a working installation.

Restart the serving gateway (`hermes gateway restart` for a managed gateway, or
restart your foreground `hermes gateway run`) for initial backend discovery. Quit
and reopen Desktop or reload the Webapp, then enable **Projects** in
**Capabilities → Plugins**. The Desktop half is independently opt-in even when the
backend is enabled. Use the same host/connection/profile as the install. See
[after-install instructions](after-install.md).

The repository root is the unified runtime package: `plugin.yaml`, buildable
`pyproject.toml`, `hermes_projects/`, `dashboard/`, and Actions-published
`desktop/plugin.js` on `main`. Frontend source, npm manifests, lockfile and tests
live under `frontend/`; Hermes only treats a root npm manifest as runtime dependencies.
Hermes clones Git and reconciles the shipped `desktop/` into its app-level plugin
folder; it neither builds TSX nor downloads Actions artifacts. The wheel is for
Python packaging; the optional archive is for manual distribution.

[Build workflow](.github/workflows/build.yml) runs locked frontend checks and the
real installer/backend checks with read-only permissions on pull requests. It builds
before testing the bundle and passes the resulting archive to the installer job.
Local `desktop/plugin.js` is ignored; CI rejects generated asset changes in source
PRs. Do not force-add the bundle. A clone of published `main` tracks the distributed
file, so local rebuilds there can still show a diff; leave that diff out of source PRs.

After a push/merge to `main`, or a manual run selecting `main`, the guarded publisher
rebuilds the triggering SHA that passed both validation jobs and commits only
`desktop/plugin.js`. Publishers run independently and coordinate using an atomic
expected-SHA push lease; each asset commit extends the exact fetched main tip.
Rollbacks or rewrites racing a push are preserved.
Newer source on main causes a safe skip so its own workflow handles publication;
concurrent bot asset-only commits can be retried using the validated build. PRs and manual runs
on other branches cannot publish. Only this job has `contents: write`; it uses the
repository's `GITHUB_TOKEN`, with no custom secrets. Repository Actions settings and
main branch rules must allow its bot to push; a rejected push fails visibly. It does
not bypass protection. The token's asset push does not recursively trigger another
push workflow ([GitHub documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).

**Bootstrap:** `main` currently has no bundle. Merging the source change alone is
insufficient: wait for the successful publisher commit before using the one-line
install. If publication fails, fix Actions permissions/branch rules and manually
rerun on `main`. An uploaded CI archive alone cannot make a Git install work. Later
source merges can briefly leave the previous bundle installed until publication;
wait for success before installing/updating. GitHub-hosted write behavior remains
unverified until an actual merged or manual `main` run succeeds.

This package needs no agent tools or hooks. The `dashboard/manifest.json` exists
solely to load `/api/plugins/hermes-projects/*` on Hermes's shared server. It does
not contain a Dashboard entry bundle. The plugin namespace inherits Hermes auth,
request-origin protection and profile authorization. Never mount this router in
an unauthenticated server. Unknown/unavailable profiles must be rejected by Hermes.

Validated against the official 0.23.0 distribution identified in the runtime audit;
not a blanket compatibility claim for every 0.23.0+ build. Missing native project
service functions yield 503. Version-sensitive read-only membership resolution lives in one compatibility adapter.

## Independent real gateway/Webapp tests

No ChatHermes checkout, service, assets, credentials or runtime dependencies are used.
ChatHermes `tests/docker` was read only as a reference. The fixture uses an official
Hermes image, disposable `/tmp/hermes-projects-home`, its own network and synthetic
auth/inference. Only `hermes gateway run` launches. `HERMES_DASHBOARD=0`.

```sh
npm --prefix frontend run build
# All Compose commands run from this repository root:
docker compose --project-directory . -f tests/docker/compose.yml build
docker compose --project-directory . -f tests/docker/compose.yml up -d --wait --no-build
(cd frontend && PLAYWRIGHT_BROWSERS_PATH="$PWD/../artifacts/browsers" npx playwright install chromium)
PLAYWRIGHT_BROWSERS_PATH="$PWD/artifacts/browsers" npm --prefix frontend run test:e2e
# Explicit cleanup of only this fixture:
docker compose --project-directory . -f tests/docker/compose.yml down -v
```

Defaults: Webapp `127.0.0.1:9137`, synthetic login `tester` / `projects-local-test`.
Set `HERMES_PROJECTS_PORT`, `HERMES_PROJECTS_BIND`, `HERMES_PROJECTS_SUBNET`, or
`COMPOSE_PROJECT_NAME` to avoid collisions. The explicit subnet avoids an exhausted
Docker default address pool. Default binds are loopback; remote Docker needs a
private reachable publication/tunnel plus `HERMES_PROJECTS_URL`. Validation here
used `HERMES_PROJECTS_BIND=0.0.0.0` on the test daemon and
`HERMES_PROJECTS_URL=http://docker:9137`. Do not expose browser test credentials on
a public host. Builds copy fixtures instead of relying on client-path bind mounts.
`HERMES_PROJECTS_IMAGE` selects another official build for compatibility testing.

The inference fixture only accepts prompts containing `PROJECTS_TEST`; unknown
requests fail. Its replies echo the actual inference request model and whether the
attachment marker reached the model input. Real authenticated browser tests use the
mounted plugin, gateway, native model menu, uploads and composer. No inference or
browser API responses are faked by Playwright. A delayed, forwarded metadata request
exercises navigation races. Screenshots are saved under `frontend/artifacts/` (ignored), and
failure screenshots under `frontend/test-results/`. Traces are disabled to avoid retaining
authentication tickets. See [exact validation results and gaps](docs/validation.md).
