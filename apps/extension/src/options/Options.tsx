import { useEffect, type ReactNode } from "react";
import type { ProtectionStatus } from "@eguard/schemas";
import { useStatus } from "../shared/status-store.ts";
import { browserLabel, relativeTime } from "../shared/format.ts";
import { CapabilityList } from "../shared/CapabilityList.tsx";
import { HealthList, scoreLabel } from "../shared/HealthList.tsx";
import { PrivacySummary } from "../shared/PrivacySummary.tsx";
import { Button, Card, LogoMark, TONE_CLASS, stateVisual } from "../ui/components.tsx";

/**
 * Read-only settings for the child's browser. Protection is managed by parents in the eGuard
 * dashboard; nothing here can weaken it (spec §17), including disconnecting the browser.
 */
export function Options() {
  const { status, run } = useStatus();
  useEffect(() => {
    void run({ type: "GET_PROTECTION_STATUS" });
  }, [run]);

  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto w-full max-w-[720px] space-y-6">
        <header className="flex items-center gap-3">
          <LogoMark size={36} />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">eGuard settings</h1>
            <p className="text-sm text-ink-3">Protection is managed by parents in the eGuard dashboard.</p>
          </div>
        </header>
        {status ? (
          <>
            <Account status={status} />
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
            <Section title="Protection" id="protection">
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
      </div>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <section aria-labelledby={id}>
        <h2 id={id} className="mb-4 font-display text-base font-semibold">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

function Account({ status }: { status: ProtectionStatus }) {
  const { run } = useStatus();
  const c = status.connection;
  const { tone } = stateVisual(status);
  const rows: [string, string][] = c.paired
    ? [
        ["Connected family", c.familyName],
        ["Child", c.childName],
        ["Device", c.deviceName],
        ["Browser", browserLabel(status.browser)],
        ["Last sync", relativeTime(status.lastSyncAt) ?? "Not yet"],
      ]
    : [["Browser", browserLabel(status.browser)]];
  return (
    <Section title="Account" id="account">
      <p className={`mb-4 inline-flex items-center gap-2 text-sm font-semibold ${TONE_CLASS[tone].fg}`}>
        <span className={`size-2 rounded-full ${TONE_CLASS[tone].dot}`} aria-hidden="true" />
        {status.headline}
      </p>
      <dl className="grid grid-cols-[minmax(0,180px)_1fr] gap-y-2 text-sm">
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
