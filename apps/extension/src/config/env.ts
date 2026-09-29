import { z } from "zod";

export const Environment = z.enum(["development", "staging", "production"]);

const origin = z
  .url()
  .transform((u) => new URL(u))
  .refine(
    (u) => u.pathname === "/" && !u.search && !u.hash,
    "Use an origin only, e.g. https://www.eguard.family",
  )
  .transform((u) => u.origin);

/**
 * Build-time configuration (spec §46). Validated when building, so a bad or missing value
 * fails the build instead of shipping an extension that silently can't reach eGuard.
 */
export const EnvSchema = z
  .object({
    VITE_API_URL: origin,
    VITE_WEB_APP_URL: origin,
    VITE_ENVIRONMENT: Environment,
    /** base64 SPKI of the key that signs browser policies (~/eguard: node scripts/browser-policy-keys.mjs) */
    VITE_POLICY_PUBLIC_KEY: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9+/]{80,}={0,2}$/, "Set the policy public key from the eGuard server (base64 SPKI)"),
  })
  .superRefine((env, ctx) => {
    if (env.VITE_ENVIRONMENT !== "production") return;
    for (const key of ["VITE_API_URL", "VITE_WEB_APP_URL"] as const) {
      if (!env[key].startsWith("https://"))
        ctx.addIssue({ code: "custom", path: [key], message: "Production builds must use https://" });
    }
  });
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "env"}: ${i.message}`);
  throw new Error(`Invalid extension environment (see .env.example):\n${lines.join("\n")}`);
}
