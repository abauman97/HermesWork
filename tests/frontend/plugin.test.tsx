import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin, { Indicator, Page } from "../../desktop/src/plugin";
import {
  guardDraft,
  projectRoute,
  route,
  sessions,
} from "../../desktop/src/logic";
import { host } from "./sdk";
import type { PluginContext } from "@hermes/plugin-sdk";

const project = {
  id: "p_123",
  name: "Research",
  description: "Native notes",
  slug: "research",
  primary_path: "/tmp/work",
  folders: [{ path: "/tmp/work", is_primary: true }],
  archived: false,
  created_at: 123,
};
function context() {
  return {
    register: vi.fn(() => () => {}),
    rest: vi.fn(async () => ({ projects: [project], project })),
  } as unknown as PluginContext;
}
beforeEach(() => {
  window.location.hash = "#/projects";
  vi.clearAllMocks();
  host.profileRoutes.mockResolvedValue(
    ["default", "work"].map((profile) => ({
      connectionId: "local",
      mode: "local",
      profile,
      targetProfile: profile,
    })),
  );
  host.requestProfile.mockImplementation(async () => host.request());
});
afterEach(cleanup);

describe("routing and fail-closed guard", () => {
  it("registers only supported fixed routes and native areas", () => {
    const ctx = context();
    plugin.register(ctx);
    expect(vi.mocked(ctx.register).mock.calls.map((c) => c[0].area)).toEqual([
      "sidebar.nav",
      "routes",
      "composer.top",
      "composer.middleware",
    ]);
    expect(vi.mocked(ctx.register).mock.calls[1][0].data).toEqual({
      path: "/projects",
    });
  });
  it("encodes stable IDs and profile and parses refreshed links", () => {
    expect(route("#" + projectRoute("p_123", "a b"))).toMatchObject({
      path: "/projects",
      project: "p_123",
      profile: "a b",
    });
  });
  it("passes normal drafts and existing sessions without changing text or attachments", () => {
    const draft = { text: "hello", attachments: [{ path: "native-upload" }] };
    for (const path of [
      "#/",
      "#/session-id",
      "#/session-id?project=p_123",
      "#/projects?project=p_123",
    ])
      expect(guardDraft(path, draft)).toBe(draft);
  });
  it("cancels duplicates, invalid projects and all mounted surfaces on a project URL", () => {
    for (const path of ["#/?project=p_123", "#/?project=", "#/?project=bad"]) {
      expect(guardDraft(path, { text: "one" })).toBeNull();
      expect(
        guardDraft(path, { text: "other tile", attachments: [] }),
      ).toBeNull();
    }
  });
  it("flattens native session lanes, deduplicates, orders by activity", () => {
    expect(
      sessions({
        previewSessions: [{ id: "a", last_active: 1 }],
        repos: [
          {
            groups: [
              {
                sessions: [
                  { id: "a", last_active: 1 },
                  { id: "b", last_active: 2 },
                ],
              },
            ],
          },
        ],
      }).map((s) => s.id),
    ).toEqual(["b", "a"]);
  });
});

it("lists, searches and opens project details with pinned profile", async () => {
  const ctx = context();
  render(<Page ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Research" }));
  expect(host.navigate).toHaveBeenCalledWith(
    "/projects?project=p_123&profile=default",
  );
  expect(ctx.rest).toHaveBeenCalledWith("/projects?profile=default", undefined);
  fireEvent.change(screen.getByLabelText("Search projects"), {
    target: { value: "absent" },
  });
  expect(screen.getByText("No matching projects.")).toBeTruthy();
});
it("creates projects with native metadata", async () => {
  const ctx = context();
  render(<Page ctx={ctx} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Project" }),
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Workspace directory"), {
    target: { value: "/tmp/new" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Create project" }));
  await waitFor(() =>
    expect(ctx.rest).toHaveBeenCalledWith(
      "/projects?profile=default",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          name: "New",
          primary_path: "/tmp/new",
        }),
      }),
    ),
  );
});
it("renders details, enables create-first chat, opens native sessions and archives", async () => {
  window.location.hash = "#/projects?project=p_123&profile=work";
  host.request.mockResolvedValueOnce({
    project: { previewSessions: [{ id: "session-1", title: "A native chat" }] },
  } as never);
  const ctx = context();
  render(<Page ctx={ctx} />);
  expect(
    (
      (await screen.findByRole("button", {
        name: "New Project Chat",
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "A native chat" }));
  await waitFor(() =>
    expect(host.openSession).toHaveBeenCalledWith("session-1", {
      profile: "work",
      route: {
        connectionId: "local",
        mode: "local",
        profile: "work",
        targetProfile: "work",
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Archive Project" }));
  await waitFor(() =>
    expect(ctx.rest).toHaveBeenCalledWith(
      "/projects/p_123/archive?restore=false&profile=work",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});
it("reports missing projects and API failures explicitly", async () => {
  window.location.hash = "#/projects?project=missing";
  const ctx = context();
  vi.mocked(ctx.rest).mockResolvedValue({ projects: [] });
  render(<Page ctx={ctx} />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Project not found"),
  );
});
it("indicator resolves metadata and clears context without creating sessions", async () => {
  window.location.hash = "#/?project=p_123";
  const ctx = context();
  render(<Indicator ctx={ctx} />);
  expect(await screen.findByText("Research")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear project" }));
  expect(host.navigate).toHaveBeenCalledWith("/");
  expect(host.request).not.toHaveBeenCalled();
});
it("indicator disappears on session navigation and ignores stale metadata", async () => {
  window.location.hash = "#/?project=p_123";
  const ctx = context();
  render(<Indicator ctx={ctx} />);
  await screen.findByText("Research");
  window.location.hash = "#/existing-session";
  fireEvent(window, new HashChangeEvent("hashchange"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("preserves entered metadata when saving fails", async () => {
  const ctx = context();
  vi.mocked(ctx.rest).mockImplementation(async (_path, options) => {
    if (options?.method === "POST") throw new Error("Gateway unavailable");
    return { projects: [project] } as never;
  });
  render(<Page ctx={ctx} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Project" }),
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Keep these notes" },
  });
  fireEvent.change(screen.getByLabelText("Workspace directory"), {
    target: { value: "/tmp/keep" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Create project" }));
  expect(await screen.findByText("Gateway unavailable")).toBeTruthy();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
    "Keep these notes",
  );
});
it("edits metadata and requires explicit delete confirmation", async () => {
  window.location.hash = "#/projects?project=p_123";
  const ctx = context();
  render(<Page ctx={ctx} />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit Project" }));
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Changed" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Edit project" }));
  await waitFor(() =>
    expect(ctx.rest).toHaveBeenCalledWith(
      "/projects/p_123?profile=default",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ description: "Changed" }),
      }),
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete Project" }),
  );
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(
    vi.mocked(ctx.rest).mock.calls.some((c) => c[1]?.method === "DELETE"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() =>
    expect(ctx.rest).toHaveBeenCalledWith(
      "/projects/p_123?profile=default",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
});
it("does not navigate back after a save finishes on a page the user left", async () => {
  const ctx = context();
  let finish!: (value: { project: typeof project }) => void;
  vi.mocked(ctx.rest).mockImplementation(async (_path, options) => {
    if (options?.method)
      return new Promise((resolve) => {
        finish = resolve;
      }) as never;
    return { projects: [project] } as never;
  });
  render(<Page ctx={ctx} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Project" }),
  );
  fireEvent.submit(screen.getByRole("form", { name: "Create project" }));
  window.location.hash = "#/another-session";
  finish({ project });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Save Project",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(host.navigate).not.toHaveBeenCalled();
});
it("ignores a stale project response after switching detail routes", async () => {
  window.location.hash = "#/projects?project=p_123";
  const ctx = context();
  let finish!: (value: { projects: (typeof project)[] }) => void;
  vi.mocked(ctx.rest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(ctx.rest).mockResolvedValue({ projects: [] });
  render(<Page ctx={ctx} />);
  window.location.hash = "#/projects?project=missing";
  fireEvent(window, new HashChangeEvent("hashchange"));
  await screen.findByText(/Project not found/);
  finish({ projects: [project] });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Edit Project" })).toBeNull(),
  );
});

it.each(["hash", "profile", "connection"])(
  "ignores save success and failure after leaving and returning via %s",
  async (kind) => {
    for (const failed of [false, true]) {
      const ctx = context();
      let finish!: (value: unknown) => void;
      let reject!: (error: Error) => void;
      const callbacks: (() => void)[] = [];
      const atom =
        kind === "profile" ? host.state.profile : host.state.connectionId;
      const spy = vi.spyOn(atom, "subscribe").mockImplementation((cb) => {
        cb(kind === "profile" ? "default" : "local");
        callbacks.push(() => {
          cb("away");
          cb(kind === "profile" ? "default" : "local");
        });
        return () => {};
      });
      vi.mocked(ctx.rest).mockImplementation(async (_path, options) => {
        if (options?.method)
          return new Promise((resolve, fail) => {
            finish = resolve;
            reject = fail;
          }) as never;
        return { projects: [project] } as never;
      });
      host.navigate.mockClear();
      const view = render(<Page ctx={ctx} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Create Project" }),
      );
      fireEvent.submit(screen.getByRole("form", { name: "Create project" }));
      if (kind === "hash") {
        window.location.hash = "#/settings";
        fireEvent(window, new HashChangeEvent("hashchange"));
        window.location.hash = "#/projects";
        fireEvent(window, new HashChangeEvent("hashchange"));
      } else callbacks.forEach((cb) => cb());
      if (failed) reject(new Error("Stale save failure"));
      else finish({ project });
      await waitFor(() =>
        expect(
          (
            screen.getByRole("button", {
              name: "Save Project",
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(false),
      );
      expect(host.navigate).not.toHaveBeenCalled();
      expect(screen.queryByText("Stale save failure")).toBeNull();
      view.unmount();
      spy.mockRestore();
    }
  },
);

it("requires confirmation before forgetting a stale saved request and never creates automatically", async () => {
  const { receiptKey } = await import("../../desktop/src/chat");
  window.location.hash = "#/projects?project=p_123";
  const key = receiptKey("local", "default", project.id);
  sessionStorage.setItem(key, "corrupt");
  render(<Page ctx={context()} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Forget saved request",
    }),
  );
  expect(sessionStorage.getItem(key)).toBe("corrupt");
  expect(screen.getByRole("alertdialog").textContent).toContain(
    "may already exist",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm forget saved request" }),
  );
  await screen.findByRole("button", { name: "New Project Chat" });
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(host.openSession).not.toHaveBeenCalled();
  expect(
    host.requestProfile.mock.calls.some((c) => c[1] === "session.create"),
  ).toBe(false);
});

it("invalidates a save generation on unmount before returning to the same route", async () => {
  const ctx = context();
  let finish!: (value: unknown) => void;
  vi.mocked(ctx.rest).mockImplementation(async (_path, options) => {
    if (options?.method)
      return new Promise((resolve) => {
        finish = resolve;
      }) as never;
    return { projects: [project] } as never;
  });
  const old = render(<Page ctx={ctx} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Project" }),
  );
  fireEvent.submit(screen.getByRole("form", { name: "Create project" }));
  old.unmount();
  render(<Page ctx={ctx} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Create Project" }),
  );
  finish({ project });
  await waitFor(() =>
    expect(screen.getByRole("form", { name: "Create project" })).toBeTruthy(),
  );
  expect(host.navigate).not.toHaveBeenCalled();
});
