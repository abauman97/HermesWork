import {
  host,
  type PluginContext,
  type PluginProfileRoute,
} from "@hermes/plugin-sdk";
import type { Project } from "./logic";
import { watchNavigation } from "./navigation";

interface Receipt {
  route: PluginProfileRoute;
  projectId: string;
  params: {
    request_id: string;
    source: "desktop";
    cwd: string;
    cwd_explicit: true;
    profile: string;
  };
  sessionId?: string;
}
const locks = new Set<string>();
// getRandomValues also works on private HTTP Webapp hosts where randomUUID is absent.
function requestIdentity() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
const prefix = "hermes-projects:create:v1:";
export function receiptKey(
  connection: string,
  profile: string,
  projectId: string,
) {
  return prefix + JSON.stringify([connection, profile, projectId]);
}
export function hasReceipt(
  connection: string,
  profile: string,
  projectId: string,
) {
  try {
    return (
      sessionStorage.getItem(receiptKey(connection, profile, projectId)) !==
      null
    );
  } catch {
    return false;
  }
}
/** Explicitly retire local recovery only; never creates or deletes a native session. */
export function forgetReceipt(
  connection: string,
  profile: string,
  projectId: string,
) {
  const key = receiptKey(connection, profile, projectId);
  if (locks.has(key))
    throw new Error(
      "Wait for the saved request to finish before forgetting it",
    );
  sessionStorage.removeItem(key);
}
export async function projectProfileRoute(profile: string) {
  const connection = host.state.connectionId.get();
  const routes = await host.profileRoutes();
  const matches = routes.filter(
    (r) => r.connectionId === connection && r.profile === profile,
  );
  if (matches.length !== 1)
    throw new Error("The selected profile has no unique connection route");
  return matches[0];
}
export async function projectRequest<T>(
  profile: string,
  method: string,
  params: Record<string, unknown>,
) {
  return host.requestProfile<T>(
    await projectProfileRoute(profile),
    method,
    params,
  );
}
export async function openProjectSession(id: string, profile: string) {
  await host.openSession(id, {
    profile,
    route: await projectProfileRoute(profile),
  });
}
function sameRoute(a: PluginProfileRoute, b: PluginProfileRoute) {
  return (
    a.connectionId === b.connectionId &&
    a.profile === b.profile &&
    a.targetProfile === b.targetProfile &&
    a.mode === b.mode
  );
}
async function validateWorkspace(
  ctx: PluginContext,
  target: PluginProfileRoute,
  projectId: string,
  cwd?: string,
) {
  // ctx.rest is tied to this serving host. Cross-check its record against the
  // exact gateway before creating; never trust an ID/name from another source.
  const prepared = await ctx.rest<{ project: Project; cwd: string }>(
    `/projects/${encodeURIComponent(projectId)}/prepare-chat?profile=${encodeURIComponent(target.targetProfile)}`,
    {
      method: "POST",
      body: { ...(cwd ? { cwd } : {}) },
    },
  );
  const native = await host.requestProfile<{ projects: Project[] }>(
    target,
    "projects.list",
    {},
  );
  const selected = native.projects.find((p) => p.id === projectId);
  if (
    !selected ||
    selected.archived ||
    selected.primary_path !== prepared.project.primary_path ||
    JSON.stringify(selected.folders) !==
      JSON.stringify(prepared.project.folders)
  )
    throw new Error(
      "Project metadata differs on the selected gateway; refresh before creating a chat",
    );
  const match = await host.requestProfile<{ project: Project | null }>(
    target,
    "projects.for_cwd",
    { cwd: prepared.cwd },
  );
  if (match.project?.id !== projectId)
    throw new Error(
      "Workspace matches another project on the selected gateway",
    );

  return prepared;
}
/** A receipt is only an operation identity and frozen create arguments, never ownership data.
 * Persist BEFORE RPC admission; every uncertain retry uses that same identity, including reload.
 */
export async function createProjectChat(
  ctx: PluginContext,
  projectId: string,
  profile: string,
) {
  const connection = host.state.connectionId.get();
  if (!connection) throw new Error("No active Hermes connection");
  const key = receiptKey(connection, profile, projectId);
  if (locks.has(key)) return;
  locks.add(key);
  const navigation = watchNavigation();
  let recoveryExists = false;
  try {
    const routes = await host.profileRoutes();
    const matches = routes.filter(
      (r) => r.connectionId === connection && r.profile === profile,
    );
    if (matches.length !== 1)
      throw new Error("The selected profile has no unique connection route");
    const target = matches[0];
    if (target.mode !== "local")
      throw new Error(
        "Workspace validation is available only on the serving host's local connection",
      );
    let receipt: Receipt | undefined;
    const saved = sessionStorage.getItem(key);
    recoveryExists = saved !== null;
    if (saved !== null) {
      receipt = JSON.parse(saved) as Receipt;
      if (
        !sameRoute(receipt.route, target) ||
        receipt.projectId !== projectId ||
        !receipt.params.request_id ||
        receipt.params.profile !== target.targetProfile ||
        receipt.params.source !== "desktop" ||
        receipt.params.cwd_explicit !== true ||
        !receipt.params.cwd
      )
        throw new Error(
          "Saved chat request no longer matches this profile route",
        );
    }
    if (!receipt?.sessionId) {
      const prepared = await validateWorkspace(
        ctx,
        target,
        projectId,
        receipt?.params.cwd,
      );
      if (receipt && prepared.cwd !== receipt.params.cwd)
        throw new Error(
          "Workspace changed; the saved request cannot be changed on retry",
        );
      if (!navigation.current()) return;
      if (!receipt) {
        receipt = {
          route: { ...target },
          projectId,
          params: {
            request_id: requestIdentity(),
            source: "desktop",
            cwd: prepared.cwd,
            cwd_explicit: true,
            profile: target.targetProfile,
          },
        };
        sessionStorage.setItem(key, JSON.stringify(receipt));
        recoveryExists = true;
      }
      const result = await host.requestProfile<{ stored_session_id?: string }>(
        receipt.route,
        "session.create",
        { ...receipt.params },
      );
      if (
        typeof result.stored_session_id !== "string" ||
        !result.stored_session_id.trim()
      )
        throw new Error(
          "Hermes did not return a stored session ID. Retry this saved request to recover it",
        );
      receipt.sessionId = result.stored_session_id;
      sessionStorage.setItem(key, JSON.stringify(receipt));
    }
    // Membership can change while create is in flight. Recheck before opening;
    // a failure retains the empty session receipt for explicit recovery.
    await validateWorkspace(ctx, receipt.route, projectId, receipt.params.cwd);
    // A route edit/removal cannot grant permission to open an old result.
    if (!(await host.profileRoutes()).some((r) => sameRoute(r, receipt.route)))
      throw new Error(
        "Connection route changed; the saved chat remains recoverable on its original route",
      );
    if (!navigation.current()) return;
    // SDK has no cancellation/fence option once activation starts. See runtime audit.
    // Await native hydration; any rejection keeps the stored identity recoverable.
    await host.openSession(receipt.sessionId!, {
      profile,
      route: receipt.route,
      awaitHydration: true,
    });
    sessionStorage.removeItem(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message +
        (recoveryExists
          ? " · A session may already exist. Retry / Open saved chat reuses this request and will not create another."
          : " · No session creation was attempted."),
      { cause: error },
    );
  } finally {
    navigation.dispose();
    locks.delete(key);
  }
}
