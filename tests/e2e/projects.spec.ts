import { test, expect, type Page } from "@playwright/test";

test("real Webapp mounts plugin and manages native projects without Dashboard", async ({
  page,
}) => {
  await loginAndEnable(page);
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  // This suite owns the disposable fixture; clear only records left by this test.
  const prior = await page.request.get(
    "/api/plugins/hermes-projects/projects?profile=default",
  );
  expect(prior.ok()).toBeTruthy();
  for (const p of (await prior.json()).projects) {
    if (
      p.name.startsWith("Browser project ") &&
      p.primary_path === "/tmp/projects-workspace"
    ) {
      expect(
        (
          await page.request.delete(
            `/api/plugins/hermes-projects/projects/${p.id}?profile=default`,
          )
        ).ok(),
      ).toBeTruthy();
    }
  }
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Create Project", exact: true })
    .click();
  const name = `Browser project ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Workspace directory").fill("/tmp/projects-workspace");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Created through the real Hermes Webapp");
  await page.getByRole("button", { name: "Save Project", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New Project Chat" }),
  ).toBeEnabled();
  const detailURL = page.url();
  await page.reload();
  await expect(page.getByText("CONNECTING", { exact: true })).toBeHidden({
    timeout: 30000,
  });
  await expect(page).toHaveURL(detailURL);
  // The native shell can front its restored session tile on cold boot.
  // Reopen through the real sidebar, preserving the saved project ID.
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const allProjects = page.getByRole("button", {
    name: "All projects",
    exact: true,
  });
  await expect(
    allProjects.or(page.getByRole("button", { name, exact: true })),
  ).toBeVisible();
  if (await allProjects.isVisible()) await allProjects.click();
  await page
    .locator(".hermes-projects")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page).toHaveURL(detailURL);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.screenshot({
    path: "artifacts/real-project-details.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit Project", exact: true }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Updated native project");
  await page.getByRole("button", { name: "Save Project", exact: true }).click();
  await expect(
    page.getByText("Updated native project", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Archive Project", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore Project", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore Project", exact: true })
    .click();
  await page.getByRole("button", { name: "All projects" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.screenshot({
    path: "artifacts/real-project-list.png",
    fullPage: true,
  });
  await page
    .locator(".hermes-projects")
    .getByRole("button", { name, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete Project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(page.getByText(/Project not found in profile/)).toBeVisible();
});

async function loginAndEnable(page: Page) {
  await page.goto("/");
  // Sign in through Hermes's real gate. Synthetic fixture account only.
  const username = page.getByRole("textbox", { name: /username/i });
  if (await username.isVisible()) {
    await username.fill("tester");
    await page.getByLabel(/password/i).fill("projects-local-test");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(username).toBeHidden({ timeout: 30000 });
  }
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("CONNECTING", { exact: true })).toBeHidden({
    timeout: 30000,
  });
  await page.waitForLoadState("domcontentloaded");
  await page.goto("/#/capabilities?tab=plugins");
  await page.getByRole("textbox", { name: "Search plugins" }).fill("Projects");
  const enabled = page.getByRole("switch", { name: /Projects/i });
  await expect(enabled).toBeVisible({ timeout: 30000 });
  if (!(await enabled.isChecked())) await enabled.click();
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .first()
    .click();
}

test("create-first project chat uses native model, file, sends, grouping and reload", async ({
  page,
  request,
}) => {
  const unauthorized = await request.get(
    "/api/plugins/hermes-projects/projects",
  );
  expect([401, 403]).toContain(unauthorized.status());
  await loginAndEnable(page);
  const wrong = await page.request.get(
    "/api/plugins/hermes-projects/projects?profile=does-not-exist-projects-test",
  );
  expect([400, 403, 404, 422]).toContain(wrong.status());
  // Create through the mounted plugin UI.
  const prior = await (
    await page.request.get(
      "/api/plugins/hermes-projects/projects?profile=default",
    )
  ).json();
  for (const p of prior.projects)
    if (p.primary_path === "/tmp/projects-workspace")
      await page.request.delete(
        `/api/plugins/hermes-projects/projects/${p.id}?profile=default`,
      );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Create Project", exact: true })
    .click();
  const name = `Native chat project ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Workspace directory").fill("/tmp/projects-workspace");
  await page.getByRole("button", { name: "Save Project", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const detailURL = page.url();
  const projectId = new URLSearchParams(detailURL.split("?")[1]).get(
    "project",
  )!;
  await page.screenshot({
    path: "artifacts/final-project-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/final-project-mobile.png",
    fullPage: true,
  });
  expect(
    await page
      .locator(".hermes-projects")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeCreate = await (
    await page.request.get("/api/sessions?profile=default")
  ).json();
  await page
    .getByRole("button", { name: "New Project Chat", exact: true })
    .dblclick({ delay: 10 });
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(composer).toBeVisible();
  await expect(page).not.toHaveURL(detailURL);
  const nativeURL = page.url();
  const sessionId = decodeURIComponent(
    new URL(nativeURL).hash.split("?")[0].replace(/^#\//, ""),
  );
  const empty = await (
    await page.request.get(
      `/api/sessions/${encodeURIComponent(sessionId)}?profile=default`,
    )
  ).json();
  expect(empty.cwd).toBe("/tmp/projects-workspace");
  expect(empty.message_count).toBe(0);
  const afterCreate = await (
    await page.request.get("/api/sessions?profile=default")
  ).json();
  expect(afterCreate.total).toBe(beforeCreate.total + 1);
  await expect(
    page.getByRole("alert").filter({ hasText: /legacy draft/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Model · custom: projects-test$/ })
    .click();
  await page.getByRole("menuitem", { name: /Add custom model/i }).click();
  await page.getByPlaceholder(/Type a model id/).fill("projects-test-selected");
  await page.screenshot({ path: "artifacts/model-picker-debug.png" });
  await page
    .getByRole("menuitem", { name: /projects-test-selected/ })
    .first()
    .click();
  await composer.fill(
    "PROJECTS_TEST first project message with attached notes",
  );
  await page.getByRole("button", { name: "Add context", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Files…", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "project-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("PROJECTS_TEST attachment content marker"),
  });
  await expect(
    page.getByRole("button", { name: "Remove project-notes.txt", exact: true }),
  ).toBeVisible();
  await composer.press("Enter");
  const replies = page
    .locator('[data-role="assistant"]')
    .getByText(
      "PROJECTS_TEST_OK model=projects-test-selected attachment=present",
      {
        exact: true,
      },
    );
  await expect(replies).toHaveCount(1, { timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await composer.fill("PROJECTS_TEST second native message");
  await composer.press("Enter");
  await expect(replies).toHaveCount(2, { timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/final-native-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/final-native-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Check persisted workspace and association through native HTTP inventory.
  const stored = await (await page.request.get("/api/sessions")).json();
  expect(JSON.stringify(stored)).toContain("/tmp/projects-workspace");
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .first()
    .click();
  await page
    .locator(".hermes-projects")
    .getByRole("button", { name, exact: true })
    .click();
  const details = page.locator(".hermes-projects");
  const session = details
    .getByRole("button", { name: /PROJECTS_TEST_OK/ })
    .first();
  await expect(session).toBeVisible({ timeout: 15000 });
  await session.click();
  await expect(page).toHaveURL(nativeURL);
  await expect(replies).toHaveCount(2);
  await page.reload();
  await expect(replies).toHaveCount(2, { timeout: 30000 });
  await expect(composer).toBeVisible();
  await page.request.delete(
    `/api/plugins/hermes-projects/projects/${projectId}?profile=default`,
  );
});

test("secondary profile stays isolated and navigation during validation cancels creation", async ({
  page,
}) => {
  await loginAndEnable(page);
  const profile = "work";
  const path = "/tmp/projects-secondary";
  const previous = await (
    await page.request.get(
      `/api/plugins/hermes-projects/projects?profile=${profile}`,
    )
  ).json();
  for (const p of previous.projects)
    if (p.primary_path === path)
      await page.request.delete(
        `/api/plugins/hermes-projects/projects/${p.id}?profile=${profile}`,
      );
  const response = await page.request.post(
    `/api/plugins/hermes-projects/projects?profile=${profile}`,
    {
      data: { name: `Isolated work project ${Date.now()}`, primary_path: path },
    },
  );
  expect(response.status()).toBe(201);
  const project = (await response.json()).project;
  expect(
    (
      await page.request.get(
        `/api/plugins/hermes-projects/projects/${project.id}?profile=default`,
      )
    ).status(),
  ).toBe(404);
  await page.goto(`/#/projects?project=${project.id}&profile=${profile}`);
  await expect(
    page.getByRole("heading", { name: project.name, exact: true }),
  ).toBeVisible();
  const before = await (
    await page.request.get("/api/sessions?profile=work")
  ).json();
  let release!: () => void;
  let entered!: () => void;
  const seen = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/prepare-chat?profile=work", async (request) => {
    entered();
    await gate;
    await request.continue();
  });
  await page
    .getByRole("button", { name: "New Project Chat", exact: true })
    .click();
  await seen;
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  release();
  await expect(
    page.getByRole("button", { name: "Create Project", exact: true }),
  ).toBeEnabled();
  expect(
    await (await page.request.get("/api/sessions?profile=work")).json(),
  ).toEqual(before);
  await page.unroute("**/prepare-chat?profile=work");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await page
    .getByRole("button", { name: "New Project Chat", exact: true })
    .click();
  const composer = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(composer).toBeVisible({ timeout: 15000 });
  const sessionId = decodeURIComponent(
    new URL(page.url()).hash.split("?")[0].slice(2),
  );
  const empty = await (
    await page.request.get(
      `/api/sessions/${encodeURIComponent(sessionId)}?profile=work`,
    )
  ).json();
  expect(empty.cwd).toBe(path);
  expect(empty.profile).toBe("work");
  expect(
    (
      await page.request.get(
        `/api/sessions/${encodeURIComponent(sessionId)}?profile=default`,
      )
    ).status(),
  ).toBe(404);
  await composer.fill("PROJECTS_TEST secondary profile conversation");
  await composer.press("Enter");
  await expect(
    page
      .locator('[data-role="assistant"]')
      .getByText(/PROJECTS_TEST_OK model=projects-test/),
  ).toHaveCount(1, { timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .first()
    .click();
  await page.goto(`/#/projects?project=${project.id}&profile=work`);
  await expect(
    page
      .locator(".hermes-projects")
      .getByRole("button", { name: /PROJECTS_TEST_OK/ })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/final-secondary-profile.png",
    fullPage: true,
  });
  await page.request.delete(
    `/api/plugins/hermes-projects/projects/${project.id}?profile=work`,
  );
});

test("stale workspace validation fails visibly without creating a native session", async ({
  page,
}) => {
  await loginAndEnable(page);
  const projects = await (
    await page.request.get(
      "/api/plugins/hermes-projects/projects?profile=default",
    )
  ).json();
  for (const p of projects.projects)
    if (p.primary_path === "/tmp/projects-secondary")
      await page.request.delete(
        `/api/plugins/hermes-projects/projects/${p.id}?profile=default`,
      );
  const created = await page.request.post(
    "/api/plugins/hermes-projects/projects?profile=default",
    {
      data: {
        name: `Failure project ${Date.now()}`,
        primary_path: "/tmp/projects-secondary",
      },
    },
  );
  expect(created.status()).toBe(201);
  const p = (await created.json()).project;
  await page.goto(`/#/projects?project=${p.id}&profile=default`);
  await expect(
    page.getByRole("heading", { name: p.name, exact: true }),
  ).toBeVisible();
  const before = await (
    await page.request.get("/api/sessions?profile=default")
  ).json();
  expect(
    (
      await page.request.post(
        `/api/plugins/hermes-projects/projects/${p.id}/folders?profile=default`,
        { data: { action: "remove", path: "/tmp/projects-secondary" } },
      )
    ).ok(),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "New Project Chat", exact: true })
    .click();
  await expect(
    page.locator(".hermes-projects").getByRole("alert"),
  ).toContainText("No session creation was attempted");
  expect(
    await (await page.request.get("/api/sessions?profile=default")).json(),
  ).toEqual(before);
  await page.screenshot({
    path: "artifacts/final-validation-failure.png",
    fullPage: true,
  });
  await page.request.delete(
    `/api/plugins/hermes-projects/projects/${p.id}?profile=default`,
  );
});

async function enterDetails(page: Page, id: string, name: string) {
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .first()
    .click();
  const all = page.getByRole("button", { name: "All projects", exact: true });
  if (await all.isVisible()) await all.click();
  await page
    .locator(".hermes-projects")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`project=${id}`));
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

// Forward all real traffic; only discard the first create RESPONSE after the
// real gateway has committed. Reload then retries through the actual SDK.
test("dropped create response survives real reload, reuses identity and stays tab-local", async ({
  page,
  context,
}) => {
  const creates: Record<string, unknown>[] = [];
  let dropped!: () => void;
  const responseDropped = new Promise<void>((resolve) => {
    dropped = resolve;
  });
  let drop = true;
  let resumeEntered!: () => void;
  let releaseResume!: () => void;
  const resumeSeen = new Promise<void>((resolve) => {
    resumeEntered = resolve;
  });
  const resumeGate = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  await page.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    const ids = new Set<unknown>();
    const resumes = new Set<unknown>();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (frame.method === "session.create") {
        creates.push(frame.params);
        ids.add(frame.id);
      }
      if (creates.length === 2 && frame.method === "session.resume")
        resumes.add(frame.id);
      server.send(message);
    });
    server.onMessage(async (message) => {
      const frame = JSON.parse(String(message));
      if (drop && ids.has(frame.id) && frame.result) {
        drop = false;
        dropped();
        return;
      }
      if (resumes.has(frame.id) && frame.result) {
        resumeEntered();
        await resumeGate;
      }
      socket.send(message);
    });
  });
  await loginAndEnable(page);
  // This suite owns only disposable records at this fixture path.
  const api = "/api/plugins/hermes-projects/projects";
  for (const p of (await (await page.request.get(api)).json()).projects)
    if (p.primary_path === "/tmp/projects-secondary")
      await page.request.delete(`${api}/${p.id}`);
  const name = `Reload recovery ${Date.now()}`;
  const response = await page.request.post(api, {
    data: { name, primary_path: "/tmp/projects-secondary" },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await enterDetails(page, project.id, name);
  const before = await (
    await page.request.get("/api/sessions?profile=default")
  ).json();
  await page
    .getByRole("button", { name: "New Project Chat", exact: true })
    .click();
  await responseDropped;
  const receipt = await page.evaluate(() =>
    Object.entries(sessionStorage).find(([k]) =>
      k.startsWith("hermes-projects:create:v1:"),
    ),
  );
  expect(receipt).toBeTruthy();
  expect(JSON.parse(receipt![1]).sessionId).toBeUndefined();
  const admitted = await (
    await page.request.get("/api/sessions?profile=default")
  ).json();
  expect(admitted.total).toBe(before.total + 1);
  await page.reload();
  await expect(page.getByText("CONNECTING", { exact: true })).toBeHidden({
    timeout: 30000,
  });
  await enterDetails(page, project.id, name);
  await expect(
    page.getByRole("button", { name: "Retry / Open saved chat" }),
  ).toBeEnabled();

  const second = await context.newPage();
  await loginAndEnable(second);
  await enterDetails(second, project.id, name);
  await expect(
    second.getByRole("button", { name: "New Project Chat", exact: true }),
  ).toBeVisible();
  expect(
    await second.evaluate(() =>
      Object.keys(sessionStorage).filter((k) =>
        k.startsWith("hermes-projects:create:v1:"),
      ),
    ),
  ).toEqual([]);
  // Exercise explicit retirement of an unrecoverable receipt in the other tab.
  await second.evaluate(
    (key) => sessionStorage.setItem(key, "corrupt"),
    receipt![0],
  );
  await second.getByRole("button", { name: "Refresh", exact: true }).click();
  await second
    .getByRole("button", { name: "Forget saved request", exact: true })
    .click();
  await expect(
    second.getByRole("alertdialog", {
      name: "Forget saved request confirmation",
    }),
  ).toContainText("may already exist");
  await second.screenshot({
    path: "artifacts/final-forget-confirmation.png",
    fullPage: true,
  });
  await second.getByRole("button", { name: "Keep saved request" }).click();
  expect(
    await second.evaluate((key) => sessionStorage.getItem(key), receipt![0]),
  ).toBe("corrupt");
  await second
    .getByRole("button", { name: "Forget saved request", exact: true })
    .click();
  await second
    .getByRole("button", { name: "Confirm forget saved request" })
    .click();
  await expect(
    second.getByRole("button", { name: "New Project Chat", exact: true }),
  ).toBeVisible();
  expect(
    (await (await second.request.get("/api/sessions?profile=default")).json())
      .total,
  ).toBe(admitted.total);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), receipt![0]),
  ).toBe(receipt![1]);
  await second.close();

  expect(
    (
      await page.request.post(`${api}/${project.id}/folders`, {
        data: { action: "remove", path: "/tmp/projects-secondary" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Retry / Open saved chat" }).click();
  await expect(
    page.locator(".hermes-projects").getByRole("alert"),
  ).toContainText("may already exist");
  expect(creates).toHaveLength(1);
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), receipt![0]),
  ).toBe(receipt![1]);
  for (const action of ["add", "primary"])
    expect(
      (
        await page.request.post(`${api}/${project.id}/folders`, {
          data: { action, path: "/tmp/projects-secondary" },
        })
      ).ok(),
    ).toBeTruthy();

  await page.getByRole("button", { name: "Retry / Open saved chat" }).click();
  await resumeSeen;
  expect(
    JSON.parse(
      (await page.evaluate((key) => sessionStorage.getItem(key), receipt![0]))!,
    ).sessionId,
  ).toBeTruthy();
  releaseResume();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect.poll(() => creates.length).toBe(2);
  expect(creates[1]).toEqual(creates[0]);
  expect(
    (await (await page.request.get("/api/sessions?profile=default")).json())
      .total,
  ).toBe(admitted.total);
  await expect
    .poll(() =>
      page.evaluate((key) => sessionStorage.getItem(key), receipt![0]),
    )
    .toBeNull();
  await page.screenshot({
    path: "artifacts/final-reload-recovery.png",
    fullPage: true,
  });
  await page.request.delete(`${api}/${project.id}`);
});

test("long unbroken project names fit mounted desktop and mobile list and details", async ({
  page,
}) => {
  await loginAndEnable(page);
  const api = "/api/plugins/hermes-projects/projects";
  for (const p of (await (await page.request.get(api)).json()).projects)
    if (p.primary_path === "/tmp/projects-secondary")
      await page.request.delete(`${api}/${p.id}`);
  const name = `LongName${"W".repeat(192)}`;
  const response = await page.request.post(api, {
    data: { name, primary_path: "/tmp/projects-secondary" },
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const surface of ["list", "details"]) {
      if (surface === "list") {
        const all = page.getByRole("button", {
          name: "All projects",
          exact: true,
        });
        if (await all.isVisible()) await all.click();
        await expect(
          page
            .locator(".hermes-projects")
            .getByRole("button", { name, exact: true }),
        ).toBeVisible();
      } else {
        await page
          .locator(".hermes-projects")
          .getByRole("button", { name, exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name, exact: true }),
        ).toBeVisible();
      }
      const root = page.locator(".hermes-projects");
      expect(
        await root.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const label =
        surface === "list"
          ? root.getByRole("button", { name, exact: true })
          : root.getByRole("heading", { name, exact: true });
      expect(
        await label.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return (
            el.scrollWidth <= el.clientWidth + 1 &&
            rect.left >= 0 &&
            rect.right <= innerWidth
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: `artifacts/final-long-name-${surface}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.request.delete(`${api}/${project.id}`);
});
