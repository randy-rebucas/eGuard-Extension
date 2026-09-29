import { compileRules, sameRules, PRIORITY, type DnrRule } from "@eguard/policy-engine";
import type { BrowserProtectionPolicy } from "@eguard/schemas";
import { z } from "zod";
import { typedItem, type StorageAreaLike } from "@eguard/browser-adapter";

/** The browser's declarativeNetRequest, narrowed to what eGuard uses (an adapter in index.ts, a fake in tests). */
export interface RulesApi {
  getDynamic(): Promise<DnrRule[]>;
  /** Replaces every dynamic rule with `rules` in one update. */
  setDynamic(rules: DnrRule[]): Promise<void>;
  getSession(): Promise<DnrRule[]>;
  setSession(rules: DnrRule[]): Promise<void>;
}

/** How long "Continue" on a warning keeps that site open. */
export const CONTINUE_MS = 30 * 60_000;

const Continues = z.array(z.object({ host: z.string(), until: z.iso.datetime() })).max(200);

export type EnforcementDeps = {
  rules: RulesApi;
  /** storage.session: "Continue" choices end when the browser closes, like the session rules they create. */
  session: StorageAreaLike;
  /** Hosts that always open (the eGuard web app). */
  alwaysAllow: string[];
  log?: (event: string, detail?: Record<string, unknown>) => void;
};

/**
 * Turns the verified policy into browser rules and checks they're really there. `apply` is idempotent and cheap
 * when nothing changed, so it runs every minute (focus hours and approvals change with the clock).
 */
export function createEnforcement(d: EnforcementDeps) {
  const log = d.log ?? (() => {});
  const continues = typedItem(d.session, "continues", Continues);
  const expectedFor = (policy: BrowserProtectionPolicy | null, now: Date) =>
    policy ? compileRules(policy, { now, alwaysAllow: d.alwaysAllow }) : [];

  /** Installs the rules `policy` needs at `now` (none for null) and returns whether the browser now has exactly them. */
  async function apply(policy: BrowserProtectionPolicy | null, now: Date): Promise<boolean> {
    const expected = expectedFor(policy, now);
    if (!sameRules(expected, await d.rules.getDynamic())) {
      await d.rules.setDynamic(expected);
      log("rules_applied", { count: expected.length, version: policy?.version ?? null });
    }
    await pruneContinues(now);
    return policy !== null && sameRules(expected, await d.rules.getDynamic());
  }

  /** Read-back only: whether the rules in the browser are exactly what `policy` requires right now. */
  async function verify(policy: BrowserProtectionPolicy | null, now: Date): Promise<boolean> {
    if (!policy) return false;
    return sameRules(expectedFor(policy, now), await d.rules.getDynamic());
  }

  /** "Continue" on a warning: this host opens for CONTINUE_MS, through a session rule. */
  async function allowForAWhile(host: string, now: Date) {
    const list = ((await continues.get()) ?? []).filter(
      (c) => c.host !== host && Date.parse(c.until) > now.getTime(),
    );
    list.push({ host, until: new Date(now.getTime() + CONTINUE_MS).toISOString() });
    await continues.set(list);
    await syncSessionRules(list);
  }

  async function isContinued(host: string, now: Date) {
    return ((await continues.get()) ?? []).some(
      (c) => c.host === host && Date.parse(c.until) > now.getTime(),
    );
  }

  async function pruneContinues(now: Date) {
    const list = (await continues.get()) ?? [];
    const live = list.filter((c) => Date.parse(c.until) > now.getTime());
    if (live.length !== list.length) await continues.set(live);
    await syncSessionRules(live);
  }

  async function syncSessionRules(list: { host: string }[]) {
    const expected: DnrRule[] = list.map((c, i) => ({
      id: 100_000 + i,
      priority: PRIORITY.allow,
      action: { type: "allow" },
      condition: { requestDomains: [c.host], resourceTypes: ["main_frame", "sub_frame"] },
    }));
    if (!sameRules(expected, await d.rules.getSession())) await d.rules.setSession(expected);
  }

  return { apply, verify, allowForAWhile, isContinued };
}

export type Enforcement = ReturnType<typeof createEnforcement>;
