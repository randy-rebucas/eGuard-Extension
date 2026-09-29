import { useEffect, type ReactNode } from "react";
import {
  ArrowRight,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Clock,
  Globe,
  LayoutGrid,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Issue, PolicySummary, ProtectionStatus } from "@eguard/schemas";
import { getExtensionApi } from "@eguard/browser-adapter";
import { useStatus } from "../shared/status-store.ts";
import { browserLabel, relativeTime } from "../shared/format.ts";
import { categoryVisual } from "../shared/categories.ts";
import { HealthList, scoreLabel } from "../shared/HealthList.tsx";
import {
  Avatar,
  Button,
  CHECK_VISUAL,
  LogoMark,
  TONE_CLASS,
  stateVisual,
  type Tone,
} from "../ui/components.tsx";

const openSettings = () => void getExtensionApi().runtime.openOptionsPage();

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
        <LogoMark size={28} />
        <div className="flex-1 font-display text-[17px] font-semibold tracking-tight">eGuard</div>
        {/* Until the browser is connected, "Connect to eGuard" stays the first thing Tab reaches */}
        {status?.connection.paired ? (
          <button
            type="button"
            onClick={openSettings}
            aria-label="Settings"
            className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-3 hover:text-ink"
          >
            <Settings className="size-[18px]" aria-hidden="true" />
          </button>
        ) : null}
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

/** Short state for the profile line: "Protected", "Needs attention"… */
const STATE_WORD: Record<ProtectionStatus["state"], string> = {
  PROTECTED: "Protected",
  NEEDS_ATTENTION: "Needs attention",
  ACTION_REQUIRED: "Action required",
  SYNC_PAUSED: "Sync paused",
  UNSUPPORTED: "Not supported",
};

function Body({ status }: { status: ProtectionStatus }) {
  const { tone, Icon } = stateVisual(status);
  const t = TONE_CLASS[tone];
  const { run, busy } = useStatus();
  const c = status.connection;

  return (
    <div className="space-y-3 px-4 pb-4">
      {c.paired ? (
        <div className="flex items-center gap-3 px-0.5">
          <Avatar name={c.childName} />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-[16px] font-semibold">{c.childName}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
              <span className="truncate">{c.deviceName}</span>
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${t.dot}`} />
              <span className={`shrink-0 font-semibold ${t.fg}`}>{STATE_WORD[status.state]}</span>
            </p>
          </div>
        </div>
      ) : null}

      <section
        className={`rounded-[14px] border p-3.5 ${status.state === "PROTECTED" ? "border-ok/25 bg-ok-soft" : "eg-hero border-line shadow-card"}`}
        aria-labelledby="state-headline"
      >
        <div className="flex items-start gap-3">
          <span
            className={`relative grid size-10 shrink-0 place-items-center rounded-full ${status.state === "PROTECTED" ? "bg-ok text-white" : `${t.soft} ${t.fg}`}`}
          >
            {status.state === "PROTECTED" ? (
              <span className="eg-pulse absolute inset-0 rounded-full bg-ok" aria-hidden="true" />
            ) : null}
            <Icon className="relative size-5" aria-hidden="true" />
          </span>
          <div role="status" aria-live="polite" className="min-w-0 flex-1">
            <h1
              id="state-headline"
              className={`font-display text-[15px] leading-snug font-semibold ${status.state === "PROTECTED" ? "text-ok-ink" : ""}`}
            >
              {status.headline}
            </h1>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{status.summary}</p>
          </div>
          {c.paired ? (
            <button
              type="button"
              onClick={openSettings}
              aria-label="Protection details"
              className="-mr-1 grid size-7 shrink-0 place-items-center self-center rounded-md text-ink-3 hover:bg-surface/70 hover:text-ink"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {!c.paired && status.state !== "UNSUPPORTED" ? (
          <Button full className="mt-4" onClick={() => void run({ type: "OPEN_ONBOARDING" })}>
            Connect to eGuard
          </Button>
        ) : null}
      </section>

      {status.policySummary ? (
        <FamilySettings s={status.policySummary} protectedNow={status.state === "PROTECTED"} />
      ) : null}

      {status.policySummary ? <TodayActivity counts={status.policySummary.blockedToday} /> : null}

      {c.paired && status.issues.length ? (
        <ul className="space-y-2" aria-label="Issues">
          {status.issues.map((i) => (
            <IssueRow key={i.id} issue={i} busy={busy} onSync={() => void run({ type: "SYNC_POLICY" })} />
          ))}
        </ul>
      ) : null}

      {c.paired && !status.issues.length ? (
        <p className="flex items-center gap-2 px-0.5 text-[13px] text-ok-ink">
          <CheckIcon /> No issues detected
        </p>
      ) : null}

      {status.checks.length ? (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-0.5 py-1 text-[13px] font-semibold text-ink-2 hover:text-ink">
            Health checks
            <span className="flex items-center gap-1 font-normal text-ink-3">
              {scoreLabel(status.checks)}
              <ChevronDown
                className="size-3.5 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </span>
          </summary>
          <div className="mt-2">
            <HealthList checks={status.checks} compact />
          </div>
        </details>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-0.5 text-xs">
        <dt className="text-ink-3">Browser</dt>
        <dd className="text-right text-ink-2">{browserLabel(status.browser)}</dd>
        {status.policyVersion !== null ? (
          <>
            <dt className="text-ink-3">Family policy</dt>
            <dd className="text-right text-ink-2">Version {status.policyVersion}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

const OTHER_SITES: Record<PolicySummary["otherSites"], string> = {
  ALLOW: "Allowed",
  WARN: "Warn first",
  BLOCK: "Allowed list only",
};

type Row = { Icon: LucideIcon; label: string; value: ReactNode };

function Toggle({ on }: { on: boolean }) {
  return <Badge tone={on ? "ok" : "muted"}>{on ? "ON" : "OFF"}</Badge>;
}

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE_CLASS[tone];
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${t.soft} ${t.fg}`}>
      {children}
    </span>
  );
}

/**
 * What the family chose, as switches and counts. Whether it's enforced is the status above;
 * "Web protection" only reads ON when that status is Protected.
 */
function FamilySettings({ s, protectedNow }: { s: PolicySummary; protectedNow: boolean }) {
  const rows: Row[] = [
    {
      Icon: ShieldCheck,
      label: "Web protection",
      value: protectedNow ? <Toggle on /> : <Badge tone="warn">CHECK</Badge>,
    },
    { Icon: Search, label: "Safe Search", value: <Toggle on={s.safeSearch} /> },
    {
      Icon: Clock,
      label: s.focusHours ? `Focus hours · ${s.focusHours.startTime}–${s.focusHours.endTime}` : "Focus hours",
      value: s.focusHours?.activeNow ? <Badge tone="accent">NOW</Badge> : <Toggle on={!!s.focusHours} />,
    },
    { Icon: LayoutGrid, label: "Blocked categories", value: s.blockedCategories },
    { Icon: CircleX, label: "Blocked sites", value: s.blockedSites },
    { Icon: CircleCheck, label: "Allowed sites", value: s.allowedSites },
    { Icon: Globe, label: "Other websites", value: OTHER_SITES[s.otherSites] },
  ];
  return (
    <section aria-labelledby="family-settings">
      <h2 id="family-settings" className="sr-only">
        Family settings
      </h2>
      <dl className="divide-y divide-line rounded-[14px] border border-line bg-surface px-3.5">
        {rows.map(({ Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 py-2.5 text-[13px]">
            <Icon className="size-[18px] shrink-0 text-ink-3" aria-hidden="true" />
            <dt className="flex-1 text-ink">{label}</dt>
            <dd className="font-semibold text-ink-2 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Today's blocked pages by kind. The same counts the parent sees; never which sites. */
function TodayActivity({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const max = entries[0]?.[1] ?? 1;
  return (
    <details className="group rounded-[14px] border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-[13px] font-semibold text-accent-ink hover:bg-surface-2">
        <ChartColumn className="size-[18px]" aria-hidden="true" />
        <span className="flex-1">View today's activity</span>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-line px-3.5 py-3">
        <p className="text-[13px] text-ink-2">
          {total === 0
            ? "Nothing has been blocked today."
            : `${total} ${total === 1 ? "page" : "pages"} blocked today.`}
        </p>
        {entries.length ? (
          <ul className="mt-2.5 space-y-2">
            {entries.map(([key, n]) => {
              const { label, Icon } = categoryVisual(key);
              return (
                <li key={key} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Icon className="size-3.5 text-ink-3" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <span className="font-semibold tabular-nums">{n}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-3" aria-hidden="true">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(n / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-3">
          Counts only. eGuard never records which websites were visited.
        </p>
      </div>
    </details>
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
      <div className="h-[44px] animate-pulse rounded-[14px] bg-surface-3" />
      <div className="h-[80px] animate-pulse rounded-[14px] bg-surface-3" />
      <div className="h-[220px] animate-pulse rounded-[14px] bg-surface-3" />
    </div>
  );
}
