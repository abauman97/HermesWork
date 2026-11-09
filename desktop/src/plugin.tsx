import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  host,
  useValue,
  SIDEBAR_NAV_AREA,
  ROUTES_AREA,
  COMPOSER_AREAS,
  type PluginContext,
} from "@hermes/plugin-sdk";
import {
  guardDraft,
  projectRoute,
  route,
  sessions,
  type Project,
  type Tree,
} from "./logic";

import {
  createProjectChat,
  hasReceipt,
  forgetReceipt,
  projectRequest,
  openProjectSession,
} from "./chat";
import { watchNavigation } from "./navigation";
import { styles } from "./styles";

function useRoute() {
  const [hash, set] = useState(window.location.hash);
  useEffect(() => {
    const changed = () => set(window.location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route(hash);
}
function scoped(ctx: PluginContext, profile: string) {
  return <T,>(path: string, options?: { method?: string; body?: unknown }) =>
    ctx.rest<T>(
      `${path}${path.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profile)}`,
      options,
    );
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Page({ ctx }: { ctx: PluginContext }) {
  const current = useRoute();
  const active = useValue(host.state.profile);
  const connection = useValue(host.state.connectionId);
  const profile = current.profile || active || "default";
  const [projects, setProjects] = useState<Project[]>([]);
  const [overview, setOverview] = useState<Record<string, Tree>>({});
  const [overviewError, setOverviewError] = useState("");
  const operationLock = useRef(false);
  const [tree, setTree] = useState<Tree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("name");
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const saveGeneration = useRef(0);
  useEffect(
    () => () => {
      saveGeneration.current++;
    },
    [],
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
      profile,
    )<{ projects: Project[] }>("/projects")
      .then((result) => {
        if (live) setProjects(result.projects);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      })
      .finally(() => {
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
      projectRequest<{ projects: (Tree & { id: string })[] }>(
        profile,
        "projects.tree",
        {
          profile,
          session_limit: 5000,
          preview_limit: 1,
        },
      )
        .then((r) => {
          if (live)
            setOverview(Object.fromEntries(r.projects.map((p) => [p.id, p])));
        })
        .catch((e) => {
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
      projectRequest<{ project: Tree | null }>(
        profile,
        "projects.project_sessions",
        {
          project_id: current.project,
          profile,
          session_limit: 5000,
        },
      )
        .then((result) => {
          if (live) setTree(result.project);
        })
        .catch((e) => {
          if (live) setSessionError(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [current.project, profile, connection, revision]);
  async function action(path: string, method = "POST", body?: unknown) {
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
  return (
    <main
      className="hermes-projects"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "24px clamp(16px, 4vw, 40px)",
        maxWidth: 960,
        margin: "0 auto",
        width: "100%",
        overflowY: "auto",
        color: "var(--ui-text-primary)",
      }}
    >
      <style>{styles}</style>
      <header
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <h1>
          {current.project ? project?.name || "Project details" : "Projects"}
        </h1>
        <span>Profile: {profile}</span>
        <Button
          variant="outline"
          size="sm"

          onClick={() => refresh((n) => n + 1)}
          disabled={busy}
        >
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={() => host.navigate("/")}>
          Back to chat
        </Button>
        {current.project && (
          <Button
            variant="outline"
            size="sm"

            onClick={() =>
              host.navigate(`/projects?${new URLSearchParams({ profile })}`)
            }
          >
            All projects
          </Button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading projects…</p>
      ) : current.project ? (
        project ? (
          <>
            <p>{project.description || "No description"}</p>
            <p>Workspace: {project.primary_path || "No primary folder"}</p>
            <p>
              Slug: {project.slug} · {project.archived ? "Archived" : "Active"}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                variant="default"
                size="sm"

                disabled={busy || project.archived}
                onClick={() => {
                  const originHash = window.location.hash;
                  const originProfile = host.state.profile.get();
                  const originConnection = host.state.connectionId.get();
                  setBusy(true);
                  setError("");
                  void createProjectChat(ctx, project.id, profile)
                    .catch((e) => {
                      if (
                        window.location.hash === originHash &&
                        host.state.profile.get() === originProfile &&
                        host.state.connectionId.get() === originConnection
                      )
                        setError(errorText(e));
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {connection && hasReceipt(connection, profile, project.id)
                  ? "Retry / Open saved chat"
                  : "New Project Chat"}
              </Button>
              <Button
                variant="outline"
                size="sm"

                onClick={() => setEditing(project)}
                disabled={busy}
              >
                Edit Project
              </Button>
              <Button
                variant="outline"
                size="sm"

                disabled={busy}
                onClick={() =>
                  void action(
                    `/projects/${project.id}/archive?restore=${project.archived}`,
                  )
                }
              >
                {project.archived ? "Restore Project" : "Archive Project"}
              </Button>
              <Button
                variant="outline"
                size="sm"

                onClick={() => setConfirmDelete(true)}
                disabled={busy}
              >
                Delete Project
              </Button>
            </div>
            <p role="note">
              Creates and saves an empty session immediately, then opens the
              native composer. Models and attachments stay native. Project
              membership follows workspace folders; moving folders or adding
              nested projects can regroup chats. Empty chats appear here after
              their first message.
            </p>
            {connection && hasReceipt(connection, profile, project.id) && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmForget(true)}
                >
                  Forget saved request
                </Button>
                {confirmForget && (
                  <div
                    role="alertdialog"
                    aria-label="Forget saved request confirmation"
                  >
                    <p>
                      A native chat may already exist, even if no result was
                      received. Forgetting removes only this tab's recovery
                      receipt. It does not delete that chat. A later New Project
                      Chat can create another session. Check native history
                      before starting again.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        try {
                          forgetReceipt(connection, profile, project.id);
                          setConfirmForget(false);
                          setError("");
                          refresh((n) => n + 1);
                        } catch (e) {
                          setError(errorText(e));
                        }
                      }}
                    >
                      Confirm forget saved request
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmForget(false)}
                    >
                      Keep saved request
                    </Button>
                  </div>
                )}
              </div>
            )}
            {confirmDelete && (
              <div role="alertdialog" aria-label="Delete project confirmation">
                <p>
                  Delete {project.name}? Native sessions and workspace files
                  remain. Workspace grouping will change.
                </p>
                <Button
                  variant="outline"
                  size="sm"

                  disabled={busy}
                  onClick={() =>
                    void action(`/projects/${project.id}`, "DELETE").then(() =>
                      setConfirmDelete(false),
                    )
                  }
                >
                  Confirm delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
            <h2>Workspace folders</h2>
            <ul>
              {project.folders.map((f) => (
                <li key={f.path}>
                  {f.path} {f.is_primary && "(primary)"}{" "}
                  <Button
                    variant="outline"
                    size="sm"

                    disabled={busy || f.is_primary}
                    onClick={() =>
                      void action(`/projects/${project.id}/folders`, "POST", {
                        action: "primary",
                        path: f.path,
                      })
                    }
                  >
                    Make primary
                  </Button>{" "}
                  <Button
                    variant="outline"
                    size="sm"

                    disabled={busy}
                    onClick={() =>
                      void action(`/projects/${project.id}/folders`, "POST", {
                        action: "remove",
                        path: f.path,
                      })
                    }
                  >
                    Remove folder
                  </Button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void action(`/projects/${project.id}/folders`, "POST", {
                  action: "add",
                  path: form.get("path"),
                });
              }}
            >
              <label>
                Add workspace folder{" "}
                <Input name="path" required placeholder="/absolute/host/path" />
              </label>
              <Button variant="outline" size="sm" disabled={busy}>
                Add folder
              </Button>
            </form>
            <h2>Associated sessions</h2>
            <p>
              Native workspace grouping; latest 5,000 eligible sessions in this
              profile. Hermes exposes no pagination for this view. Empty,
              archived and automation sessions may be omitted.
            </p>
            {sessionError && (
              <p role="alert">Sessions unavailable: {sessionError}</p>
            )}
            {!sessionError && sessions(tree).length === 0 && (
              <p>No associated sessions returned.</p>
            )}
            {sessions(tree).map((s) => (
              <article
                key={s.id}
                style={{
                  borderBottom: "1px solid var(--ui-stroke-secondary)",
                  padding: 10,
                }}
              >
                <Button
                  variant="outline"
                  size="sm"

                  onClick={() =>
                    void openProjectSession(s.id, profile).catch((e) =>
                      setError(errorText(e)),
                    )
                  }
                >
                  {s.title || "Untitled session"}
                </Button>{" "}
                <span>
                  {s.message_count ?? 0} messages ·{" "}
                  {s.last_active
                    ? new Date(s.last_active * 1000).toLocaleString()
                    : "No activity"}
                  {s.is_active ? " · Active" : ""}
                </span>
              </article>
            ))}
          </>
        ) : (
          <p role="alert">
            Project not found in profile {profile}. It may have been deleted.
          </p>
        )
      ) : (
        <>
          <p>Manage native Hermes workspaces and browse their conversations.</p>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              margin: "18px 0",
            }}
          >
            <Button
              variant="default"
              size="sm"
              onClick={() => setEditing("new")}
            >
              Create Project
            </Button>
            <label>
              Search projects{" "}
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              Order{" "}
              <Select value={order} onValueChange={setOrder}>
                <SelectTrigger aria-label="Order">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="recent">Newest</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <p>
            Session counts and activity use native workspace grouping over the
            latest 5,000 eligible profile sessions; they are not lifetime
            totals.
          </p>
          {overviewError && (
            <p role="alert">Activity unavailable: {overviewError}</p>
          )}
          {projects.length === 0 && (
            <p>No projects yet. Create a project to get started.</p>
          )}
          {projects
            .filter((p) =>
              `${p.name} ${p.description || ""} ${p.primary_path || ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .sort((a, b) =>
              order === "name"
                ? a.name.localeCompare(b.name)
                : b.created_at - a.created_at,
            )
            .map((p) => (
              <article
                key={p.id}
                style={{
                  padding: 18,
                  borderBottom: "1px solid var(--ui-stroke-secondary)",
                  borderRadius: 0,
                  marginBottom: 0,
                }}
              >
                <h2 style={{ fontSize: 18 }}>
                  <Button
                    variant="outline"
                    size="sm"

                    onClick={() => host.navigate(projectRoute(p.id, profile))}
                  >
                    {p.name}
                  </Button>{" "}
                  {p.archived && <small>Archived</small>}
                </h2>
                <p>{p.description || "No description"}</p>
                <p>
                  {p.primary_path || "No primary workspace"} ·{" "}
                  {p.folders.length} folders
                  {overview[p.id] && (
                    <>
                      {" "}
                      · {overview[p.id].sessionCount ?? 0} sessions ·{" "}
                      {overview[p.id].lastActive
                        ? new Date(
                            overview[p.id].lastActive! * 1000,
                          ).toLocaleString()
                        : "No recent activity"}
                    </>
                  )}
                </p>
                <small>
                  Created {new Date(p.created_at * 1000).toLocaleDateString()} ·{" "}
                  {profile}
                </small>
              </article>
            ))}
          {projects.length > 0 &&
            !projects.some((p) =>
              `${p.name} ${p.description || ""} ${p.primary_path || ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            ) && <p>No matching projects.</p>}
        </>
      )}
      {editing && (
        <Editor
          key={editing === "new" ? "new" : editing.id}
          project={editing === "new" ? null : editing}
          busy={busy}
          cancel={() => setEditing(null)}
          save={async (body) => {
            if (operationLock.current) return;
            operationLock.current = true;
            const navigation = watchNavigation();
            const generation = ++saveGeneration.current;
            const currentSave = () =>
              navigation.current() && generation === saveGeneration.current;
            setBusy(true);
            setError("");
            try {
              const result = await scoped(ctx, profile)<{ project: Project }>(
                editing === "new" ? "/projects" : `/projects/${editing.id}`,
                { method: editing === "new" ? "POST" : "PATCH", body },
              );
              if (!currentSave()) return;
              setEditing(null);
              host.navigate(projectRoute(result.project.id, profile));
              refresh((n) => n + 1);
            } catch (e) {
              if (currentSave()) setError(errorText(e));
            } finally {
              navigation.dispose();
              operationLock.current = false;
              if (generation === saveGeneration.current) setBusy(false);
            }
          }}
        />
      )}
    </main>
  );
}
function Editor({
  project,
  busy,
  save,
  cancel,
}: {
  project: Project | null;
  busy: boolean;
  save: (body: Record<string, string>) => Promise<void>;
  cancel: () => void;
}) {
  return (
    <form
      aria-label={project ? "Edit project" : "Create project"}
      onSubmit={(e) => {
        e.preventDefault();
        const body = Object.fromEntries(
          new FormData(e.currentTarget),
        ) as Record<string, string>;
        void save(body);
      }}
      style={{
        padding: 20,
        border: "1px solid var(--ui-stroke-secondary)",
        marginTop: 20,
      }}
    >
      <h2>{project ? "Edit Project" : "Create Project"}</h2>
      {(
        [
          "name",
          "description",
          ...(project ? [] : (["primary_path"] as const)),
          "icon",
          "color",
          "board_slug",
        ] as const
      ).map((key) => (
        <label key={key} style={{ display: "block", marginBottom: 12 }}>
          {
            {
              name: "Name",
              description: "Description",
              primary_path: "Workspace directory",
              icon: "Icon",
              color: "Color",
              board_slug: "Board slug",
            }[key]
          }{" "}
          <Input
            name={key}
            required={key === "name" || key === "primary_path"}
            defaultValue={project?.[key] || ""}
            style={{ width: "100%" }}
          />
        </label>
      ))}
      <Button variant="default" size="sm" disabled={busy}>
        Save Project
      </Button>{" "}
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={cancel}
        disabled={busy}
      >
        Cancel
      </Button>
    </form>
  );
}
export function Indicator({ ctx }: { ctx: PluginContext }) {
  const current = useRoute();
  const active = useValue(host.state.profile);
  const profile = current.profile || active || "default";
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setProject(null);
    setError("");
    if (current.path === "/" && current.hasProject)
      scoped(
        ctx,
        profile,
      )<{ project: Project }>(
        `/projects/${encodeURIComponent(current.project || "invalid")}`,
      )
        .then((r) => {
          if (live) setProject(r.project);
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [ctx, current.path, current.project, current.hasProject, profile]);
  if (current.path !== "/" || !current.hasProject) return null;
  return (
    <aside
      role="alert"
      style={{ padding: 10, border: "1px solid var(--ui-stroke-secondary)" }}
    >
      <strong>{project?.name || "Project draft unavailable"}</strong> ·{" "}
      {profile} {project?.primary_path}
      <p>
        {error ||
          "This legacy draft URL cannot create a project chat. Open Projects and use New Project Chat."}{" "}
        Sending is blocked on every composer while this project draft URL is
        active.
      </p>
      <p>
        Clear project opens a normal draft. Hermes may reset the editor; copy
        any text you want to keep first.
      </p>
      <Button variant="outline" size="sm" onClick={() => host.navigate("/")}>
        Clear project
      </Button>
    </aside>
  );
}
export default {
  id: "hermes-projects",
  name: "Projects",
  register(ctx: PluginContext) {
    ctx.register({
      id: "nav",
      area: SIDEBAR_NAV_AREA,
      data: { path: "/projects", label: "Projects", codicon: "project" },
    });
    ctx.register({
      id: "page",
      area: ROUTES_AREA,
      title: "Projects",
      data: { path: "/projects" },
      render: () => <Page ctx={ctx} />,
    });
    ctx.register({
      id: "indicator",
      area: COMPOSER_AREAS.top,
      render: () => <Indicator ctx={ctx} />,
    });
    ctx.register({
      id: "guard",
      area: COMPOSER_AREAS.middleware,
      order: -1000,
      data: {
        handler: (draft: unknown) => guardDraft(window.location.hash, draft),
      },
    });
  },
};
