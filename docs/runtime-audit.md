# Runtime capability audit

Audited 2026-11-09 against the read-only `/opt/hermes` official distribution:
Hermes 0.23.0, commit `2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`.
The test image is `nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002`.
The original draft-first specification is superseded by the user-approved create-first
flow: immediately persisted empty sessions and native workspace-derived membership
are accepted. This does not establish the original first-send acceptance criteria.

## Creation and native execution

- `apps/desktop/src/sdk/index.ts`, `sdk/profile-request.ts`: `host.profileRoutes()`
  exposes credential-free connection/profile/targetProfile descriptors.
  `host.requestProfile(route, method, params)` routes to the exact connection/profile
  without foregrounding it. Profile labels alone are not sufficient on Desktop.
- `api/canonical-protocol.ts::prepareCreate`: SDK `source: 'desktop'` becomes canonical
  `gui`; `cwd`, `cwd_explicit`, `request_id` and explicit `profile` are supported.
  The canonical schema is `tui_gateway/contracts/canonical_sessions.py`.
- `gateway/session_controls.py::_create`, `gateway/session_local.py::stage_local_session`:
  durable identity uses `local_identity(authority.profile_id, actor.subject, request_id)`.
  `same_create_retry` rejects changed creation parameters. `commit_local_session`
  persists the empty session. This is not the older lazy sidecar create implementation.
- The plugin uses a stable UUID and frozen `source`, `cwd`, `cwd_explicit`, `profile`
  and `request_id`; no title shortcut (which can reopen a named existing session),
  model override, prompt, or attachment is passed during creation.
- The returned `stored_session_id` is opened using `host.openSession(id, {profile, route})`.
  The runtime-only ID is never substituted. The SDK owns hydration, native model
  selection, uploads, first send, admission identities, subsequent sends and streaming.
  Real Webapp tests cover these controls, not just gateway creation.

## Validation, association and scope

`POST /projects/{id}/prepare-chat?profile=...` is a read-only authenticated metadata
validation, not a session-creation backend. Hermes supplies authenticated principal,
profile authorization and home scope before the sync handler runs. The plugin never
opens a second unauthenticated API server, writes session rows, changes the active
project selection, or constructs gateway credentials.

The handler requires an exact persistent project ID, an unarchived record and an
existing absolute directory (symlinks resolved). A missing primary folder is an error.
It uses the native `tui_gateway.project_tree::_FolderIndex` and `_project_for_session`
with `git_probe.resolve`, choosing the deepest match across cwd and common repository
root; ties retain cwd. These private read-only functions are isolated in `compat.py`
and pinned by source/behavior tests. Unknown/incompatible runtime imports fail closed.
Project CRUD continues to use `hermes_cli.projects_db`, never SQL in the plugin.

The frontend compares this metadata with `projects.list` on the exact selected SDK
route and checks `projects.for_cwd` there. It checks again after creation before
opening, so changed membership leaves a recoverable empty session instead of silently
opening the wrong project. There is no native atomic validate-and-create operation;
folder edits after validation can still regroup sessions. The session schema has no
immutable project foreign key. No compaction-stable ownership guarantee is claimed.

Creation is limited to local routes on the serving host, including named profiles.
Remote Desktop routes fail explicitly: a plugin REST host cannot be assumed to share
a remote gateway's filesystem or authenticated authority. Desktop Electron and
SSH/multiple-connection environments are not browser-tested. Unavailable, ambiguous,
removed or replaced routes cannot silently fall back to another profile. Project
session reads and existing-session opens also use exact SDK routes.

## Retry receipts and navigation

Before calling session.create the plugin persists a per-tab sessionStorage receipt,
keyed by connection/profile/project, containing only operation identity, route and
frozen creation parameters. If storage is unavailable, creation is not attempted.
A module-level lock handles duplicate mounted actions/clicks. Uncertain failures and
missing stored IDs retain the request; retry reuses its arguments. A known result is
saved before opening and retried without another create. Receipts survive reload;
a successful open with `awaitHydration: true` retires them. Hydration rejection or
timeout retains the stored ID and retries without another create. Closing the tab or clearing storage loses local
recovery information, not the persisted native session.

Route, connection and active-profile changes are tracked during the operation,
including leaving and returning. A change before admission cancels creation; a change
after create admission but before SDK open admission retains the result without
redirecting the user. Returning to project
details offers Retry / Open saved chat. The result is revalidated before explicit
recovery. A late failure does not erase drafts or submit a message. Receipts are not
a second session/project ownership database or an exactly-once guarantee for separate
intentional new actions across independent tabs.

### SDK open admission limitation

Audited `apps/desktop/src/sdk/index.ts`, `PluginOpenSessionOptions` and `host.openSession`:
`awaitHydration` bounds profile activation and then waits for native surface hydration.
Its `openingStillCurrent()` checks an internal SDK generation (incremented by another
SDK open), with an extra scope guard only for the bots workspace. Ordinary hash,
profile or connection changes do not increment that generation. The SDK awaits
`openGatewayForAgent` before native navigation. There is no AbortSignal or public
caller fence in the options. A user navigating during that await can therefore have
their foreground displaced. The regression test models this exact admitted-open
ordering and deliberately records the limitation; it does not claim prevention.
`refreshInPlace` never opens a new off-screen session and cannot implement this action.
No core edits, bots-scope impersonation, private stores, restoration redirects or
DOM interception are used. Fixing this fully requires a supported host cancellation
or navigation-generation contract. Browser fault coverage of this exact SDK dial
interval is not claimed.

### Explicit receipt retirement

A stale, corrupt, archived-project or replaced-route receipt remains recoverable until
an explicit confirmed **Forget saved request** action retires it. Retirement is scoped
to this tab's connection/profile/project key and blocked while that operation holds
its lock. It only removes local storage; no native RPC, deletion or automatic creation
occurs. The confirmation warns that a session may already exist and a later new-chat
action can create another. This is a deliberate new intent, never an automatic retry
with a different identity. Workspace, native membership and authorization checks
remain required for all subsequent creation/recovery.

Project-save completion uses a sticky hash/profile/connection fence and an unmount
operation generation. Leaving and returning invalidates success navigation and errors.

## Original draft-first contract remains unsupported

`app/chat/composer/contrib.ts` exposes only text and attachments. The middleware submit
hook drops composerScope and submission_id. Exceptions deliberately pass through in
Hermes. SDK draft setters do not offer atomic compare-and-retire of text/attachments.
Those are blockers for safe draft-first interception, not for create-first creation.

The old `/handoffs` endpoint still refuses with 501 before any native work and now
explains the supported alternative. The legacy indicator resolves manually entered
`/#/?project=...` URLs and directs users to Projects. Its synchronous fail-closed guard
continues blocking all mounted composers on that unsupported URL; selective origin
identification is not possible. Ordinary drafts/existing-session routes pass through.
The supported create-first flow never generates a project draft URL and never runs
first-send interception. Clearing a legacy URL can reset the visible native editor;
the indicator tells users to copy needed text first. No DOM or private store hacks.

## Listings and refresh

Native `projects.project_sessions` / `projects.tree` are independent of the renderer's
recent-session cache. Their source set is limited; there is no pagination contract.
The plugin requests 5,000 eligible sessions and discloses exclusions/limits. Empty
sessions persist immediately but are absent from the native project tree until sent.

Cold-refresh project URLs and data persist, but the shell can front a restored chat
tile after asynchronous plugin registration. `app/contrib/wiring.tsx` reveals contributed
routes on pathname changes, while native tile restoration can happen later. Reopen
Projects, then select the project if the list appears. The browser suite covers both
possible restored foregrounds. No polling, navigation takeover, private store mutation
or guaranteed cold-refresh foreground behavior is claimed.

See [validation](validation.md) for actual results, screenshots and remaining gaps.
