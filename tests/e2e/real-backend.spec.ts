import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";

/**
 * The extension against a real eGuard server (~/eguard), not the mock. Opt-in:
 *
 *   EGUARD_API_URL=http://localhost:3217 npx playwright test real-backend
 *
 * The server must send email to Mailpit (SMTP_URL=smtp://localhost:1025) and allowlist local addresses
 * (RATE_LIMIT_IP_ALLOWLIST=::1,127.0.0.1), as for ~/eguard's own API tests.
 */
const API = process.env.EGUARD_API_URL ?? "";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(root, "dist-real/chrome");

type Json = Record<string, unknown>;
async function mobile(method: string, p: string, o: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}/api/mobile/v1${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-eguard-client": "android",
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  return { status: res.status, data: (await res.json()) as Json };
}

async function verifyEmail(to: string) {
  for (let i = 0; i < 50; i++) {
    const r = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as {
      messages?: { ID: string }[];
    };
    for (const m of r.messages ?? []) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      const token = /verify-email\?token=([\w-]+)/.exec(full.Text)?.[1];
      if (token) {
        expect((await mobile("POST", "/auth/verify-email", { body: { token } })).status).toBe(200);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No verification email for ${to} in Mailpit`);
}

test.skip(!API, "Set EGUARD_API_URL to run against a real eGuard server");

test("pairs with a real eGuard server, then is disconnected when the parent removes it", async () => {
  test.setTimeout(120_000);
  execFileSync(
    process.execPath,
    ["apps/extension/scripts/build.ts", "--target", "chrome", "--out", "dist-real"],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, VITE_API_URL: API, VITE_WEB_APP_URL: API, VITE_ENVIRONMENT: "development" },
    },
  );

  // A parent signs up, verifies their email and asks for a browser code, as they would in the dashboard
  const who = `ext.${Date.now().toString(36)}@mobile-test.example`;
  const password = "CorrectHorse123!";
  const reg = await mobile("POST", "/auth/register", {
    body: { name: "Extension Test", email: who, password, guardian: true },
  });
  expect(reg.status).toBe(201);
  const token = reg.data.token as string;
  await verifyEmail(who);
  const child = await mobile("POST", "/children", { token, body: { name: "Mia", age: 10 } });
  const code = await mobile("POST", `/children/${child.data.id as string}/pairing-code`, {
    token,
    body: { kind: "BROWSER", deviceLabel: "Mia's MacBook" },
  });
  expect(code.status).toBe(201);

  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    args: [
      `--disable-extensions-except=${DIR}`,
      `--load-extension=${DIR}`,
      // Test "websites": *.example hosts resolve to this machine (the eGuard server answers them)
      "--host-resolver-rules=MAP *.example 127.0.0.1",
    ],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    const url = `chrome-extension://${id}/onboarding/index.html`;
    const page =
      context.pages().find((p) => p.url() === url) ??
      (await context.waitForEvent("page", { predicate: (p) => p.url() === url }));

    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("Pairing code").fill(code.data.code as string);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByRole("heading", { name: "Review protection" })).toBeVisible();
    await expect(
      page.getByText("This browser protects Mia on Mia's MacBook", { exact: false }),
    ).toBeVisible();

    // The server lists it for the parent
    const list = await mobile("GET", "/browsers", { token });
    const browsers = list.data.browsers as {
      id: string;
      deviceLabel: string;
      browser: string;
      connected: boolean;
    }[];
    expect(browsers).toHaveLength(1);
    expect(browsers[0]).toMatchObject({ deviceLabel: "Mia's MacBook", browser: "Chrome", connected: true });

    // The signed policy (age-based defaults, version 1) verified with the key built into the extension, and its
    // rules installed. Not "Protected": Chromium doesn't allow extensions in private windows by default.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/index.html`);
    await expect(popup.getByText("Mia", { exact: true })).toBeVisible();
    await expect(popup.getByText("Version 1", { exact: true })).toBeVisible();
    const settings = popup.getByRole("region", { name: "Family settings" });
    await expect(settings.getByText("Safe Search")).toBeVisible();
    await expect(popup.getByText("Private windows aren't protected")).toBeVisible();
    await expect(popup.getByText("Website protection not active")).toHaveCount(0);
    await expect(popup.getByText("Protection active")).toHaveCount(0);

    // A parent's change arrives as the next signed version
    const put = await mobile("PUT", `/children/${child.data.id as string}/browser-policy`, {
      token,
      body: {
        safeBrowsing: true,
        safeSearch: true,
        blockedCategories: ["ADULT", "GAMING"],
        blockedDomains: ["blocked.example", "another.example"],
        allowedDomains: ["school.example"],
        unknownSitesPolicy: "WARN",
        schedule: null,
      },
    });
    expect(put.status).toBe(200);
    await popup.getByRole("button", { name: "Run health check" }).click();
    await expect(popup.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(settings.getByText("Warn first")).toBeVisible();
    const blockedRow = settings.getByText("Blocked sites").locator("xpath=following-sibling::dd[1]");
    await expect(blockedRow).toHaveText("2");

    // Real blocking: the browser enforces the rules and eGuard's block page takes over
    const port = new URL(API).port || "80";
    const blockedUrl = `http://blocked.example:${port}/`;
    const site = await context.newPage();
    await site.goto(blockedUrl).catch(() => {});
    await expect(site).toHaveURL(/\/blocked\/index\.html\?u=/, { timeout: 10_000 });
    await expect(site.getByRole("heading", { name: "This website is blocked" })).toBeVisible();

    // Mia asks; the parent sees the request and allows it for an hour; "Check again" opens the site
    await site.getByRole("button", { name: "Ask a parent" }).click();
    await site.getByLabel(/Why do you need it/).fill("Homework");
    await site.getByRole("button", { name: "Send to a parent" }).click();
    await expect(site.getByText(/You asked a parent/)).toBeVisible();
    const pending = await mobile("GET", `/children/${child.data.id as string}/browser-access-requests`, {
      token,
    });
    const req = (pending.data.pending as { id: string; domain: string; reason: string }[])[0]!;
    expect(req).toMatchObject({ domain: "blocked.example", reason: "Homework" });
    expect(
      (
        await mobile("POST", `/browser-access-requests/${req.id}`, {
          token,
          body: { decision: "APPROVE", duration: "1H" },
        })
      ).status,
    ).toBe(200);
    await site.getByRole("button", { name: "Check again" }).click();
    await expect(site).toHaveURL(blockedUrl, { timeout: 10_000 });

    // Parent removes the browser; the next check tells the extension, which forgets the connection
    const removed = await mobile("DELETE", `/browsers/${browsers[0]!.id}`, { token, body: { password } });
    expect(removed.status).toBe(200);
    await popup.getByRole("button", { name: "Run health check" }).click();
    await expect(popup.getByRole("button", { name: "Connect to eGuard" })).toBeVisible();
  } finally {
    await context.close();
  }
});
