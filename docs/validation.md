> Historical feature validation before the frontend tooling relocation. For current
> commands and Git installation results, see [git-installation.md](git-installation.md).

# Validation record

2026-11-09. This repository has no base commit or remote. Existing uncommitted and
untracked work was preserved; a before-change archive is in ignored
`artifacts/before-create-first.tar.gz`. No commit, push, deployment, core changes,
other-project changes or live-profile writes were made. Only the task-owned
`hermes-projects-test` Docker Compose fixture was rebuilt/recreated. Its Compose
labels, source paths, image, isolated home and published `http://docker:9137` endpoint
were checked before use. No dependencies were added; the existing lockfiles remain.

## Final checks

| Command                                                                                                                                                  | Result                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `uv sync --locked`                                                                                                                                       | Passed; existing locked environment                |
| `npm run typecheck`                                                                                                                                      | Passed; frontend plus browser/unit test types      |
| `npm audit`                                                                                                                                              | Passed; 0 vulnerabilities                          |
| `npm run lint`                                                                                                                                           | Passed                                             |
| `npm test`                                                                                                                                               | 38 frontend tests passed                           |
| `uv run ruff check .`                                                                                                                                    | Passed                                             |
| `uv run ruff format --check .`                                                                                                                           | Passed                                             |
| `uv run ty check hermes_projects dashboard`                                                                                                              | Passed                                             |
| `PYTHONPATH=/opt/hermes:/opt/hermes/.venv/lib/python3.14/site-packages uv run pytest -q`                                                                 | 19 backend/source-contract tests passed            |
| `npx prettier --check desktop/src tests/frontend tests/e2e *.ts *.js *.json *.yaml README.md docs/*.md dashboard/manifest.json tests/docker/compose.yml` | Passed                                             |
| `npm run build`                                                                                                                                          | Passed; SDK/React external ESM entry               |
| `uv build`                                                                                                                                               | Passed; Python sdist/wheel                         |
| `uv run python scripts/package.py`                                                                                                                       | Passed; unified plugin archive under dist          |
| Task-owned Compose build / recreate with `HERMES_PROJECTS_BIND=0.0.0.0`                                                                                  | Real pinned Hermes gateway and synthetic inference |
| `HERMES_PROJECTS_URL=http://docker:9137 PLAYWRIGHT_BROWSERS_PATH="$PWD/artifacts/browsers" npm run test:e2e`                                             | 6 passed (38.2 seconds, final rerun)               |

The native Git probe imports Hermes's runtime dependencies. The backend test command
adds the audited runtime's Python 3.14 site-packages read-only to PYTHONPATH; it does
not install those dependencies into this plugin or alter the runtime. The isolated
uv environment supplies pytest. The runtime installation can report its pre-existing
lock drift after installing a plugin into the disposable image. Docker uses its
classic builder because buildx is absent. No live inference service is used.

## Coverage

Unit/regression tests exercise exact route descriptors, profile/connection receipt
keys, duplicate clicks, frozen retry arguments after a lost create response,
missing stored IDs, recovery after open failure, storage failure, navigation during
creation, profile switching away and back, route replacement/unavailability and
native membership changing while creation is pending. Known stored results reopen
without another create. Delayed hydration keeps receipts until success; hydration
rejection retains the stored ID. Empty/corrupt receipts never authorize automatic new
creation. Confirmed retirement removes only its connection/profile/project key and
is refused while locked. Delayed SDK open reproduces the documented foreground
limitation. Save success/failure after hash, profile or connection changes and return,
plus unmount/remount generation invalidation, are covered. Legacy draft URLs still block all mounted composers;
ordinary drafts and existing sessions pass through without changed text/files.

Backend tests use temporary homes and actual native project services: CRUD, folders,
archive/restore/delete, wrong IDs/slugs, invalid/deleted workspaces, symlink resolution,
profile isolation and deepest overlapping folders. An exact synthetic repository-probe
result tests native cwd-vs-common-repository matching and tie behavior, without
reimplementing the resolver. Source-contract tests pin canonical creation/admission
identities, native membership and SDK routing/source conventions. Old attachment-bearing
handoff requests still return 501 without touching native state.

Authenticated Webapp tests enable the plugin through real Capabilities controls and
exercise mounted CRUD, cold project-detail refresh/recovery, immediate durable empty
session creation (a real double-click produces exactly one new session), native custom-model selection, native file upload and two messages.
The synthetic inference reply echoes the actual request model and whether the unique
attachment content marker reached its messages. This verifies propagation through
execution, rather than only a changed model label or attachment chip. Tests reopen the
same associated session from project details and reload its native transcript.
A real secondary-profile chat verifies persisted cwd/profile and rejects its session
ID in the default profile. A delayed, forwarded prepare request exercises navigation
before admission; a stale workspace record produces a visible failure with unchanged
native session inventory. Unauthenticated and unavailable-profile API requests are
also rejected. Playwright forwards native gateway/inference traffic. A response-fault test drops
one successful `session.create` WebSocket response after commit, then performs a real
page reload. The retry uses byte-equivalent decoded wire parameters and the same
request identity; inventory proves one new native session. The receipt is still
present while the real `session.resume` response is delayed for hydration and retires
after release. Removing the workspace folder before retry refuses native creation
and retains the frozen receipt; restoring it allows recovery. A second tab has no
receipt, and confirmed retirement of a deliberately corrupt receipt there does not
change session inventory or the original tab's receipt. No gateway result contents
or inference replies are fabricated. Mounted list/detail layout assertions cover a
valid maximum-length (200 characters) unbroken project name at both viewport sizes.

The installed and reconciled `desktop-plugins/hermes-projects/plugin.js` hashes match
this repository's final `desktop/plugin.js`. Backend API and compatibility source
hashes also match the fixture. The original archive comparison found no missing
pre-existing files; package lockfiles are unchanged.

The fixture runs only `hermes gateway run`, with `HERMES_DASHBOARD=0`, under the
image's hermes user and docker-init. Inference accepts only PROJECTS_TEST prompts.
Default and work profile homes/configurations, uploaded files and all sessions live
inside the disposable container. No ChatHermes service or asset is used.

## Screenshots and artifacts

Final mounted Webapp screenshots (ignored `artifacts/`):

- `final-project-desktop.png` and `final-project-mobile.png`
- `final-native-desktop.png` and `final-native-mobile.png`
- `real-project-list.png`, `real-project-details.png`
- `final-secondary-profile.png`, `final-validation-failure.png`
- `final-long-name-list-1440.png`, `final-long-name-details-1440.png`
- `final-long-name-list-390.png`, `final-long-name-details-390.png`
- `final-reload-recovery.png`, `final-forget-confirmation.png`

The final project/native desktop/mobile screenshots and all four long-name
list/detail screenshots were visually inspected.
Project content fits at 390px with no horizontal overflow; the primary action, native
controls, wrapped paths and editor surface match the host. Native mobile chrome has
its own truncated status-bar labels.
The UI uses actual SDK Button, Input and Select components and the native editor,
text and stroke theme tokens. Viewport checks include 1440×1000 and 390×844; mobile
project content is checked for horizontal overflow. Browser traces are disabled to
avoid storing authentication tickets. Existing older screenshots are retained and
are not evidence of the final revision. The complete unified artifact is
`dist/hermes-projects-0.1.0.tar.gz`; wheels alone contain only the backend.

## Gaps and practical limits

- Native Electron, physical mobile devices, SSH and multiple Desktop connection
  registries are not tested. Creation on remote Desktop routes is explicitly refused.
- Browser fault coverage includes loss of a successful create response, real reload,
  moved-workspace refusal, delayed hydration and tab-local recovery. Profile/connection
  switching during pending creation/save is unit tested; multiple native Desktop
  connection registries and profile-switch UI races are not browser tested.
- SDK opens cannot be cancelled once admitted. During awaited gateway activation,
  navigation/profile/connection changes can still be displaced by a late foreground
  open. The supported SDK has no caller fence; `refreshInPlace` cannot open a new chat.
  This limitation is documented from source and reproduced in a delayed-open unit test.
  The exact SDK activation interval is not injected in the real browser.
- Compaction, directory edits during an actual native create, gateway restart during
  creation, cancellation of native generation, other viewers and simultaneous creation
  from independent tabs are not end-to-end tested. The plugin does not own native send/cancel behavior.
- Per-tab receipts survive reload, not tab closure/storage clearing. There is no
  global exactly-once promise across independent deliberate new-chat actions.
- Hermes derives association from folders; it has no immutable per-session project
  assignment or atomic project validation/create. Future folder edits can regroup
  sessions. Empty sessions persist immediately and are excluded from project trees
  until sent; lists have a 5,000-session cap and source exclusions.
- Cold-refresh plugin foreground restoration remains a host limitation; reopen the
  Projects sidebar and select the project if needed. Legacy manually entered project
  draft URLs retain a broad fail-closed guard and can reset the editor on Clear.
- The original draft-first indicator/intercept/retire workflow is superseded, not
  implemented. No claim is made for all future Hermes 0.23.0+ builds or real providers.

## Review follow-up verification

Final source adds no dependencies or core/private APIs. Native REST authorization,
profile route checks, workspace preparation and deepest-folder membership checks
remain intact. Browser runs initially exposed two test-fixture errors (an over-limit
name rejected by the native API, then a hidden mobile sidebar shortcut); the fixture
now uses a valid 200-character name and opens mobile details through the visible list.
The complete suite was rerun after those corrections. Built/reconciled plugin SHA-256:
`15a810ef7bafa9e495aa7193e732c2b38d89c1fc630673f5e65d94bae41c4126`.
