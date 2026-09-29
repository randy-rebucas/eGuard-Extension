import { Check, X } from "lucide-react";

/**
 * What eGuard does and doesn't do in this browser. Keep in step with docs/PRIVACY.md.
 * DOES_NOT is a promise: every line must stay true of the shipped code at all times.
 */
export const DOES = [
  "Blocks websites that don't match your family's protection settings",
  "Turns on SafeSearch where this browser allows it",
  "Checks that its protection is still set up correctly",
  "Tells parents when protection needs attention",
  "Counts how many pages it blocked each day, by category, never which ones",
];

export const DOES_NOT = [
  "Keep a history of the websites your child visits",
  "Read messages, emails or page content",
  "Record keystrokes or passwords",
  "Take screenshots or use the camera or microphone",
  "Sell data or build advertising profiles",
];

export function PrivacySummary({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">eGuard does</h3>
        <ul className="space-y-1.5">
          {DOES.map((d) => (
            <li key={d} className="flex gap-2 text-[13px] leading-snug">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
              {d}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">eGuard does not</h3>
        <ul className="space-y-1.5">
          {DOES_NOT.map((d) => (
            <li key={d} className="flex gap-2 text-[13px] leading-snug">
              <X className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden="true" />
              {d}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
