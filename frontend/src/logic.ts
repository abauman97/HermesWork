export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  primary_path?: string;
  icon?: string;
  color?: string;
  board_slug?: string;
  archived: boolean;
  created_at: number;
  folders: { path: string; is_primary: boolean }[];
}
export interface Session {
  id: string;
  title?: string;
  last_active?: number;
  message_count?: number;
  is_active?: boolean;
}
export interface Tree {
  sessionCount?: number;
  lastActive?: number;
  previewSessions?: Session[];
  repos?: { groups?: { sessions?: Session[] }[] }[];
}
export function route(hash: string) {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const params = new URLSearchParams(query);
  return {
    path: path || "/",
    project: params.get("project"),
    profile: params.get("profile"),
    hasProject: params.has("project"),
  };
}
export function projectRoute(id: string, profile: string) {
  return `/projects?${new URLSearchParams({ project: id, profile })}`;
}
export function sessions(tree: Tree | null): Session[] {
  const rows = [
    ...(tree?.previewSessions ?? []),
    ...(tree?.repos ?? []).flatMap((r) =>
      (r.groups ?? []).flatMap((g) => g.sessions ?? []),
    ),
  ];
  return [...new Map(rows.map((s) => [s.id, s])).values()].sort(
    (a, b) => (b.last_active ?? 0) - (a.last_active ?? 0),
  );
}
/** No side effects, no await and no possible rejection. The SDK supplies no origin identity.
 * On a project URL cancel ALL surfaces: selective cancellation cannot be proven safe.
 */
export function guardDraft<T>(hash: string, draft: T): T | null {
  try {
    const current = route(hash);
    return current.path === "/" && current.hasProject ? null : draft;
  } catch {
    return null;
  }
}
