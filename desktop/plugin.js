// src/plugin.tsx
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  host as host3,
  useValue,
  SIDEBAR_NAV_AREA,
  ROUTES_AREA,
  COMPOSER_AREAS
} from "@hermes/plugin-sdk";

// src/logic.ts
function route(hash) {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  return {
    path: path || "/",
    project: params.get("project"),
    profile: params.get("profile"),
    hasProject: params.has("project")
  };
}
function projectRoute(id, profile) {
  return `/projects?${new URLSearchParams({ project: id, profile })}`;
}
function sessions(tree) {
  const rows = [
    ...tree?.previewSessions ?? [],
    ...(tree?.repos ?? []).flatMap(
      (r) => (r.groups ?? []).flatMap((g) => g.sessions ?? [])
    )
  ];
  return [...new Map(rows.map((s) => [s.id, s])).values()].sort(
    (a, b) => (b.last_active ?? 0) - (a.last_active ?? 0)
  );
}
function guardDraft(hash, draft) {
  try {
    const current = route(hash);
    return current.path === "/" && current.hasProject ? null : draft;
  } catch {
    return null;
  }
}

// src/chat.ts
import {
  host as host2
} from "@hermes/plugin-sdk";

// src/navigation.ts
import { host } from "@hermes/plugin-sdk";
function watchNavigation() {
  const hash = window.location.hash;
  const profile = host.state.profile.get();
  const connection = host.state.connectionId.get();
  let changed = false;
  const mark = () => {
    changed = true;
  };
  window.addEventListener("hashchange", mark);
  function track(atom) {
    let initial = true;
    return atom.subscribe(() => {
      if (!initial) mark();
      initial = false;
    });
  }
  const unsubProfile = track(host.state.profile);
  const unsubConnection = track(host.state.connectionId);
  return {
    current: () => !changed && window.location.hash === hash && host.state.profile.get() === profile && host.state.connectionId.get() === connection,
    dispose: () => {
      window.removeEventListener("hashchange", mark);
      unsubProfile();
      unsubConnection();
    }
  };
}

// src/chat.ts
var locks = /* @__PURE__ */ new Set();
function requestIdentity() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    ""
  );
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}
var prefix = "hermes-projects:create:v1:";
function receiptKey(connection, profile, projectId) {
  return prefix + JSON.stringify([connection, profile, projectId]);
}
function hasReceipt(connection, profile, projectId) {
  try {
    return sessionStorage.getItem(receiptKey(connection, profile, projectId)) !== null;
  } catch {
    return false;
  }
}
function forgetReceipt(connection, profile, projectId) {
  const key = receiptKey(connection, profile, projectId);
  if (locks.has(key))
    throw new Error(
      "Wait for the saved request to finish before forgetting it"
    );
  sessionStorage.removeItem(key);
}
async function projectProfileRoute(profile) {
  const connection = host2.state.connectionId.get();
  const routes = await host2.profileRoutes();
  const matches = routes.filter(
    (r) => r.connectionId === connection && r.profile === profile
  );
  if (matches.length !== 1)
    throw new Error("The selected profile has no unique connection route");
  return matches[0];
}
async function projectRequest(profile, method, params) {
  return host2.requestProfile(
    await projectProfileRoute(profile),
    method,
    params
  );
}
async function openProjectSession(id, profile) {
  await host2.openSession(id, {
    profile,
    route: await projectProfileRoute(profile)
  });
}
function sameRoute(a, b) {
  return a.connectionId === b.connectionId && a.profile === b.profile && a.targetProfile === b.targetProfile && a.mode === b.mode;
}
async function validateWorkspace(ctx, target, projectId, cwd) {
  const prepared = await ctx.rest(
    `/projects/${encodeURIComponent(projectId)}/prepare-chat?profile=${encodeURIComponent(target.targetProfile)}`,
    {
      method: "POST",
      body: { ...cwd ? { cwd } : {} }
    }
  );
  const native = await host2.requestProfile(
    target,
    "projects.list",
    {}
  );
  const selected = native.projects.find((p) => p.id === projectId);
  if (!selected || selected.archived || selected.primary_path !== prepared.project.primary_path || JSON.stringify(selected.folders) !== JSON.stringify(prepared.project.folders))
    throw new Error(
      "Project metadata differs on the selected gateway; refresh before creating a chat"
    );
  const match = await host2.requestProfile(
    target,
    "projects.for_cwd",
    { cwd: prepared.cwd }
  );
  if (match.project?.id !== projectId)
    throw new Error(
      "Workspace matches another project on the selected gateway"
    );
  return prepared;
}
async function createProjectChat(ctx, projectId, profile) {
  const connection = host2.state.connectionId.get();
  if (!connection) throw new Error("No active Hermes connection");
  const key = receiptKey(connection, profile, projectId);
  if (locks.has(key)) return;
  locks.add(key);
  const navigation = watchNavigation();
  let recoveryExists = false;
  try {
    const routes = await host2.profileRoutes();
    const matches = routes.filter(
      (r) => r.connectionId === connection && r.profile === profile
    );
    if (matches.length !== 1)
      throw new Error("The selected profile has no unique connection route");
    const target = matches[0];
    if (target.mode !== "local")
      throw new Error(
        "Workspace validation is available only on the serving host's local connection"
      );
    let receipt;
    const saved = sessionStorage.getItem(key);
    recoveryExists = saved !== null;
    if (saved !== null) {
      receipt = JSON.parse(saved);
      if (!sameRoute(receipt.route, target) || receipt.projectId !== projectId || !receipt.params.request_id || receipt.params.profile !== target.targetProfile || receipt.params.source !== "desktop" || receipt.params.cwd_explicit !== true || !receipt.params.cwd)
        throw new Error(
          "Saved chat request no longer matches this profile route"
        );
    }
    if (!receipt?.sessionId) {
      const prepared = await validateWorkspace(
        ctx,
        target,
        projectId,
        receipt?.params.cwd
      );
      if (receipt && prepared.cwd !== receipt.params.cwd)
        throw new Error(
          "Workspace changed; the saved request cannot be changed on retry"
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
            profile: target.targetProfile
          }
        };
        sessionStorage.setItem(key, JSON.stringify(receipt));
        recoveryExists = true;
      }
      const result = await host2.requestProfile(
        receipt.route,
        "session.create",
        { ...receipt.params }
      );
      if (typeof result.stored_session_id !== "string" || !result.stored_session_id.trim())
        throw new Error(
          "Hermes did not return a stored session ID. Retry this saved request to recover it"
        );
      receipt.sessionId = result.stored_session_id;
      sessionStorage.setItem(key, JSON.stringify(receipt));
    }
    await validateWorkspace(ctx, receipt.route, projectId, receipt.params.cwd);
    if (!(await host2.profileRoutes()).some((r) => sameRoute(r, receipt.route)))
      throw new Error(
        "Connection route changed; the saved chat remains recoverable on its original route"
      );
    if (!navigation.current()) return;
    await host2.openSession(receipt.sessionId, {
      profile,
      route: receipt.route,
      awaitHydration: true
    });
    sessionStorage.removeItem(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      message + (recoveryExists ? " \xB7 A session may already exist. Retry / Open saved chat reuses this request and will not create another." : " \xB7 No session creation was attempted."),
      { cause: error }
    );
  } finally {
    navigation.dispose();
    locks.delete(key);
  }
}

// src/styles.ts
var styles = `
.hermes-projects { box-sizing: border-box; height: 100%; min-width: 0; font-size: 12px; line-height: 1.5; color: var(--ui-text-primary); background: var(--ui-bg-editor); }
.hermes-projects h1 { font-size: 18px; line-height: 24px; font-weight: 600; margin: 0; margin-right: auto; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.hermes-projects h2 { font-size: 13px; font-weight: 600; margin: 16px 0 0; }
.hermes-projects p { margin: 0; color: var(--ui-text-secondary); overflow-wrap: anywhere; }
.hermes-projects [role=alert] { color: var(--ui-text-primary); border-left: 2px solid var(--ui-text-tertiary); padding-left: 12px; }
.hermes-projects header { padding-bottom: 16px; border-bottom: 1px solid var(--ui-stroke-secondary); }
.hermes-projects header span, .hermes-projects small { color: var(--ui-text-tertiary); font-size: 11px; }
.hermes-projects label { display: flex; flex-direction: column; gap: 6px; color: var(--ui-text-secondary); }
.hermes-projects form { max-width: 640px; }
.hermes-projects form > button { margin-top: 12px; }
.hermes-projects ul { padding: 0; list-style: none; margin: 0; }
.hermes-projects li { padding: 10px 0; border-bottom: 1px solid var(--ui-stroke-secondary); overflow-wrap: anywhere; }
.hermes-projects article { min-width: 0; }
.hermes-projects button { max-width: 100%; min-width: 0; white-space: normal; height: auto; min-height: 28px; overflow-wrap: anywhere; }
.hermes-projects article button { text-align: left; }
.hermes-projects header span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 600px) {
.hermes-projects header h1 { width: 100%; }
.hermes-projects button { white-space: normal; min-height: 32px; }
.hermes-projects article button { text-align: left; max-width: 100%; overflow-wrap: anywhere; }
.hermes-projects form, .hermes-projects label { width: 100%; min-width: 0; }
}
`;

// src/plugin.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function useRoute() {
  const [hash, set] = useState(window.location.hash);
  useEffect(() => {
    const changed = () => set(window.location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route(hash);
}
function scoped(ctx, profile) {
  return (path, options) => ctx.rest(
    `${path}${path.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profile)}`,
    options
  );
}
var errorText = (e) => e instanceof Error ? e.message : String(e);
function Page({ ctx }) {
  const current = useRoute();
  const active = useValue(host3.state.profile);
  const connection = useValue(host3.state.connectionId);
  const profile = current.profile || active || "default";
  const [projects, setProjects] = useState([]);
  const [overview, setOverview] = useState({});
  const [overviewError, setOverviewError] = useState("");
  const operationLock = useRef(false);
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("name");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const saveGeneration = useRef(0);
  useEffect(
    () => () => {
      saveGeneration.current++;
    },
    []
  );
  const project = projects.find((p) => p.id === current.project);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setProjects([]);
    setError("");
    setTree(null);
    setEditing(null);
    setConfirmDelete(false);
    setConfirmForget(false);
    scoped(
      ctx,
      profile
    )("/projects").then((result) => {
      if (live) setProjects(result.projects);
    }).catch((e) => {
      if (live) setError(errorText(e));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [ctx, profile, connection, current.project, revision]);
  useEffect(() => {
    let live = true;
    setOverview({});
    setOverviewError("");
    if (!current.project)
      projectRequest(
        profile,
        "projects.tree",
        {
          profile,
          session_limit: 5e3,
          preview_limit: 1
        }
      ).then((r) => {
        if (live)
          setOverview(Object.fromEntries(r.projects.map((p) => [p.id, p])));
      }).catch((e) => {
        if (live) setOverviewError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [current.project, profile, connection, revision]);
  const [sessionError, setSessionError] = useState("");
  useEffect(() => {
    let live = true;
    setSessionError("");
    if (current.project)
      projectRequest(
        profile,
        "projects.project_sessions",
        {
          project_id: current.project,
          profile,
          session_limit: 5e3
        }
      ).then((result) => {
        if (live) setTree(result.project);
      }).catch((e) => {
        if (live) setSessionError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [current.project, profile, connection, revision]);
  async function action(path, method = "POST", body) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true);
    setError("");
    try {
      await scoped(ctx, profile)(path, { method, body });
      refresh((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }
  return /* @__PURE__ */ jsxs(
    "main",
    {
      className: "hermes-projects",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "24px clamp(16px, 4vw, 40px)",
        maxWidth: 960,
        margin: "0 auto",
        width: "100%",
        overflowY: "auto",
        color: "var(--ui-text-primary)"
      },
      children: [
        /* @__PURE__ */ jsx("style", { children: styles }),
        /* @__PURE__ */ jsxs(
          "header",
          {
            style: {
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap"
            },
            children: [
              /* @__PURE__ */ jsx("h1", { children: current.project ? project?.name || "Project details" : "Projects" }),
              /* @__PURE__ */ jsxs("span", { children: [
                "Profile: ",
                profile
              ] }),
              /* @__PURE__ */ jsx(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  onClick: () => refresh((n) => n + 1),
                  disabled: busy,
                  children: "Refresh"
                }
              ),
              /* @__PURE__ */ jsx(Button, { variant: "outline", size: "sm", onClick: () => host3.navigate("/"), children: "Back to chat" }),
              current.project && /* @__PURE__ */ jsx(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  onClick: () => host3.navigate(`/projects?${new URLSearchParams({ profile })}`),
                  children: "All projects"
                }
              )
            ]
          }
        ),
        error && /* @__PURE__ */ jsx("p", { role: "alert", children: error }),
        loading ? /* @__PURE__ */ jsx("p", { role: "status", children: "Loading projects\u2026" }) : current.project ? project ? /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("p", { children: project.description || "No description" }),
          /* @__PURE__ */ jsxs("p", { children: [
            "Workspace: ",
            project.primary_path || "No primary folder"
          ] }),
          /* @__PURE__ */ jsxs("p", { children: [
            "Slug: ",
            project.slug,
            " \xB7 ",
            project.archived ? "Archived" : "Active"
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "default",
                size: "sm",
                disabled: busy || project.archived,
                onClick: () => {
                  const originHash = window.location.hash;
                  const originProfile = host3.state.profile.get();
                  const originConnection = host3.state.connectionId.get();
                  setBusy(true);
                  setError("");
                  void createProjectChat(ctx, project.id, profile).catch((e) => {
                    if (window.location.hash === originHash && host3.state.profile.get() === originProfile && host3.state.connectionId.get() === originConnection)
                      setError(errorText(e));
                  }).finally(() => setBusy(false));
                },
                children: connection && hasReceipt(connection, profile, project.id) ? "Retry / Open saved chat" : "New Project Chat"
              }
            ),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                onClick: () => setEditing(project),
                disabled: busy,
                children: "Edit Project"
              }
            ),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy,
                onClick: () => void action(
                  `/projects/${project.id}/archive?restore=${project.archived}`
                ),
                children: project.archived ? "Restore Project" : "Archive Project"
              }
            ),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                onClick: () => setConfirmDelete(true),
                disabled: busy,
                children: "Delete Project"
              }
            )
          ] }),
          /* @__PURE__ */ jsx("p", { role: "note", children: "Creates and saves an empty session immediately, then opens the native composer. Models and attachments stay native. Project membership follows workspace folders; moving folders or adding nested projects can regroup chats. Empty chats appear here after their first message." }),
          connection && hasReceipt(connection, profile, project.id) && /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy,
                onClick: () => setConfirmForget(true),
                children: "Forget saved request"
              }
            ),
            confirmForget && /* @__PURE__ */ jsxs(
              "div",
              {
                role: "alertdialog",
                "aria-label": "Forget saved request confirmation",
                children: [
                  /* @__PURE__ */ jsx("p", { children: "A native chat may already exist, even if no result was received. Forgetting removes only this tab's recovery receipt. It does not delete that chat. A later New Project Chat can create another session. Check native history before starting again." }),
                  /* @__PURE__ */ jsx(
                    Button,
                    {
                      variant: "outline",
                      size: "sm",
                      disabled: busy,
                      onClick: () => {
                        try {
                          forgetReceipt(connection, profile, project.id);
                          setConfirmForget(false);
                          setError("");
                          refresh((n) => n + 1);
                        } catch (e) {
                          setError(errorText(e));
                        }
                      },
                      children: "Confirm forget saved request"
                    }
                  ),
                  /* @__PURE__ */ jsx(
                    Button,
                    {
                      variant: "outline",
                      size: "sm",
                      onClick: () => setConfirmForget(false),
                      children: "Keep saved request"
                    }
                  )
                ]
              }
            )
          ] }),
          confirmDelete && /* @__PURE__ */ jsxs("div", { role: "alertdialog", "aria-label": "Delete project confirmation", children: [
            /* @__PURE__ */ jsxs("p", { children: [
              "Delete ",
              project.name,
              "? Native sessions and workspace files remain. Workspace grouping will change."
            ] }),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy,
                onClick: () => void action(`/projects/${project.id}`, "DELETE").then(
                  () => setConfirmDelete(false)
                ),
                children: "Confirm delete"
              }
            ),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                onClick: () => setConfirmDelete(false),
                children: "Cancel"
              }
            )
          ] }),
          /* @__PURE__ */ jsx("h2", { children: "Workspace folders" }),
          /* @__PURE__ */ jsx("ul", { children: project.folders.map((f) => /* @__PURE__ */ jsxs("li", { children: [
            f.path,
            " ",
            f.is_primary && "(primary)",
            " ",
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy || f.is_primary,
                onClick: () => void action(`/projects/${project.id}/folders`, "POST", {
                  action: "primary",
                  path: f.path
                }),
                children: "Make primary"
              }
            ),
            " ",
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "outline",
                size: "sm",
                disabled: busy,
                onClick: () => void action(`/projects/${project.id}/folders`, "POST", {
                  action: "remove",
                  path: f.path
                }),
                children: "Remove folder"
              }
            )
          ] }, f.path)) }),
          /* @__PURE__ */ jsxs(
            "form",
            {
              onSubmit: (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void action(`/projects/${project.id}/folders`, "POST", {
                  action: "add",
                  path: form.get("path")
                });
              },
              children: [
                /* @__PURE__ */ jsxs("label", { children: [
                  "Add workspace folder",
                  " ",
                  /* @__PURE__ */ jsx(Input, { name: "path", required: true, placeholder: "/absolute/host/path" })
                ] }),
                /* @__PURE__ */ jsx(Button, { variant: "outline", size: "sm", disabled: busy, children: "Add folder" })
              ]
            }
          ),
          /* @__PURE__ */ jsx("h2", { children: "Associated sessions" }),
          /* @__PURE__ */ jsx("p", { children: "Native workspace grouping; latest 5,000 eligible sessions in this profile. Hermes exposes no pagination for this view. Empty, archived and automation sessions may be omitted." }),
          sessionError && /* @__PURE__ */ jsxs("p", { role: "alert", children: [
            "Sessions unavailable: ",
            sessionError
          ] }),
          !sessionError && sessions(tree).length === 0 && /* @__PURE__ */ jsx("p", { children: "No associated sessions returned." }),
          sessions(tree).map((s) => /* @__PURE__ */ jsxs(
            "article",
            {
              style: {
                borderBottom: "1px solid var(--ui-stroke-secondary)",
                padding: 10
              },
              children: [
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    variant: "outline",
                    size: "sm",
                    onClick: () => void openProjectSession(s.id, profile).catch(
                      (e) => setError(errorText(e))
                    ),
                    children: s.title || "Untitled session"
                  }
                ),
                " ",
                /* @__PURE__ */ jsxs("span", { children: [
                  s.message_count ?? 0,
                  " messages \xB7",
                  " ",
                  s.last_active ? new Date(s.last_active * 1e3).toLocaleString() : "No activity",
                  s.is_active ? " \xB7 Active" : ""
                ] })
              ]
            },
            s.id
          ))
        ] }) : /* @__PURE__ */ jsxs("p", { role: "alert", children: [
          "Project not found in profile ",
          profile,
          ". It may have been deleted."
        ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx("p", { children: "Manage native Hermes workspaces and browse their conversations." }),
          /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                margin: "18px 0"
              },
              children: [
                /* @__PURE__ */ jsx(
                  Button,
                  {
                    variant: "default",
                    size: "sm",
                    onClick: () => setEditing("new"),
                    children: "Create Project"
                  }
                ),
                /* @__PURE__ */ jsxs("label", { children: [
                  "Search projects",
                  " ",
                  /* @__PURE__ */ jsx(
                    Input,
                    {
                      value: search,
                      onChange: (e) => setSearch(e.target.value)
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxs("label", { children: [
                  "Order",
                  " ",
                  /* @__PURE__ */ jsxs(Select, { value: order, onValueChange: setOrder, children: [
                    /* @__PURE__ */ jsx(SelectTrigger, { "aria-label": "Order", children: /* @__PURE__ */ jsx(SelectValue, {}) }),
                    /* @__PURE__ */ jsxs(SelectContent, { children: [
                      /* @__PURE__ */ jsx(SelectItem, { value: "name", children: "Name" }),
                      /* @__PURE__ */ jsx(SelectItem, { value: "recent", children: "Newest" })
                    ] })
                  ] })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ jsx("p", { children: "Session counts and activity use native workspace grouping over the latest 5,000 eligible profile sessions; they are not lifetime totals." }),
          overviewError && /* @__PURE__ */ jsxs("p", { role: "alert", children: [
            "Activity unavailable: ",
            overviewError
          ] }),
          projects.length === 0 && /* @__PURE__ */ jsx("p", { children: "No projects yet. Create a project to get started." }),
          projects.filter(
            (p) => `${p.name} ${p.description || ""} ${p.primary_path || ""}`.toLowerCase().includes(search.toLowerCase())
          ).sort(
            (a, b) => order === "name" ? a.name.localeCompare(b.name) : b.created_at - a.created_at
          ).map((p) => /* @__PURE__ */ jsxs(
            "article",
            {
              style: {
                padding: 18,
                borderBottom: "1px solid var(--ui-stroke-secondary)",
                borderRadius: 0,
                marginBottom: 0
              },
              children: [
                /* @__PURE__ */ jsxs("h2", { style: { fontSize: 18 }, children: [
                  /* @__PURE__ */ jsx(
                    Button,
                    {
                      variant: "outline",
                      size: "sm",
                      onClick: () => host3.navigate(projectRoute(p.id, profile)),
                      children: p.name
                    }
                  ),
                  " ",
                  p.archived && /* @__PURE__ */ jsx("small", { children: "Archived" })
                ] }),
                /* @__PURE__ */ jsx("p", { children: p.description || "No description" }),
                /* @__PURE__ */ jsxs("p", { children: [
                  p.primary_path || "No primary workspace",
                  " \xB7",
                  " ",
                  p.folders.length,
                  " folders",
                  overview[p.id] && /* @__PURE__ */ jsxs(Fragment, { children: [
                    " ",
                    "\xB7 ",
                    overview[p.id].sessionCount ?? 0,
                    " sessions \xB7",
                    " ",
                    overview[p.id].lastActive ? new Date(
                      overview[p.id].lastActive * 1e3
                    ).toLocaleString() : "No recent activity"
                  ] })
                ] }),
                /* @__PURE__ */ jsxs("small", { children: [
                  "Created ",
                  new Date(p.created_at * 1e3).toLocaleDateString(),
                  " \xB7",
                  " ",
                  profile
                ] })
              ]
            },
            p.id
          )),
          projects.length > 0 && !projects.some(
            (p) => `${p.name} ${p.description || ""} ${p.primary_path || ""}`.toLowerCase().includes(search.toLowerCase())
          ) && /* @__PURE__ */ jsx("p", { children: "No matching projects." })
        ] }),
        editing && /* @__PURE__ */ jsx(
          Editor,
          {
            project: editing === "new" ? null : editing,
            busy,
            cancel: () => setEditing(null),
            save: async (body) => {
              if (operationLock.current) return;
              operationLock.current = true;
              const navigation = watchNavigation();
              const generation = ++saveGeneration.current;
              const currentSave = () => navigation.current() && generation === saveGeneration.current;
              setBusy(true);
              setError("");
              try {
                const result = await scoped(ctx, profile)(
                  editing === "new" ? "/projects" : `/projects/${editing.id}`,
                  { method: editing === "new" ? "POST" : "PATCH", body }
                );
                if (!currentSave()) return;
                setEditing(null);
                host3.navigate(projectRoute(result.project.id, profile));
                refresh((n) => n + 1);
              } catch (e) {
                if (currentSave()) setError(errorText(e));
              } finally {
                navigation.dispose();
                operationLock.current = false;
                if (generation === saveGeneration.current) setBusy(false);
              }
            }
          },
          editing === "new" ? "new" : editing.id
        )
      ]
    }
  );
}
function Editor({
  project,
  busy,
  save,
  cancel
}) {
  return /* @__PURE__ */ jsxs(
    "form",
    {
      "aria-label": project ? "Edit project" : "Create project",
      onSubmit: (e) => {
        e.preventDefault();
        const body = Object.fromEntries(
          new FormData(e.currentTarget)
        );
        void save(body);
      },
      style: {
        padding: 20,
        border: "1px solid var(--ui-stroke-secondary)",
        marginTop: 20
      },
      children: [
        /* @__PURE__ */ jsx("h2", { children: project ? "Edit Project" : "Create Project" }),
        [
          "name",
          "description",
          ...project ? [] : ["primary_path"],
          "icon",
          "color",
          "board_slug"
        ].map((key) => /* @__PURE__ */ jsxs("label", { style: { display: "block", marginBottom: 12 }, children: [
          {
            name: "Name",
            description: "Description",
            primary_path: "Workspace directory",
            icon: "Icon",
            color: "Color",
            board_slug: "Board slug"
          }[key],
          " ",
          /* @__PURE__ */ jsx(
            Input,
            {
              name: key,
              required: key === "name" || key === "primary_path",
              defaultValue: project?.[key] || "",
              style: { width: "100%" }
            }
          )
        ] }, key)),
        /* @__PURE__ */ jsx(Button, { variant: "default", size: "sm", disabled: busy, children: "Save Project" }),
        " ",
        /* @__PURE__ */ jsx(
          Button,
          {
            variant: "outline",
            size: "sm",
            type: "button",
            onClick: cancel,
            disabled: busy,
            children: "Cancel"
          }
        )
      ]
    }
  );
}
function Indicator({ ctx }) {
  const current = useRoute();
  const active = useValue(host3.state.profile);
  const profile = current.profile || active || "default";
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setProject(null);
    setError("");
    if (current.path === "/" && current.hasProject)
      scoped(
        ctx,
        profile
      )(
        `/projects/${encodeURIComponent(current.project || "invalid")}`
      ).then((r) => {
        if (live) setProject(r.project);
      }).catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [ctx, current.path, current.project, current.hasProject, profile]);
  if (current.path !== "/" || !current.hasProject) return null;
  return /* @__PURE__ */ jsxs(
    "aside",
    {
      role: "alert",
      style: { padding: 10, border: "1px solid var(--ui-stroke-secondary)" },
      children: [
        /* @__PURE__ */ jsx("strong", { children: project?.name || "Project draft unavailable" }),
        " \xB7",
        " ",
        profile,
        " ",
        project?.primary_path,
        /* @__PURE__ */ jsxs("p", { children: [
          error || "This legacy draft URL cannot create a project chat. Open Projects and use New Project Chat.",
          " ",
          "Sending is blocked on every composer while this project draft URL is active."
        ] }),
        /* @__PURE__ */ jsx("p", { children: "Clear project opens a normal draft. Hermes may reset the editor; copy any text you want to keep first." }),
        /* @__PURE__ */ jsx(Button, { variant: "outline", size: "sm", onClick: () => host3.navigate("/"), children: "Clear project" })
      ]
    }
  );
}
var plugin_default = {
  id: "hermes-projects",
  name: "Projects",
  register(ctx) {
    ctx.register({
      id: "nav",
      area: SIDEBAR_NAV_AREA,
      data: { path: "/projects", label: "Projects", codicon: "project" }
    });
    ctx.register({
      id: "page",
      area: ROUTES_AREA,
      title: "Projects",
      data: { path: "/projects" },
      render: () => /* @__PURE__ */ jsx(Page, { ctx })
    });
    ctx.register({
      id: "indicator",
      area: COMPOSER_AREAS.top,
      render: () => /* @__PURE__ */ jsx(Indicator, { ctx })
    });
    ctx.register({
      id: "guard",
      area: COMPOSER_AREAS.middleware,
      order: -1e3,
      data: {
        handler: (draft) => guardDraft(window.location.hash, draft)
      }
    });
  }
};
export {
  Indicator,
  Page,
  plugin_default as default
};
