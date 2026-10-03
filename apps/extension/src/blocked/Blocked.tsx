import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Ban, Clock, Lock, Send, Sprout, Tag, UserRound, type LucideIcon } from "lucide-react";
import type { BlockInfo } from "@eguard/schemas";
import { categoryVisual } from "../shared/categories.ts";
import { send } from "../shared/messaging.ts";
import { Button, Card, LogoMark } from "../ui/components.tsx";

const CATEGORY_LABEL: Record<string, string> = {
  ADULT: "adult content",
  GAMBLING: "gambling",
  MALWARE: "harmful software",
  PHISHING: "phishing",
  VIOLENCE: "violence",
  DRUGS: "drugs",
  WEAPONS: "weapons",
  HATE: "hate and extremism",
  DATING: "dating",
  SOCIAL_MEDIA: "social media",
  GAMING: "gaming",
  STREAMING: "streaming",
  SHOPPING: "shopping",
  DOWNLOADS: "downloads",
};

/** How often an open block page asks whether a parent answered (the API suggests every 15–30 s). */
const ANSWER_POLL_MS = 20_000;

function to12h(hhmm: string) {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Why, in plain words. Explains the family's setting; never scolds, never lists what else is blocked. */
function explain(info: BlockInfo): { title: string; body: string } {
  const r = info.reason;
  if (info.decision === "WARN") {
    return {
      title: "Before you continue",
      body: "This website isn't on your family's list yet. You can continue, or ask a parent to add it.",
    };
  }
  switch (r?.type) {
    case "CATEGORY":
      return {
        title: "This website is blocked",
        body: `It's in a category your family's settings don't include: ${CATEGORY_LABEL[r.category] ?? "other"}.`,
      };
    case "FOCUS_HOURS":
      return {
        title: "It's focus time",
        body: `Right now only websites on your family's list open.${r.until ? ` Focus time ends at ${to12h(r.until)}.` : ""}`,
      };
    case "UNKNOWN_SITE":
      return {
        title: "This website isn't on your list",
        body: "Only websites your family has chosen open in this browser.",
      };
    case "SAFE_SEARCH":
      return {
        title: "Search on google.com instead",
        body: "Your family uses SafeSearch, which eGuard can only turn on at google.com. Search there and it works as usual.",
      };
    default:
      return {
        title: "This website is blocked",
        body: "It doesn't match the settings your family chose for this browser.",
      };
  }
}

export function Blocked() {
  const url = new URLSearchParams(location.search).get("u") ?? "";
  const [info, setInfo] = useState<BlockInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"continue" | "request" | "check" | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [checkedNoChange, setCheckedNoChange] = useState(false);
  const reasonId = useId();

  const fetchedForApproval = useRef(false);

  /** Applies the worker's answer: if the site is allowed now (a parent said yes, or settings changed), open it. */
  const apply = (next: BlockInfo | undefined) => {
    if (!next) return;
    if (next.decision === "ALLOW") {
      location.replace(next.url);
      return;
    }
    setInfo(next);
  };

  /**
   * An approval only takes effect through the next signed policy, so when a request shows APPROVED but the site is
   * still blocked, fetch the policy straight away (once per answer) instead of waiting for the 5-minute sync.
   */
  const answer = async (next: BlockInfo | undefined) => {
    const status = next?.request?.status;
    if (status === "PENDING") fetchedForApproval.current = false;
    if (next && next.decision !== "ALLOW" && status === "APPROVED" && !fetchedForApproval.current) {
      fetchedForApproval.current = true;
      const res = await send({ type: "CHECK_ACCESS", url });
      if (res.ok && res.block) next = res.block;
    }
    apply(next);
  };

  useEffect(() => {
    void send({ type: "GET_BLOCK_INFO", url }).then((res) => {
      if (res.ok) void answer(res.block);
      else setError(res.error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per blocked URL
  }, [url]);

  // While a parent hasn't answered, look for the answer (GET /access-requests has no rate limit; 20 s is plenty)
  const waiting = info?.request?.status === "PENDING";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void send({ type: "GET_BLOCK_INFO", url }).then((res) => {
        if (res.ok) void answer(res.block);
      });
    }, ANSWER_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts only when waiting starts or stops
  }, [waiting, url]);

  async function run(kind: "continue" | "request" | "check") {
    setBusy(kind);
    setError(null);
    const res =
      kind === "continue"
        ? await send({ type: "CONTINUE_TO_SITE", url })
        : kind === "request"
          ? await send({ type: "REQUEST_ACCESS", url, ...(reason.trim() ? { reason: reason.trim() } : {}) })
          : await send({ type: "CHECK_ACCESS", url });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (kind === "continue") {
      location.replace(url);
      return;
    }
    if (kind === "check") setCheckedNoChange(res.block?.decision !== "ALLOW");
    setAsking(false);
    apply(res.block);
  }

  const goBack = () => {
    if (history.length > 1) history.back();
    else location.replace("about:blank");
  };

  if (!info) {
    return (
      <Shell>
        {error ? (
          <p role="alert" className="text-crit-ink">
            {error}
          </p>
        ) : (
          <div className="h-40 animate-pulse rounded-[10px] bg-surface-3" aria-label="Loading" />
        )}
      </Shell>
    );
  }

  const { title, body } = explain(info);
  const request = info.request;
  const focus = info.reason?.type === "FOCUS_HOURS";
  const facts: { Icon: LucideIcon; label: string; value: string; sub?: string }[] = [
    { Icon: Tag, label: "Reason", value: reasonLabel(info) },
    ...(info.childName
      ? [{ Icon: UserRound, label: "Profile", value: info.childName, sub: "This browser" }]
      : []),
    {
      Icon: Clock,
      label: "Time",
      value: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      sub: new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    },
  ];
  return (
    <Shell>
      <Illustration focus={focus} />
      <h1 className="mt-6 font-display text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-3 max-w-[440px] text-[15px] leading-relaxed text-ink-2">{body}</p>
      <p className="mt-3 inline-block max-w-full rounded-md bg-surface-2 px-2 py-1 font-mono text-sm break-all text-ink-2">
        {info.host}
      </p>

      <ul className={`mt-7 grid gap-3 text-left ${facts.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {facts.map(({ Icon, label, value, sub }) => (
          <li
            key={label}
            className="flex items-start gap-3 rounded-[12px] border border-line bg-surface p-3.5"
          >
            <Icon className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden="true" />
            <p className="min-w-0 leading-snug">
              <span className="block text-xs text-ink-3">{label}</span>
              <span className="mt-0.5 block text-sm font-semibold break-words">{value}</span>
              {sub ? <span className="block text-xs text-ink-3">{sub}</span> : null}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button className="min-w-[150px]" onClick={goBack}>
          <ArrowLeft className="size-4" aria-hidden="true" /> Go back
        </Button>
        {info.decision === "WARN" ? (
          <Button variant="secondary" busy={busy === "continue"} onClick={() => void run("continue")}>
            Continue to site
          </Button>
        ) : null}
      </div>

      {/* A parent's approval can't lift a SafeSearch block (it isn't about the site), so don't offer to ask */}
      {info.reason?.type === "SAFE_SEARCH" ? null : (
        <section className="mt-8 border-t border-line pt-6 text-left" aria-labelledby="need-access">
          <h2 id="need-access" className="text-sm font-semibold">
            Need this website?
          </h2>
          {request?.status === "PENDING" ? (
            <div role="status" className="mt-2">
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Send className="size-4 text-accent-ink" aria-hidden="true" /> You asked a parent. It opens
                here once they say yes.
              </p>
              {checkedNoChange ? <p className="mt-1 text-sm text-ink-3">No answer yet.</p> : null}
              <Button
                variant="ghost"
                className="mt-2 -ml-3"
                busy={busy === "check"}
                onClick={() => void run("check")}
              >
                Check again
              </Button>
            </div>
          ) : asking ? (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run("request");
              }}
            >
              <label htmlFor={reasonId} className="text-sm text-ink-2">
                Why do you need it? <span className="text-ink-3">(optional)</span>
              </label>
              <textarea
                id={reasonId}
                // Opened by the child pressing "Ask a parent", so moving focus here is expected
                autoFocus
                value={reason}
                maxLength={280}
                onChange={(e) => setReason(e.target.value)}
                className="mt-2 h-24 w-full resize-none rounded-[12px] border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft"
                placeholder="For example: a school project"
              />
              <div className="mt-3 flex gap-3">
                <Button type="submit" busy={busy === "request"}>
                  Send to a parent
                </Button>
                <Button variant="ghost" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-2">
              {request?.status === "DENIED" ? (
                <p className="text-sm text-ink-2">
                  A parent said no to this website last time. You can ask again.
                </p>
              ) : request?.status === "APPROVED" ? (
                <p className="text-sm text-ink-2">The time a parent allowed for this website has ended.</p>
              ) : (
                <p className="text-sm text-ink-2">
                  {info.childName ? `${info.childName}, you` : "You"} can ask a parent to allow it.
                </p>
              )}
              <Button variant="secondary" className="mt-3" onClick={() => setAsking(true)}>
                Ask a parent
              </Button>
            </div>
          )}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-crit-ink">
              {error}
            </p>
          ) : null}
        </section>
      )}
    </Shell>
  );
}

/** A short label for the fact cards; the sentence above carries the explanation. */
function reasonLabel(info: BlockInfo): string {
  const r = info.reason;
  if (info.decision === "WARN") return "New website";
  switch (r?.type) {
    case "CATEGORY":
      return categoryVisual(r.category).label;
    case "FOCUS_HOURS":
      return "Focus time";
    case "UNKNOWN_SITE":
      return "Not on your list";
    case "SAFE_SEARCH":
      return "SafeSearch";
    default:
      return "Family setting";
  }
}

/** Shield with a lock (or clock during focus time), on a soft cloud. Decorative. */
function Illustration({ focus }: { focus: boolean }) {
  return (
    <div className="relative mx-auto h-[150px] w-[240px]" aria-hidden="true">
      <div className="absolute inset-x-0 bottom-2 h-[88px] rounded-full bg-accent-soft blur-[2px]" />
      <div className="absolute bottom-6 left-3 size-16 rounded-full bg-surface-3" />
      <div className="absolute right-4 bottom-8 size-14 rounded-full bg-surface-3" />
      <svg viewBox="0 0 64 64" className="absolute left-1/2 top-0 h-[140px] -translate-x-1/2 drop-shadow-lg">
        <defs>
          <linearGradient id="eg-shield" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#8BE0FF" />
            <stop offset=".55" stopColor="#4AA8F5" />
            <stop offset="1" stopColor="#1E7AD0" />
          </linearGradient>
        </defs>
        <path
          d="M32 4C24.4 8 16.4 10.2 8.5 11.2V30c0 14.6 9.8 25.4 23.5 30 13.7-4.6 23.5-15.4 23.5-30V11.2C47.6 10.2 39.6 8 32 4Z"
          fill="url(#eg-shield)"
          opacity=".9"
        />
      </svg>
      <div className="absolute left-1/2 top-[42px] grid size-14 -translate-x-1/2 place-items-center rounded-2xl bg-[#1560db] text-white shadow-lift">
        {focus ? <Clock className="size-7" /> : <Lock className="size-7" />}
      </div>
      <div className="absolute right-6 bottom-9 grid size-10 place-items-center rounded-xl border border-line bg-surface shadow-card">
        <Ban className="size-6 text-crit" />
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="eg-page min-h-screen px-4 py-10 sm:py-14">
      <main className="mx-auto w-full max-w-[720px]">
        <Card className="px-5 py-8 text-center sm:px-10 sm:py-10">
          <div className="mb-6 flex items-center justify-center gap-2">
            <LogoMark size={30} />
            <span className="font-display text-xl font-semibold tracking-tight">eGuard</span>
          </div>
          {children}
        </Card>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-sm text-ink-3">
          <Sprout className="size-4 text-ok" aria-hidden="true" /> Your family cares about your safety online.
        </p>
      </main>
    </div>
  );
}
