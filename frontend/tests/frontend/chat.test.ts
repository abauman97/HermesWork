import { beforeEach, expect, it, vi } from "vitest";
import { createProjectChat, receiptKey } from "../../src/chat";
import { host } from "./sdk";
import type { PluginContext } from "@hermes/plugin-sdk";

const project = {
  id: "p_chat",
  archived: false,
  primary_path: "/work",
  folders: [{ path: "/work", is_primary: true }],
};
const owner = {
  connectionId: "local",
  mode: "local" as const,
  profile: "default",
  targetProfile: "default",
};
const ctx = { rest: vi.fn() } as unknown as PluginContext;
const key = receiptKey("local", "default", project.id);
let finish: (value: { stored_session_id: string }) => void;
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  window.location.hash = "#/projects?project=p_chat";
  host.profileRoutes.mockResolvedValue([owner]);
  vi.mocked(ctx.rest).mockResolvedValue({ project, cwd: "/work" });
  host.requestProfile.mockImplementation(async (_route, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd") return { project };
    return { stored_session_id: "stored-1", session_id: "runtime-1" };
  });
  host.openSession.mockResolvedValue();
});
it("creates once using the routed SDK and opens the stored identity without submitting", async () => {
  await createProjectChat(ctx, project.id, "default");
  expect(host.requestProfile).toHaveBeenCalledWith(owner, "session.create", {
    request_id: expect.any(String),
    source: "desktop",
    cwd: "/work",
    cwd_explicit: true,
    profile: "default",
  });
  expect(host.openSession).toHaveBeenCalledWith("stored-1", {
    profile: "default",
    route: owner,
    awaitHydration: true,
  });
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(host.request).not.toHaveBeenCalled();
});
it("deduplicates clicks before validation completes", async () => {
  const first = createProjectChat(ctx, project.id, "default");
  await createProjectChat(ctx, project.id, "default");
  await first;
  expect(
    host.requestProfile.mock.calls.filter((c) => c[1] === "session.create"),
  ).toHaveLength(1);
});
it("recovers an ambiguous failure with exactly the frozen request after a reload/remount", async () => {
  host.requestProfile.mockImplementation(async (_r, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd") return { project };
    throw new Error("Response lost after creation");
  });
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "may already exist",
  );
  const receipt = JSON.parse(sessionStorage.getItem(key)!);
  expect(host.openSession).not.toHaveBeenCalled();
  host.requestProfile.mockImplementation(async (_r, method) =>
    method === "projects.list"
      ? { projects: [project] }
      : method === "projects.for_cwd"
        ? { project }
        : { stored_session_id: "stored-1" },
  );
  await createProjectChat(ctx, project.id, "default");
  const calls = host.requestProfile.mock.calls.filter(
    (c) => c[1] === "session.create",
  );
  expect(calls.map((c) => c[2])).toEqual([receipt.params, receipt.params]);
});
it("retains a completed result when navigating during creation; retry opens without creating again", async () => {
  host.requestProfile.mockImplementation(async (_r, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd") return { project };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = createProjectChat(ctx, project.id, "default");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  window.location.hash = "#/another-session";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  finish({ stored_session_id: "stored-1" });
  await pending;
  expect(host.openSession).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(key)!).sessionId).toBe("stored-1");
  window.location.hash = "#/projects?project=p_chat";
  await createProjectChat(ctx, project.id, "default");
  expect(host.openSession).toHaveBeenCalledTimes(1);
  expect(
    host.requestProfile.mock.calls.filter((c) => c[1] === "session.create"),
  ).toHaveLength(1);
});
it("retries an open failure using the known stored ID", async () => {
  host.openSession.mockRejectedValueOnce(new Error("Open failed"));
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "Open failed",
  );
  await createProjectChat(ctx, project.id, "default");
  expect(
    host.requestProfile.mock.calls.filter((c) => c[1] === "session.create"),
  ).toHaveLength(1);
});
it("refuses gateway project mismatches and deepest-folder conflicts before creation", async () => {
  host.requestProfile.mockResolvedValue({
    projects: [{ ...project, primary_path: "/other" }],
  });
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "metadata differs",
  );
  expect(sessionStorage.getItem(key)).toBeNull();
  host.requestProfile.mockImplementation(async (_r, method) =>
    method === "projects.list"
      ? { projects: [project] }
      : { project: { id: "nested-project" } },
  );
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "another project",
  );
  expect(
    host.requestProfile.mock.calls.some((c) => c[1] === "session.create"),
  ).toBe(false);
});
it("refuses unavailable profiles and replaced routes, without adopting another profile's receipt", async () => {
  host.profileRoutes.mockResolvedValue([
    { ...owner, profile: "work", targetProfile: "work" },
  ]);
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "unique connection",
  );
  expect(ctx.rest).not.toHaveBeenCalled();
  host.profileRoutes.mockResolvedValue([owner]);
  sessionStorage.setItem(
    key,
    JSON.stringify({
      route: { ...owner, targetProfile: "victim" },
      projectId: project.id,
      params: {},
    }),
  );
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "no longer matches",
  );
  expect(host.requestProfile).not.toHaveBeenCalled();
});
it("does not open if native membership changes during session creation", async () => {
  let created = false;
  host.requestProfile.mockImplementation(async (_r, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd")
      return { project: created ? { ...project, id: "replacement" } : project };
    created = true;
    return { stored_session_id: "stored-1" };
  });
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "another project",
  );
  expect(host.openSession).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(key)!).sessionId).toBe("stored-1");
});
it("does not navigate after switching profiles during creation, even when switched back", async () => {
  const callbacks: ((value: string) => void)[] = [];
  const subscription = vi
    .spyOn(host.state.profile, "subscribe")
    .mockImplementation((cb) => {
      cb("default");
      callbacks.push(cb);
      return () => {};
    });
  host.requestProfile.mockImplementation(async (_r, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd") return { project };
    callbacks.forEach((cb) => {
      cb("work");
      cb("default");
    });
    return { stored_session_id: "stored-1" };
  });
  await createProjectChat(ctx, project.id, "default");
  expect(host.openSession).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(key)!).sessionId).toBe("stored-1");
  subscription.mockRestore();
});
it("keeps an ambiguous identity if Hermes returns no stored ID; never opens a runtime-only ID", async () => {
  host.requestProfile.mockImplementation(async (_r, method) =>
    method === "projects.list"
      ? { projects: [project] }
      : method === "projects.for_cwd"
        ? { project }
        : { session_id: "runtime-only" },
  );
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "stored session ID",
  );
  expect(host.openSession).not.toHaveBeenCalled();
  expect(
    JSON.parse(sessionStorage.getItem(key)!).params.request_id,
  ).toBeTruthy();
});
it("fails before creation if the recovery receipt cannot be persisted", async () => {
  const storage = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
  try {
    await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
      "Storage unavailable",
    );
    expect(
      host.requestProfile.mock.calls.some((c) => c[1] === "session.create"),
    ).toBe(false);
  } finally {
    storage.mockRestore();
  }
});

it("retains the receipt throughout delayed hydration and a hydration rejection", async () => {
  let reject!: (error: Error) => void;
  host.openSession.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const pending = createProjectChat(ctx, project.id, "default");
  await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
  expect(host.openSession).toHaveBeenLastCalledWith("stored-1", {
    profile: "default",
    route: owner,
    awaitHydration: true,
  });
  expect(JSON.parse(sessionStorage.getItem(key)!).sessionId).toBe("stored-1");
  reject(new Error("Timed out loading native session"));
  await expect(pending).rejects.toThrow("Timed out loading");
  expect(sessionStorage.getItem(key)).not.toBeNull();
  await createProjectChat(ctx, project.id, "default");
  expect(
    host.requestProfile.mock.calls.filter((c) => c[1] === "session.create"),
  ).toHaveLength(1);
  expect(sessionStorage.getItem(key)).toBeNull();
});

it("records the SDK limitation: an admitted delayed open can front after navigation", async () => {
  let finishOpen!: () => void;
  host.openSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOpen = () => {
          window.location.hash = "#/stored-1";
          resolve();
        };
      }),
  );
  const pending = createProjectChat(ctx, project.id, "default");
  await vi.waitFor(() => expect(finishOpen).toBeTypeOf("function"));
  window.location.hash = "#/settings";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  finishOpen();
  await pending;
  expect(window.location.hash).toBe("#/stored-1");
  expect(host.navigate).not.toHaveBeenCalled();
});

it("retains frozen ambiguous requests when the workspace moves", async () => {
  host.requestProfile.mockImplementation(async (_r, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd") return { project };
    throw new Error("Lost response");
  });
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "Lost response",
  );
  const saved = sessionStorage.getItem(key);
  vi.mocked(ctx.rest).mockRejectedValue(
    new Error("Workspace is no longer a member"),
  );
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "no longer a member",
  );
  expect(sessionStorage.getItem(key)).toBe(saved);
  expect(
    host.requestProfile.mock.calls.filter((c) => c[1] === "session.create"),
  ).toHaveLength(1);
});

it("explicit retirement unblocks corrupt or stale receipts without creating a chat", async () => {
  const { forgetReceipt } = await import("../../src/chat");
  sessionStorage.setItem(key, "corrupt");
  const otherKey = receiptKey("other-connection", "default", project.id);
  sessionStorage.setItem(otherKey, "other tab/connection request");
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow();
  forgetReceipt("local", "default", project.id);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem(otherKey)).toBe("other tab/connection request");
  expect(host.requestProfile).not.toHaveBeenCalled();
  await createProjectChat(ctx, project.id, "default");
  expect(
    host.requestProfile.mock.calls.filter((c) => c[1] === "session.create"),
  ).toHaveLength(1);
});

it("refuses receipt retirement while its create is pending", async () => {
  const { forgetReceipt } = await import("../../src/chat");
  host.requestProfile.mockImplementation(async (_r, method) => {
    if (method === "projects.list") return { projects: [project] };
    if (method === "projects.for_cwd") return { project };
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  finish = undefined as never;
  const pending = createProjectChat(ctx, project.id, "default");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(() => forgetReceipt("local", "default", project.id)).toThrow("Wait");
  finish({ stored_session_id: "stored-1" });
  await pending;
});

it("never treats an empty stored receipt as permission for a fresh create", async () => {
  sessionStorage.setItem(key, "");
  await expect(createProjectChat(ctx, project.id, "default")).rejects.toThrow(
    "may already exist",
  );
  expect(host.requestProfile).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBe("");
});

it("retains a result on connection switch and return during creation", async () => {
  let changed!: () => void;
  const subscription = vi
    .spyOn(host.state.connectionId, "subscribe")
    .mockImplementation((cb) => {
      cb("local");
      changed = () => {
        cb("other");
        cb("local");
      };
      return () => {};
    });
  try {
    host.requestProfile.mockImplementation(async (_r, method) => {
      if (method === "projects.list") return { projects: [project] };
      if (method === "projects.for_cwd") return { project };
      changed();
      return { stored_session_id: "stored-1" };
    });
    await createProjectChat(ctx, project.id, "default");
    expect(host.openSession).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key)!).sessionId).toBe("stored-1");
  } finally {
    subscription.mockRestore();
  }
});
