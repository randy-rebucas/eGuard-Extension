import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ArrowRight } from "lucide-react";
import type { ProtectionStatus } from "@eguard/schemas";
import { useStatus } from "../shared/status-store.ts";
import { browserLabel } from "../shared/format.ts";
import { CapabilityList } from "../shared/CapabilityList.tsx";
import { PrivacySummary } from "../shared/PrivacySummary.tsx";
import { Button, Card, LogoMark, TONE_CLASS, stateVisual } from "../ui/components.tsx";

const STEPS = ["Welcome", "Connect", "Review", "Verify"] as const;
type Step = (typeof STEPS)[number];

export function Onboarding() {
  const { status, run } = useStatus();
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    void run({ type: "GET_PROTECTION_STATUS" }).then(() => {
      // Already connected (tab reopened): skip straight to the review
      setStep((s) => s ?? (useStatus.getState().status?.connection.paired ? "Review" : "Welcome"));
    });
  }, [run]);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [step]);

  return (
    <div className="min-h-screen bg-bg px-4 py-10">
      <div className="mx-auto w-full max-w-[600px]">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={36} />
          <span className="font-display text-lg font-semibold tracking-tight">eGuard</span>
        </div>
        {step ? <Stepper current={step} /> : null}
        <Card className="mt-4 p-6 sm:p-8">
          {!status || !step ? (
            <div className="h-40 animate-pulse rounded-[10px] bg-surface-3" aria-label="Loading" />
          ) : step === "Welcome" ? (
            <Welcome headingRef={heading} status={status} onNext={() => setStep("Connect")} />
          ) : step === "Connect" ? (
            <Connect headingRef={heading} onDone={() => setStep("Review")} />
          ) : step === "Review" ? (
            <Review headingRef={heading} status={status} onNext={() => setStep("Verify")} />
          ) : (
            <Verify headingRef={heading} status={status} />
          )}
        </Card>
      </div>
    </div>
  );
}

type HeadingRef = RefObject<HTMLHeadingElement | null>;

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <ol className="flex items-center gap-2" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col gap-1.5" aria-current={i === idx ? "step" : undefined}>
          <span className={`h-1 rounded-full ${i <= idx ? "bg-accent" : "bg-line-strong"}`} />
          <span className={`text-xs ${i === idx ? "font-semibold text-ink" : "text-ink-3"}`}>
            {i + 1}. {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

function H({ r, children }: { r: HeadingRef; children: string }) {
  return (
    <h1 ref={r} tabIndex={-1} className="font-display text-2xl font-semibold tracking-tight outline-none">
      {children}
    </h1>
  );
}

function Welcome({
  headingRef,
  status,
  onNext,
}: {
  headingRef: HeadingRef;
  status: ProtectionStatus;
  onNext: () => void;
}) {
  if (status.state === "UNSUPPORTED") {
    return (
      <>
        <H r={headingRef}>eGuard can't protect this browser yet</H>
        <p className="mt-3 text-ink-2">{status.summary}</p>
      </>
    );
  }
  return (
    <>
      <H r={headingRef}>Let's protect this browser</H>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        eGuard applies your family's protection settings to {browserLabel(status.browser)}, and keeps checking
        that they're still in place. It takes about two minutes and needs a parent.
      </p>
      <div className="mt-6 rounded-[14px] bg-surface-2 p-5">
        <PrivacySummary />
      </div>
      <Button className="mt-6" onClick={onNext}>
        Get started <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}

function Connect({ headingRef, onDone }: { headingRef: HeadingRef; onDone: () => void }) {
  const { run, busy, error, clearError } = useStatus();
  const [code, setCode] = useState("");
  const hintId = useId();
  const errId = useId();

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (await run({ type: "PAIR_WITH_CODE", code })) onDone();
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <H r={headingRef}>Connect to eGuard</H>
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink-2" id={hintId}>
        <li>On your phone or computer, open the eGuard parent dashboard.</li>
        <li>Choose your child, then Devices, then Add browser.</li>
        <li>Enter the pairing code it shows. Codes work once and expire after a few minutes.</li>
      </ol>
      <label htmlFor="pairing-code" className="mt-6 block text-sm font-semibold">
        Pairing code
      </label>
      <input
        id="pairing-code"
        name="code"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          if (error) clearError();
        }}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={14}
        aria-describedby={error ? `${hintId} ${errId}` : hintId}
        aria-invalid={error ? true : undefined}
        className="mt-2 h-14 w-full rounded-[12px] border border-line-strong bg-surface px-4 text-center font-display text-2xl tracking-[0.4em] uppercase outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft aria-invalid:border-crit"
        placeholder="••••••"
      />
      {error ? (
        <p id={errId} role="alert" className="mt-2 text-sm text-crit-ink">
          {error.message}
        </p>
      ) : null}
      <Button
        type="submit"
        className="mt-6"
        busy={busy === "PAIR_WITH_CODE"}
        disabled={code.trim().length < 6}
      >
        Connect
      </Button>
    </form>
  );
}

function Review({
  headingRef,
  status,
  onNext,
}: {
  headingRef: HeadingRef;
  status: ProtectionStatus;
  onNext: () => void;
}) {
  const c = status.connection;
  return (
    <>
      <H r={headingRef}>Review protection</H>
      {c.paired ? (
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Connected to <strong className="text-ink">{c.familyName}</strong>. This browser protects{" "}
          <strong className="text-ink">{c.childName}</strong> on{" "}
          <strong className="text-ink">{c.deviceName}</strong>.
        </p>
      ) : null}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-ink-2">
        What eGuard can do in {status.browser.name}
      </h2>
      <CapabilityList family={status.browser.family} />
      <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
        <strong>Automatic</strong>: eGuard does it. <strong>Guided</strong>: eGuard shows you the steps.{" "}
        <strong>Unsupported</strong>: this browser doesn't allow it, so eGuard won't claim it.
      </p>
      <Button className="mt-6" onClick={onNext}>
        Verify configuration <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}

function Verify({ headingRef, status }: { headingRef: HeadingRef; status: ProtectionStatus }) {
  const { run, busy } = useStatus();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void run({ type: "RUN_HEALTH_CHECK" }).then(() => setChecked(true));
  }, [run]);
  const { tone, Icon } = stateVisual(status);
  const t = TONE_CLASS[tone];
  return (
    <>
      <H r={headingRef}>Verify configuration</H>
      {!checked || busy === "RUN_HEALTH_CHECK" ? (
        <p className="mt-4 text-ink-2" role="status">
          Checking this browser…
        </p>
      ) : (
        <>
          <div className={`mt-5 flex items-start gap-3 rounded-[14px] p-4 ${t.soft}`} role="status">
            <Icon className={`mt-0.5 size-5 shrink-0 ${t.fg}`} aria-hidden="true" />
            <div>
              <p className="font-display text-base font-semibold">{status.headline}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{status.summary}</p>
            </div>
          </div>
          {status.issues.length ? (
            <ul className="mt-4 space-y-2">
              {status.issues.map((i) => (
                <li key={i.id} className="text-sm text-ink-2">
                  <strong className="text-ink">{i.title}.</strong> {i.detail}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-6 text-sm leading-relaxed text-ink-3">
            You can close this tab. The eGuard icon in the toolbar always shows this browser's protection
            status.
          </p>
        </>
      )}
    </>
  );
}
