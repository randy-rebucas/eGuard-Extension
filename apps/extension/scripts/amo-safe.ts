import type { Plugin } from "vite";

/**
 * Removes the two code patterns Firefox's add-on validator warns about ("The Function constructor is eval",
 * "Unsafe assignment to innerHTML"), which AMO lists as possible grounds for rejection. Both live in libraries
 * and are unreachable in eGuard:
 * - Zod builds faster validators with `new Function` when eval is allowed. The extension CSP forbids eval,
 *   so Zod already falls back to its normal mode; here the constructor is replaced by one that throws,
 *   which is the fallback path Zod handles (see its try/catch around each use).
 * - React DOM sets innerHTML to render <script> elements and for dangerouslySetInnerHTML. eGuard renders
 *   neither (lint forbids dangerouslySetInnerHTML), so those branches throw instead.
 *
 * Every patch must match exactly as often as expected, or the build fails: a library upgrade that moves the
 * code gets noticed instead of quietly bringing the warnings back.
 */
type Patch = { file: RegExp; find: string; replace: string; count: number };

const NO_EVAL = `function () { throw new EvalError("eGuard: code generation is disabled"); }`;
const NO_HTML = `(() => { throw Error("eGuard: HTML strings are not rendered"); })()`;

const PATCHES: Patch[] = [
  {
    file: /zod\/v4\/core\/util\.js$/,
    find: "const F = Function;",
    replace: `const F = ${NO_EVAL};`,
    count: 1,
  },
  {
    file: /zod\/v4\/core\/doc\.js$/,
    find: "const F = Function;",
    replace: `const F = ${NO_EVAL};`,
    count: 1,
  },
  {
    file: /zod\/v4\/core\/compile\.js$/,
    find: "const F = Function;",
    replace: `const F = ${NO_EVAL};`,
    count: 1,
  },
  {
    file: /react-dom\/cjs\/react-dom-client\.production\.js$/,
    find: `nextResource.innerHTML = "<script>\\x3c/script>";`,
    replace: `${NO_HTML};`,
    count: 1,
  },
  {
    file: /react-dom\/cjs\/react-dom-client\.production\.js$/,
    find: "(domElement.innerHTML = key)",
    replace: NO_HTML,
    count: 2,
  },
];

/** `verify`: fail the build if the output still has either pattern (production builds; dev React differs). */
export function amoSafe({ verify }: { verify: boolean }): Plugin {
  const applied = new Map<Patch, number>();
  return {
    name: "eguard-amo-safe",
    enforce: "pre",
    buildStart() {
      applied.clear();
    },
    transform(code, id) {
      const file = id.split("?")[0]!.replaceAll("\\", "/");
      let out = code;
      for (const p of PATCHES) {
        if (!p.file.test(file)) continue;
        const n = out.split(p.find).length - 1;
        if (n !== p.count) {
          this.error(`amo-safe: expected ${p.count}× ${JSON.stringify(p.find)} in ${file}, found ${n}`);
        }
        out = out.replaceAll(p.find, p.replace);
        applied.set(p, (applied.get(p) ?? 0) + 1);
      }
      return out === code ? null : { code: out, map: null };
    },
    generateBundle(_, bundle) {
      if (!verify) return;
      // A module that isn't in this bundle (React isn't in the worker) needs no patch; one that is must be patched
      const js = Object.values(bundle).flatMap((c) => (c.type === "chunk" ? [c] : []));
      const modules = js.flatMap((c) => Object.keys(c.modules).map((m) => m.replaceAll("\\", "/")));
      for (const p of PATCHES) {
        if (modules.some((m) => p.file.test(m)) && !applied.get(p)) {
          this.error(`amo-safe: ${p.file} is bundled but was not patched`);
        }
      }
      for (const c of js) {
        const hit = /\bnew Function\b|[^\w.$]Function\(|\.innerHTML\s*=[^=]/.exec(c.code);
        if (hit) this.error(`amo-safe: ${c.fileName} still contains ${JSON.stringify(hit[0])}`);
      }
    },
  };
}
