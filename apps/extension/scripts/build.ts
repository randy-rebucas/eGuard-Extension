/**
 * Builds the extension for each browser into dist/<target>/.
 *
 *   node scripts/build.ts                     # all targets, production mode
 *   node scripts/build.ts --target firefox    # one target
 *   node scripts/build.ts --target chrome --watch   # dev: rebuild on change
 *   node scripts/build.ts --out ../../dist-e2e      # custom output (tests)
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { build, loadEnv } from "vite";
import { BuildTarget } from "@eguard/schemas";
import { parseEnv } from "../src/config/env.ts";
import { buildManifest } from "../src/config/manifest.ts";
import { appDir, backgroundConfig, pagesConfig, repoRoot } from "./vite-configs.ts";

const { values } = parseArgs({
  options: {
    target: { type: "string", default: "all" },
    watch: { type: "boolean", default: false },
    out: { type: "string", default: path.join(repoRoot, "dist") },
  },
});

const targets: BuildTarget[] =
  values.target === "all" ? [...BuildTarget.options] : [BuildTarget.parse(values.target)];
if (values.watch && targets.length !== 1)
  throw new Error("--watch builds one target; pass --target chrome|edge|firefox");

const mode = values.watch ? "development" : "production";
const env = parseEnv(loadEnv(mode, repoRoot, "VITE_"));
const define = Object.fromEntries(
  Object.entries(env).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
);
const pkg = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf8")) as { version: string };
const outRoot = path.resolve(values.out);

async function writeManifest(target: BuildTarget, dir: string) {
  await mkdir(dir, { recursive: true });
  const manifest = buildManifest({ target, version: pkg.version, env });
  await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (values.watch) {
  const target = targets[0]!;
  const dir = path.join(outRoot, target);
  await rm(dir, { recursive: true, force: true });
  await writeManifest(target, dir);
  const common = { mode, define, watch: true };
  await Promise.all([build(pagesConfig(dir, common)), build(backgroundConfig(dir, common))]);
  console.log(
    `Watching. Load ${dir} as an unpacked extension; reload it after changes to the background worker.`,
  );
} else {
  const stage = path.join(outRoot, ".stage");
  await rm(stage, { recursive: true, force: true });
  const common = { mode, define, watch: false };
  await build(pagesConfig(stage, common));
  await build(backgroundConfig(stage, common));
  for (const target of targets) {
    const dir = path.join(outRoot, target);
    await rm(dir, { recursive: true, force: true });
    await cp(stage, dir, { recursive: true });
    await writeManifest(target, dir);
    console.log(
      `Built ${target} → ${path.relative(process.cwd(), dir)}  (API ${env.VITE_API_URL}, ${env.VITE_ENVIRONMENT})`,
    );
  }
  await rm(stage, { recursive: true, force: true });
}
