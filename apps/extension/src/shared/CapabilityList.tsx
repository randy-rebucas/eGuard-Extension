import { capabilitiesFor } from "@eguard/browser-adapter";
import type { BrowserFamily } from "@eguard/schemas";
import { LEVEL_VISUAL, Pill } from "../ui/components.tsx";

/**
 * What eGuard can do in this browser, from the capability matrix. It describes ability, not current
 * state: whether each protection is actually active comes from the health check.
 */
export function CapabilityList({ family }: { family: BrowserFamily }) {
  const caps = capabilitiesFor(family).filter((c) => c.id !== "HEALTH_CHECK" && c.id !== "POLICY_SYNC");
  return (
    <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
      {caps.map((c) => {
        const v = LEVEL_VISUAL[c.level];
        return (
          <li key={c.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{c.label}</p>
              <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{c.note}</p>
            </div>
            <Pill tone={v.tone}>{v.label}</Pill>
          </li>
        );
      })}
    </ul>
  );
}
