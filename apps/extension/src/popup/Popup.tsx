import { useEffect } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import type { Issue, PolicySummary, ProtectionStatus } from "@eguard/schemas";
import { getExtensionApi } from "@eguard/browser-adapter";
import { useStatus } from "../shared/status-store.ts";
import { browserLabel, relativeTime } from "../shared/format.ts";
import { Button, CHECK_VISUAL, LogoMark, TONE_CLASS, stateVisual } from "../ui/components.tsx";

export function Popup() {
  const { status, error, busy, run } = useStatus();

  useEffect(() => {
    void run({ type: "GET_PROTECTION_STATUS" });
    // Re-read when the worker changes state (sync alarm, pairing finished in the onboarding tab)
    const api = getExtensionApi();
    const onChanged = (_: unknown, area: string) => {
      if (area === "local") void run({ type: "GET_PROTECTION_STATUS" });
    };
    api.storage.onChanged.addListener(onChanged);
    return () => api.storage.onChanged.removeListener(onChanged);
  }, [run]);

  return (
    <main className="w-[360px] bg-bg text-ink" aria-busy={!status}>
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <LogoMark size={30} />
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold tracking-tight">eGuard</div>
          <div className="text-xs text-ink-3">
            {status?.state === "PROTECTED" ? "Protected browser" : "Browser protection"}
          </div>
        </div>
      </header>

      {status ? <Body status={status} /> : <Skeleton />}

      {error ? (
        <p role="alert" className="mx-4 mb-3 rounded-[10px] bg-crit-soft px-3 py-2 text-[13px] text-crit-ink">
          {error.message}
        </p>
      ) : null}

      {status ? (
        <footer className="space-y-2 border-t border-line px-4 pt-3 pb-4">
          {status.connection.paired ? (
            <>
              <p className="text-center text-xs text-ink-3">
                {status.lastHealthCheckAt
                  ? `Last checked ${relativeTime(status.lastHealthCheckAt)}`
                  : "Health check hasn't run yet"}
              </p>
              <Button
                variant="secondary"
                full
                busy={busy === "RUN_HEALTH_CHECK"}
                onClick={() => void run({ type: "RUN_HEALTH_CHECK" })}
              >
                {busy === "RUN_HEALTH_CHECK" ? null : <RefreshCw className="size-4" aria-hidden="true" />}
                Run health check
              </Button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void run({ type: "OPEN_PARENT_DASHBOARD" })}
            className="mx-auto flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-semibold text-accent-ink hover:underline"
          >
            View parent dashboard <ArrowRight className="size-3.5" aria-hidden="true" />
          </button>
        </footer>
      ) : null}
    </main>
  );
}

function Body({ status }: { status: ProtectionStatus }) {
  const { tone, Icon } = stateVisual(status);
  const t = TONE_CLASS[tone];
  const { run, busy } = useStatus();

  return (
    <div className="space-y-3 px-4 pb-4">
      <section
        className="eg-hero rounded-[14px] border border-line p-4 shadow-card"
        aria-labelledby="state-headline"
      >
        <div className="flex items-start gap-3">
          <span
            className={`relative grid size-10 shrink-0 place-items-center rounded-full ${t.soft} ${t.fg}`}
          >
            {status.state === "PROTECTED" ? (
              <span className={`eg-pulse absolute inset-0 rounded-full ${t.soft}`} aria-hidden="true" />
            ) : null}
            <Icon className="relative size-5" aria-hidden="true" />
          </span>
          <div role="status" aria-live="polite">
            <h1 id="state-headline" className="font-display text-[15px] leading-snug font-semibold">
              {status.headline}
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{status.summary}</p>
          </div>
        </div>
        {!status.connection.paired && status.state !== "UNSUPPORTED" ? (
          <Button full className="mt-4" onClick={() => void run({ type: "OPEN_ONBOARDING" })}>
            Connect to eGuard
          </Button>
        ) : null}
      </section>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[14px] border border-line bg-surface px-4 py-3 text-[13px]">
        {status.connection.paired ? (
          <>
            <dt className="text-ink-3">Child</dt>
            <dd className="text-right font-medium">{status.connection.childName}</dd>
            <dt className="text-ink-3">Device</dt>
            <dd className="text-right font-medium">{status.connection.deviceName}</dd>
          </>
        ) : null}
        <dt className="text-ink-3">Browser</dt>
        <dd className="text-right font-medium">{browserLabel(status.browser)}</dd>
        {status.policyVersion !== null ? (
          <>
            <dt className="text-ink-3">Family policy</dt>
            <dd className="text-right font-medium">Version {status.policyVersion}</dd>
          </>
        ) : null}
      </dl>

      {status.policySummary ? <FamilySettings s={status.policySummary} /> : null}

      {status.connection.paired && status.issues.length ? (
        <ul className="space-y-2" aria-label="Issues">
          {status.issues.map((i) => (
            <IssueRow key={i.id} issue={i} busy={busy} onSync={() => void run({ type: "SYNC_POLICY" })} />
          ))}
        </ul>
      ) : null}

      {status.connection.paired && !status.issues.length ? (
        <p className="flex items-center gap-2 text-[13px] text-ok-ink">
          <CheckIcon /> No issues detected
        </p>
      ) : null}
    </div>
  );
}

const OTHER_SITES: Record<PolicySummary["otherSites"], string> = {
  ALLOW: "Allowed",
  WARN: "Warn first",
  BLOCK: "Allowed list only",
};

/** What the family chose, as counts. Whether it's enforced is the status above, not this list. */
function FamilySettings({ s }: { s: PolicySummary }) {
  const rows: [string, string][] = [
    ["Safe Search", s.safeSearch ? "On" : "Off"],
    ["Blocked categories", String(s.blockedCategories)],
    ["Blocked sites", String(s.blockedSites)],
    ["Always allowed", String(s.allowedSites)],
    ["Other websites", OTHER_SITES[s.otherSites]],
    [
      "Focus hours",
      s.focusHours
        ? `${s.focusHours.startTime}–${s.focusHours.endTime}${s.focusHours.activeNow ? " · now" : ""}`
        : "Off",
    ],
  ];
  return (
    <section
      aria-labelledby="family-settings"
      className="rounded-[14px] border border-line bg-surface px-4 py-3"
    >
      <h2 id="family-settings" className="mb-1.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
        Family settings
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CheckIcon() {
  const V = CHECK_VISUAL.PASS.Icon;
  return <V className="size-4" aria-hidden="true" />;
}

function IssueRow({ issue, busy, onSync }: { issue: Issue; busy: string | null; onSync: () => void }) {
  const v = CHECK_VISUAL[issue.status];
  const t = TONE_CLASS[v.tone];
  return (
    <li className="flex items-start gap-2.5 rounded-[12px] border border-line bg-surface p-3">
      <v.Icon className={`mt-0.5 size-4 shrink-0 ${t.fg}`} aria-label={v.label} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{issue.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-2">{issue.detail}</p>
      </div>
      {issue.action === "SYNC_NOW" ? (
        <Button variant="ghost" className="h-8 px-2.5 text-xs" busy={busy === "SYNC_POLICY"} onClick={onSync}>
          Sync now
        </Button>
      ) : null}
    </li>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 px-4 pb-4" aria-hidden="true">
      <div className="h-[92px] animate-pulse rounded-[14px] bg-surface-3" />
      <div className="h-[44px] animate-pulse rounded-[14px] bg-surface-3" />
    </div>
  );
}
