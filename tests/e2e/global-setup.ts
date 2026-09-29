import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_PORT } from "./fixtures.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Builds the Chrome target pointed at the mock backend, into dist-e2e/ (separate from dist/), with a throwaway
 * policy-signing key: the public half is built in, the private half reaches the mock through the environment
 * (Playwright passes globalSetup's process.env to workers). Named E2E_* so the real-backend build never sees it.
 */
export default function globalSetup() {
  const origin = `http://127.0.0.1:${E2E_PORT}`;
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.E2E_POLICY_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const publicKeyB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  execFileSync(
    process.execPath,
    ["apps/extension/scripts/build.ts", "--target", "chrome", "--out", "dist-e2e"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_API_URL: origin,
        VITE_WEB_APP_URL: origin,
        VITE_ENVIRONMENT: "development",
        VITE_POLICY_PUBLIC_KEY: publicKeyB64,
      },
    },
  );
}
