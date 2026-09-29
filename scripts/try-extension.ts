/**
 * Manual try-out: builds dist-manual/chrome against the E2E mock backend with a throwaway signing key,
 * then keeps the mock running on http://127.0.0.1:3299. Pairing code: 824917. Ctrl+C to stop.
 * Run from the repo root: npm run try
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const PORT = 3299;
const origin = `http://127.0.0.1:${PORT}`;
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
process.env.E2E_POLICY_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

execFileSync(
  process.execPath,
  ["apps/extension/scripts/build.ts", "--target", "chrome", "--out", "dist-manual"],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_API_URL: origin,
      VITE_WEB_APP_URL: origin,
      VITE_ENVIRONMENT: "development",
      VITE_POLICY_PUBLIC_KEY: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    },
  },
);

const mock = (await import(pathToFileURL(path.join(root, "tests/e2e/mock-backend.ts")).href)) as {
  startMockBackend: (port: number) => Promise<unknown>;
};
await mock.startMockBackend(PORT);
console.log(`\nMock eGuard running on ${origin}`);
console.log(`Load unpacked: ${path.join(root, "dist-manual", "chrome")}`);
console.log("Pairing code: 824917   (Ctrl+C to stop)");
