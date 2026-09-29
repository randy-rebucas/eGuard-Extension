import type { HealthCheck } from "@eguard/schemas";
import { CHECK_VISUAL, TONE_CLASS } from "../ui/components.tsx";

/** Checks that count: UNSUPPORTED and NOT_CONFIGURED don't apply here (the server scores the same way). */
export function healthScore(checks: HealthCheck[]) {
  const counted = checks.filter((c) => c.status !== "UNSUPPORTED" && c.status !== "NOT_CONFIGURED");
  return { passed: counted.filter((c) => c.status === "PASS").length, total: counted.length };
}

export const scoreLabel = (checks: HealthCheck[]) => {
  const { passed, total } = healthScore(checks);
  return `${passed} of ${total} checks pass`;
};

/**
 * The self-checks with guidance (spec §13). `compact` (popup) explains only what isn't passing;
 * the options page explains every check.
 */
export function HealthList({ checks, compact = false }: { checks: HealthCheck[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
      {checks.map((c) => {
        const v = CHECK_VISUAL[c.status];
        const explain = !compact || (c.status !== "PASS" && c.status !== "UNSUPPORTED");
        return (
          <li key={c.id} className={`flex items-start gap-2.5 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
            <v.Icon className={`mt-0.5 size-4 shrink-0 ${TONE_CLASS[v.tone].fg}`} aria-label={v.label} />
            <div className="min-w-0 flex-1">
              <p className={`${compact ? "text-[13px]" : "text-sm"} font-semibold`}>{c.title}</p>
              {explain ? (
                <p className={`mt-0.5 leading-snug text-ink-2 ${compact ? "text-xs" : "text-[13px]"}`}>
                  {c.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
