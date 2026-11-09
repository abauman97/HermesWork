import { expect, it, vi } from "vitest";
import type { PluginContext } from "@hermes/plugin-sdk";
// Execute the shipped ESM, using the same SDK alias as the source tests.
// @ts-expect-error Generated JavaScript intentionally has no declaration file.
import plugin from "../../../desktop/plugin.js";

it("loads the shipped bundle and registers the Projects contributions", () => {
  const register = vi.fn();
  plugin.register({ register } as unknown as PluginContext);
  expect(plugin.id).toBe("hermes-projects");
  expect(register.mock.calls.map(([item]) => item.id)).toEqual([
    "nav",
    "page",
    "indicator",
    "guard",
  ]);
  const guard = register.mock.calls.find(([item]) => item.id === "guard")?.[0];
  window.location.hash = "#/?project=legacy";
  expect(guard.data.handler({ text: "hello" })).toBeNull();
});
