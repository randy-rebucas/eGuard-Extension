import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Globe,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  MonitorSmartphone,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
  ShieldPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { PolicySummary, ProtectionStatus } from "@eguard/schemas";
import { useStatus } from "../shared/status-store.ts";
import { browserLabel, relativeTime } from "../shared/format.ts";
import { CATEGORIES } from "../shared/categories.ts";
import { CapabilityList } from "../shared/CapabilityList.tsx";
import { HealthList, scoreLabel } from "../shared/HealthList.tsx";
import { PrivacySummary } from "../shared/PrivacySummary.tsx";
import { Avatar, Button, Card, LogoMark, StateSwitch, TONE_CLASS, stateVisual } from "../ui/components.tsx";

const NAV: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "protection", label: "Web protection", Icon: ShieldCheck },
  { id: "categories", label: "Categories", Icon: LayoutGrid },
  { id: "websites", label: "Custom websites", Icon: Globe },
  { id: "health", label: "Health", Icon: Activity },
  { id: "browser", label: "Browser support", Icon: MonitorSmartphone },
  { id: "privacy", label: "Privacy", Icon: Lock },
];

/**
 * Settings for the child's browser, shown as they are. Protection is managed by parents in the eGuard
 * dashboard; nothing here can weaken it (spec §17), including disconnecting the browser. The switches
 * and checkboxes report the family policy; they are not controls.
 */
export function Options() {
  const { status, run } = useStatus();
  useEffect(() => {
    void run({ type: "GET_PROTECTION_STATUS" });
  }, [run]);
  const active = useActiveSection(!!status);

  const s = status?.policySummary ?? null;
  return (
    <div className="eg-page min-h-screen px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-[1080px] lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        <aside className="lg:sticky lg:top-10 lg:self-start">
          <div className="mb-5 flex items-center gap-2.5 px-1">
            <LogoMark size={34} />
            <span className="font-display text-xl font-semibold tracking-tight">eGuard</span>
          </div>
          <nav
            aria-label="Settings sections"
            className="-mx-1 mb-6 overflow-x-auto lg:mx-0 lg:overflow-visible"
          >
            <ul className="flex gap-1 px-1 lg:flex-col lg:px-0">
              {NAV.map(({ id, label, Icon }) => (
                <li key={id} className="shrink-0">
                  <a
                    href={`#${id}`}
                    aria-current={active === id ? "true" : undefined}
                    className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                      active === id
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "text-ink-2 hover:bg-surface-3 hover:text-ink"
                    }`}
                  >
                    <Icon className="size-[18px]" aria-hidden="true" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <header>
            <h1 className="font-display text-2xl font-semibold tracking-tight">eGuard settings</h1>
            <p className="mt-1 text-sm text-ink-3">
              How eGuard protects this browser. Parents change these settings in the eGuard dashboard.
            </p>
          </header>
          {status ? (
            <>
              <Overview status={status} />
              <Section title="Web protection" id="protection" hint="What eGuard applies in this browser.">
                <ProtectionPanel status={status} s={s} />
              </Section>
              <Section
                title="Website categories"
                id="categories"
                hint="Kinds of websites your family's settings block."
              >
                {s ? <CategoryGrid blocked={s.categories} /> : <NotConnected />}
              </Section>
              <Section
                title="Custom websites"
                id="websites"
                hint="Specific websites your family blocks or always allows."
              >
                {s ? <CustomWebsites s={s} /> : <NotConnected />}
              </Section>
              {status.checks.length ? (
                <Section title="Health" id="health">
                  <p className="mb-4 text-sm leading-relaxed text-ink-2">
                    {scoreLabel(status.checks)}.{" "}
                    {status.lastHealthCheckAt
                      ? `Last checked ${relativeTime(status.lastHealthCheckAt)}.`
                      : "Not checked yet."}{" "}
                    eGuard checks every few minutes and tells the parents in the dashboard when something
                    changes.
                  </p>
                  <HealthList checks={status.checks} />
                </Section>
              ) : null}
              <Section title="Browser support" id="browser">
                <p className="mb-4 text-sm leading-relaxed text-ink-2">
                  What eGuard can do in {status.browser.name}. Parents choose which protections are on in the
                  dashboard.
                </p>
                <CapabilityList family={status.browser.family} />
              </Section>
              <Privacy />
            </>
          ) : (
            <div className="h-48 animate-pulse rounded-[14px] bg-surface-3" aria-label="Loading" />
          )}
        </main>
      </div>
    </div>
  );
}

/** The section whose heading was scrolled to most recently, for the sidebar highlight. */
function useActiveSection(ready: boolean) {
  const [active, setActive] = useState(NAV[0]!.id);
  useEffect(() => {
    if (!ready) return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) seen.add(e.target.id);
          else seen.delete(e.target.id);
        }
        const first = NAV.find((n) => seen.has(n.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const n of NAV) {
      const el = document.getElementById(n.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ready]);
  return active;
}

function Section({
  title,
  id,
  hint,
  children,
}: {
  title: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6">
        <h2 id={`${id}-title`} className="font-display text-lg font-semibold">
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-sm text-ink-3">{hint}</p> : null}
        <div className="mt-4">{children}</div>
      </section>
    </Card>
  );
}

function NotConnected() {
  return (
    <p className="rounded-[12px] bg-surface-2 px-4 py-3 text-sm text-ink-2">
      Connect this browser to eGuard to see your family's settings here.
    </p>
  );
}

function Overview({ status }: { status: ProtectionStatus }) {
  const { run } = useStatus();
  const c = status.connection;
  const { tone } = stateVisual(status);
  const rows: [string, string][] = c.paired
    ? [
        ["Connected family", c.familyName],
        ["Device", c.deviceName],
        ["Browser", browserLabel(status.browser)],
        ["Last sync", relativeTime(status.lastSyncAt) ?? "Not yet"],
      ]
    : [["Browser", browserLabel(status.browser)]];
  return (
    <Section title="Overview" id="overview">
      <div className="flex items-center gap-3">
        {c.paired ? (
          <Avatar name={c.childName} size={48} />
        ) : (
          <span className="grid size-12 place-items-center rounded-full bg-surface-3 text-ink-3">
            <UserRound className="size-6" aria-hidden="true" />
          </span>
        )}
        <div>
          <p className="font-display text-base font-semibold">{c.paired ? c.childName : "Not connected"}</p>
          <p className={`mt-0.5 inline-flex items-center gap-2 text-sm font-semibold ${TONE_CLASS[tone].fg}`}>
            <span className={`size-2 rounded-full ${TONE_CLASS[tone].dot}`} aria-hidden="true" />
            {status.headline}
          </p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-[minmax(0,180px)_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {c.paired ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-3">
          To disconnect this browser, a parent removes it in the eGuard dashboard under the child's devices.
        </p>
      ) : (
        <Button className="mt-5" onClick={() => void run({ type: "OPEN_ONBOARDING" })}>
          Connect to eGuard
        </Button>
      )}
    </Section>
  );
}

const LEVELS: {
  id: PolicySummary["otherSites"];
  title: string;
  body: string;
  Icon: LucideIcon;
}[] = [
  {
    id: "ALLOW",
    title: "Balanced",
    body: "Blocks the categories and websites your family chose",
    Icon: ShieldHalf,
  },
  { id: "WARN", title: "Cautious", body: "Asks first before opening a new website", Icon: Scale },
  { id: "BLOCK", title: "Strict", body: "Only websites on the allowed list open", Icon: ShieldPlus },
];

function ProtectionPanel({ status, s }: { status: ProtectionStatus; s: PolicySummary | null }) {
  const on = status.state === "PROTECTED";
  const { tone, Icon } = stateVisual(status);
  const t = TONE_CLASS[tone];
  return (
    <>
      <div
        className={`flex items-center gap-4 rounded-[14px] border p-4 ${on ? "border-ok/25 bg-ok-soft" : "border-line bg-surface-2"}`}
      >
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full ${on ? "bg-ok text-white" : `${t.soft} ${t.fg}`}`}
        >
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-display text-base font-semibold ${on ? "text-ok-ink" : ""}`}>
            Web protection is {on ? "on" : "not fully on"}
          </p>
          <p className="mt-0.5 text-sm text-ink-2">{status.summary}</p>
        </div>
        <StateSwitch on={on} label="Web protection" />
      </div>

      {s ? (
        <>
          <h3 className="mt-6 mb-2.5 text-sm font-semibold">Protection level</h3>
          <ul className="grid gap-3 sm:grid-cols-3">
            {LEVELS.map((l) => {
              const current = l.id === s.otherSites;
              return (
                <li
                  key={l.id}
                  className={`relative flex gap-3 rounded-[12px] border p-3.5 ${
                    current ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-line bg-surface"
                  }`}
                >
                  <l.Icon
                    className={`mt-0.5 size-6 shrink-0 ${current ? "text-accent-ink" : "text-ink-3"}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {l.title}
                      {current ? <span className="sr-only"> (current)</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-ink-3">{l.body}</p>
                  </div>
                  {current ? (
                    <Check className="absolute top-2.5 right-2.5 size-4 text-accent-ink" aria-hidden="true" />
                  ) : null}
                </li>
              );
            })}
          </ul>

          <h3 className="mt-6 mb-2.5 text-sm font-semibold">Protection features</h3>
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            <Feature
              Icon={Globe}
              title="Safe Browsing"
              body="Warns about dangerous and deceptive websites"
              on={s.safeBrowsing}
            />
            <Feature
              Icon={Search}
              title="Safe Search"
              body="Filters explicit results in search engines that support it"
              on={s.safeSearch}
            />
            <Feature
              Icon={ShieldAlert}
              title="Block adult content"
              body="Keeps adult websites from opening"
              on={s.categories.includes("ADULT")}
            />
            <Feature
              Icon={Clock}
              title="Focus hours"
              body={
                s.focusHours
                  ? `Only allowed websites open ${s.focusHours.startTime}–${s.focusHours.endTime}${s.focusHours.activeNow ? " (now)" : ""}`
                  : "Only allowed websites open during set hours"
              }
              on={!!s.focusHours}
            />
          </ul>
        </>
      ) : null}
    </>
  );
}

function Feature({ Icon, title, body, on }: { Icon: LucideIcon; title: string; body: string; on: boolean }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Icon className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
        <p className="text-sm font-medium sm:w-44 sm:shrink-0">{title}</p>
        <p className="text-[13px] text-ink-3">{body}</p>
      </div>
      <StateSwitch on={on} label={title} />
    </li>
  );
}

function CategoryGrid({ blocked }: { blocked: PolicySummary["categories"] }) {
  const set = new Set(blocked);
  return (
    <ul className="grid gap-x-6 gap-y-0.5 rounded-[12px] border border-line p-2 sm:grid-cols-2">
      {CATEGORIES.map(({ id, label, Icon }) => {
        const on = set.has(id);
        return (
          <li key={id} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm">
            <span
              className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${
                on ? "border-accent-btn bg-accent-btn text-white" : "border-line-strong bg-surface"
              }`}
              aria-hidden="true"
            >
              {on ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            <Icon className={`size-[18px] shrink-0 ${on ? "text-crit" : "text-ink-3"}`} aria-hidden="true" />
            <span className="flex-1">{label}</span>
            <span className={`text-xs ${on ? "font-semibold text-crit-ink" : "text-ink-3"}`}>
              {on ? "Blocked" : "Allowed"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Counts only: this page never lists the sites a parent blocked (and so never advertises them). */
function CustomWebsites({ s }: { s: PolicySummary }) {
  const { run } = useStatus();
  const [tab, setTab] = useState<"blocked" | "allowed">("blocked");
  const tabs = [
    { id: "blocked" as const, label: `Blocked sites (${s.blockedSites})`, Icon: CircleX },
    { id: "allowed" as const, label: `Allowed sites (${s.allowedSites})`, Icon: CircleCheck },
  ];
  const n = tab === "blocked" ? s.blockedSites : s.allowedSites;
  return (
    <div className="rounded-[12px] border border-line">
      <div role="tablist" aria-label="Custom websites" className="flex border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="websites-panel"
            onClick={() => setTab(t.id)}
            className={`-mb-px flex-1 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab === t.id
                ? "border-accent-btn font-semibold text-accent-ink"
                : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="websites-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="p-4">
        <p className="text-sm leading-relaxed text-ink-2">
          {tab === "blocked"
            ? n
              ? `${n} ${n === 1 ? "website is" : "websites are"} blocked on top of the categories above.`
              : "No extra websites are blocked."
            : n
              ? `${n} ${n === 1 ? "website" : "websites"} always ${n === 1 ? "opens" : "open"}, even during focus hours.`
              : "No websites are on the always-allowed list."}
        </p>
        <div className="mt-4 flex flex-col gap-3 rounded-[10px] bg-surface-2 p-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-[13px] text-ink-3">
            Parents add and remove websites in the eGuard dashboard. A child can ask for a website from the
            page that blocks it.
          </p>
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => void run({ type: "OPEN_PARENT_DASHBOARD" })}
          >
            Parent dashboard <ArrowUpRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Privacy() {
  return (
    <Section title="Privacy" id="privacy">
      <PrivacySummary />
      <h3 className="mt-6 mb-1.5 text-[13px] font-semibold text-ink-2">How website protection works</h3>
      <p className="text-sm leading-relaxed text-ink-2">
        eGuard downloads your family's list of blocked and allowed sites, and the browser checks each site
        against it on this computer. The sites your child visits are not sent to eGuard, and eGuard keeps no
        record of which sites were blocked, only how many were blocked each day in each category. A site's
        address only reaches a parent if your child asks for access to it.
      </p>
      <h3 className="mt-5 mb-1.5 text-[13px] font-semibold text-ink-2">What eGuard sends to its servers</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-2">
        <li>
          Browser name and version, eGuard version and operating system type, when the browser is connected.
        </li>
        <li>Protection status and health-check results: which checks pass, never what was browsed.</li>
        <li>
          Once a day, how many pages were blocked in each category the day before ("3 gaming"). Never which
          sites, and nothing finer than a day.
        </li>
        <li>Access requests your child chooses to send: the site's address and the reason they typed.</li>
      </ul>
      <h3 className="mt-5 mb-1.5 text-[13px] font-semibold text-ink-2">How data is protected</h3>
      <p className="text-sm leading-relaxed text-ink-2">
        Everything travels over HTTPS. A parent's password is never entered in or stored by this browser: it
        connects with a one-time pairing code and short-lived keys that a parent can revoke at any time from
        the dashboard.
      </p>
    </Section>
  );
}
