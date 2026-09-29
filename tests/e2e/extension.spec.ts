import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { badgeText, expect, onboardingPage, test } from "./fixtures.ts";

async function pairThroughOnboarding(page: Page, code = "824917") {
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Connect" }).click();
  if (code === "824917") await expect(page.getByRole("heading", { name: "Review protection" })).toBeVisible();
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
}

test("first install opens onboarding and the popup asks to connect (never claims protection)", async ({
  context,
  extensionId,
  worker,
  openPopup,
}) => {
  const onboarding = await onboardingPage(context, extensionId);
  await expect(onboarding.getByRole("heading", { name: "Let's protect this browser" })).toBeVisible();
  await expect(onboarding.getByText("Keep a history of the websites your child visits")).toBeVisible();

  const popup = await openPopup();
  await expect(popup.getByRole("heading", { name: "Protection configuration required" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Connect to eGuard" })).toBeVisible();
  await expect(popup.getByText("Protection active")).toHaveCount(0);
  expect(await badgeText(worker)).toBe("!");
});

test("pairing: a bad code shows the server's reason, a good code connects and downloads the policy", async ({
  context,
  extensionId,
  backend,
  openPopup,
}) => {
  const page = await onboardingPage(context, extensionId);
  await pairThroughOnboarding(page, "000000");
  await expect(page.getByRole("alert")).toHaveText("Pairing code is invalid or expired");

  await page.getByLabel("Pairing code").fill("824 917");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { name: "Review protection" })).toBeVisible();
  await expect(page.getByText("Connected to Cruz family")).toBeVisible();
  const blocking = page.getByRole("listitem").filter({ hasText: "Website blocking" });
  await expect(blocking.getByText("Automatic")).toBeVisible();
  const safeBrowsing = page.getByRole("listitem").filter({ hasText: "private windows" });
  await expect(safeBrowsing.getByText("Guided")).toBeVisible();

  await page.getByRole("button", { name: "Verify configuration" }).click();
  // Policy downloaded, but no enforcement engine yet (Phase 4): must say so, not claim protection
  await expect(page.getByRole("status").getByText("Protection needs attention")).toBeVisible();

  const pairCalls = backend.state.requests.filter((r) => r.path === "/api/browser/v1/pair");
  expect(pairCalls.map((r) => r.body)).toMatchObject([
    { code: "000000" },
    { code: "824917", browser: "Chrome", extensionVersion: "0.1.0" },
  ]);
  expect(JSON.stringify(backend.state.requests)).not.toMatch(/password/i);

  const popup = await openPopup();
  await expect(popup.getByText("Mia", { exact: true })).toBeVisible();
  await expect(popup.getByText("Version 1", { exact: true })).toBeVisible();
  // Rules are installed and verified; what's left is private windows, which Chromium doesn't allow by default
  await expect(popup.getByText("Private windows aren't protected")).toBeVisible();
  await expect(popup.getByText("Website protection not active")).toHaveCount(0);
});

test("offline: the last policy stays in place and the popup explains calmly", async ({
  context,
  extensionId,
  backend,
  openPopup,
}) => {
  await pairThroughOnboarding(await onboardingPage(context, extensionId));
  const popup = await openPopup();
  await expect(popup.getByText("Version 1", { exact: true })).toBeVisible();

  backend.state.down = true;
  backend.state.policyVersion = 2;
  await popup.getByRole("button", { name: "Run health check" }).click();
  await expect(popup.getByText(/Last checked/)).toBeVisible();
  await expect(popup.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(popup.getByText(/error|exception|stack/i)).toHaveCount(0);

  backend.state.down = false;
  await popup.getByRole("button", { name: "Run health check" }).click();
  await expect(popup.getByText("Version 2", { exact: true })).toBeVisible();
});

test("when a parent removes the browser, the extension forgets the connection", async ({
  context,
  extensionId,
  backend,
  openPopup,
}) => {
  await pairThroughOnboarding(await onboardingPage(context, extensionId));
  const popup = await openPopup();
  await expect(popup.getByText("Mia", { exact: true })).toBeVisible();

  backend.state.revoked = true;
  await popup.getByRole("button", { name: "Run health check" }).click();
  await expect(popup.getByRole("heading", { name: "Protection configuration required" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Connect to eGuard" })).toBeVisible();
});

test("web pages cannot talk to the extension", async ({ context, backend, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`${backend.url}/`);
  const reachable = await page.evaluate((id) => {
    const c = (globalThis as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome;
    return { hasRuntime: typeof c?.runtime?.sendMessage === "function", id };
  }, extensionId);
  expect(reachable.hasRuntime).toBe(false);
});

test("the options page is read-only and explains privacy", async ({ context, extensionId }) => {
  await pairThroughOnboarding(await onboardingPage(context, extensionId));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(page.getByText("Cruz family")).toBeVisible();
  await expect(page.getByRole("button", { name: /disconnect|remove|turn off/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(
    page.getByText(/sites your child visits are not sent to eGuard, and eGuard keeps no record of which sites were blocked/),
  ).toBeVisible();
});

test("keyboard: the popup's main action is reachable and works with Enter", async ({
  context,
  extensionId,
  openPopup,
}) => {
  await onboardingPage(context, extensionId);
  const popup = await openPopup();
  await expect(popup.getByRole("button", { name: "Connect to eGuard" })).toBeVisible();
  await popup.keyboard.press("Tab");
  await expect(popup.getByRole("button", { name: "Connect to eGuard" })).toBeFocused();
  const opened = context.waitForEvent("page");
  await popup.keyboard.press("Enter");
  expect((await opened).url()).toContain("/onboarding/index.html");
});

test("accessibility: popup, onboarding and options have no axe violations (WCAG 2.2 AA)", async ({
  context,
  extensionId,
  openPopup,
}) => {
  const onboarding = await onboardingPage(context, extensionId);
  await expect(onboarding.getByRole("heading", { name: "Let's protect this browser" })).toBeVisible();
  await expectNoAxeViolations(onboarding);
  await onboarding.getByRole("button", { name: "Get started" }).click();
  await expectNoAxeViolations(onboarding);

  const popup = await openPopup();
  await expect(popup.getByRole("heading", { name: "Protection configuration required" })).toBeVisible();
  await expectNoAxeViolations(popup);

  await pairThroughOnboarding(
    await context.newPage().then(async (p) => {
      await p.goto(`chrome-extension://${extensionId}/onboarding/index.html`);
      return p;
    }),
  );
  const paired = await openPopup();
  await expect(paired.getByText("Version 1", { exact: true })).toBeVisible();
  await expectNoAxeViolations(paired);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options/index.html`);
  await expect(options.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expectNoAxeViolations(options);
});
