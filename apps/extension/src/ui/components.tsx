import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CloudOff,
  Info,
  LoaderCircle,
  OctagonAlert,
  ShieldAlert,
  ShieldCheck,
  ShieldEllipsis,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CapabilityLevel, CheckStatus, ProtectionStatus } from "@eguard/schemas";

export type Tone = "ok" | "warn" | "crit" | "muted" | "accent";

const SHIELD =
  "M32 4C24.4 8 16.4 10.2 8.5 11.2V30c0 14.6 9.8 25.4 23.5 30 13.7-4.6 23.5-15.4 23.5-30V11.2C47.6 10.2 39.6 8 32 4Z";
const inset = (s: number) => `translate(32 32) scale(${s}) translate(-32 -32)`;

/** The eGuard mark, identical to the web app's LogoMark. */
export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}o`} x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4FD2FF" />
          <stop offset=".55" stopColor="#2394F5" />
          <stop offset="1" stopColor="#1560DB" />
        </linearGradient>
        <linearGradient id={`${id}i`} x1="18" y1="16" x2="46" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8BE0FF" />
          <stop offset="1" stopColor="#2B8EF2" />
        </linearGradient>
      </defs>
      <path d={SHIELD} fill={`url(#${id}o)`} />
      <path d={SHIELD} fill="#fff" transform={inset(0.76)} />
      <path d={SHIELD} fill={`url(#${id}i)`} transform={inset(0.6)} />
      <g strokeLinejoin="round" strokeWidth="1.2">
        <path d="M32 22.5 40.2 27.2 32 31.9 23.8 27.2Z" fill="#C4F0FF" stroke="#C4F0FF" />
        <path d="M23.8 27.2 32 31.9V41.3L23.8 36.6Z" fill="#1E9BF2" stroke="#1E9BF2" />
        <path d="M40.2 27.2 32 31.9V41.3L40.2 36.6Z" fill="#0B5FD4" stroke="#0B5FD4" />
      </g>
    </svg>
  );
}

export const TONE_CLASS: Record<Tone, { fg: string; soft: string; dot: string }> = {
  ok: { fg: "text-ok-ink", soft: "bg-ok-soft", dot: "bg-ok" },
  warn: { fg: "text-warn-ink", soft: "bg-warn-soft", dot: "bg-warn" },
  crit: { fg: "text-crit-ink", soft: "bg-crit-soft", dot: "bg-crit" },
  muted: { fg: "text-ink-3", soft: "bg-muted-soft", dot: "bg-ink-3" },
  accent: { fg: "text-accent-ink", soft: "bg-accent-soft", dot: "bg-accent" },
};

/** How a protection state looks. A browser that simply isn't connected yet reads as setup, not danger. */
export function stateVisual(s: ProtectionStatus): { tone: Tone; Icon: LucideIcon } {
  switch (s.state) {
    case "PROTECTED":
      return { tone: "ok", Icon: ShieldCheck };
    case "NEEDS_ATTENTION":
      return { tone: "warn", Icon: ShieldAlert };
    case "ACTION_REQUIRED":
      return s.connection.paired
        ? { tone: "crit", Icon: ShieldAlert }
        : { tone: "accent", Icon: ShieldEllipsis };
    case "SYNC_PAUSED":
      return { tone: "muted", Icon: CloudOff };
    case "UNSUPPORTED":
      return { tone: "muted", Icon: Info };
  }
}

export const CHECK_VISUAL: Record<CheckStatus, { tone: Tone; Icon: LucideIcon; label: string }> = {
  PASS: { tone: "ok", Icon: CircleCheck, label: "Pass" },
  WARNING: { tone: "warn", Icon: TriangleAlert, label: "Warning" },
  ACTION_REQUIRED: { tone: "crit", Icon: OctagonAlert, label: "Action required" },
  UNSUPPORTED: { tone: "muted", Icon: CircleSlash, label: "Unsupported" },
  NOT_CONFIGURED: { tone: "muted", Icon: CircleDashed, label: "Not configured" },
};

export const LEVEL_VISUAL: Record<CapabilityLevel, { tone: Tone; label: string }> = {
  AUTOMATIC: { tone: "ok", label: "Automatic" },
  GUIDED: { tone: "accent", label: "Guided" },
  VERIFICATION_ONLY: { tone: "accent", label: "Verification only" },
  UNSUPPORTED: { tone: "muted", label: "Unsupported" },
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE_CLASS[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.soft} ${t.fg}`}
    >
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  busy?: boolean;
  full?: boolean;
};

export function Button({
  variant = "primary",
  busy,
  full,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const styles = {
    primary:
      "bg-accent-btn text-white hover:bg-accent-btn-hover shadow-[0_6px_16px_-8px_rgba(22,115,196,.7)]",
    secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
    ghost: "text-accent-ink hover:bg-accent-soft",
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${full ? "w-full" : ""} ${styles} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-[14px] border border-line bg-surface shadow-card ${className}`}>{children}</div>
  );
}
