import { useEffect, useId, useState, type ReactNode } from "react";
import { ArrowLeft, Clock, Hand, Send, ShieldCheck } from "lucide-react";
import type { BlockInfo } from "@eguard/schemas";
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

  /** Applies the worker's answer: if the site is allowed now (a parent said yes, or settings changed), open it. */
  const apply = (next: BlockInfo | undefined) => {
    if (!next) return;
    if (next.decision === "ALLOW") {
      location.replace(next.url);
      return;
    }
    setInfo(next);
  };

  useEffect(() => {
    void send({ type: "GET_BLOCK_INFO", url }).then((res) => {
      if (res.ok) apply(res.block);
      else setError(res.error);
    });
  }, [url]);

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
  return (
    <Shell>
      <div className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
        {info.reason?.type === "FOCUS_HOURS" ? (
          <Clock className="size-6" aria-hidden="true" />
        ) : (
          <Hand className="size-6" aria-hidden="true" />
        )}
      </div>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 inline-block max-w-full rounded-md bg-surface-2 px-2 py-1 font-mono text-sm break-all text-ink-2">
        {info.host}
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{body}</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={goBack}>
          <ArrowLeft className="size-4" aria-hidden="true" /> Go back
        </Button>
        {info.decision === "WARN" ? (
          <Button busy={busy === "continue"} onClick={() => void run("continue")}>
            Continue to site
          </Button>
        ) : null}
      </div>

      <section className="mt-8 border-t border-line pt-6" aria-labelledby="need-access">
        <h2 id="need-access" className="text-sm font-semibold">
          Need this website?
        </h2>
        {request?.status === "PENDING" ? (
          <div role="status" className="mt-2">
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Send className="size-4 text-accent-ink" aria-hidden="true" /> You asked a parent. It opens here
              once they say yes.
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
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 py-12">
      <main className="mx-auto w-full max-w-[560px]">
        <div className="mb-5 flex items-center gap-2 text-sm text-ink-3">
          <LogoMark size={24} />
          <span className="font-display font-semibold text-ink">eGuard</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-4" aria-hidden="true" /> Family protection
          </span>
        </div>
        <Card className="p-6 sm:p-8">{children}</Card>
      </main>
    </div>
  );
}
