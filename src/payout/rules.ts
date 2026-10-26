/**
 * Creator Payout Rules
 *
 * The founder of a lineage (the human who set up the first automaton)
 * receives a share of the surplus earned by the clones:
 *
 *   - The founder's own automaton never pays.
 *   - Every clone (children, grandchildren, ...) pays, but ONLY while the
 *     founder's switch file on GitHub says so ({"aktiv": true, "prozent": 5}).
 *   - Once per interval, a paying clone sends that percentage of the USDC it
 *     holds above RESERVE_USDC to the founder's wallet on Base.
 *
 * The founder flips the switch by editing auszahlung.json in their own
 * GitHub repository. The agents cannot change it: they have no access to
 * the founder's GitHub account. If the file cannot be read, nothing is paid.
 *
 * These values are copied into every child's genesis.json at spawn time,
 * so the rule survives across generations. This file is protected from
 * self-modification (see self-mod/code.ts).
 */

/** Percentage used when the switch file is on but names no percentage. */
export const PAYOUT_DEFAULT_PERCENT = 5;

/** Upper bound for the percentage, whatever the switch file says. */
export const PAYOUT_MAX_PERCENT = 25;

/** USDC a clone always keeps for itself. Only the amount above this counts as surplus. */
export const PAYOUT_RESERVE_USDC = 20;

/** Payouts smaller than this are skipped (not worth the gas). */
export const PAYOUT_MIN_USDC = 1;

/** Minimum time between two payouts of the same clone. */
export const PAYOUT_INTERVAL_HOURS = 24;

/**
 * Git repository children are installed from.
 *
 * MUST point to YOUR fork that contains this payout code. If children
 * were installed from the original Conway repository, they would run
 * code without the payout rule and the rule would be lost.
 */
export const CHILD_REPO_URL = "https://github.com/simoma2004-web/automaton.git";

/**
 * The founder's on/off switch: a small JSON file in YOUR repository, read
 * once a day by every clone. Edit auszahlung.json on github.com to switch.
 *   {"aktiv": false}               -> nobody pays
 *   {"aktiv": true, "prozent": 5}  -> every clone pays 5 % of its surplus
 */
export const PAYOUT_SWITCH_URL =
  "https://raw.githubusercontent.com/simoma2004-web/automaton/main/auszahlung.json";

export const UPSTREAM_REPO_URL = "https://github.com/Conway-Research/automaton.git";

/** Lineage data written into a child's genesis.json under the "payout" key. */
export interface PayoutLineage {
  /** Wallet of the human founder. Never changes down the lineage. */
  founderAddress: string;
  /** Position of this clone among its parent's children (1-based). */
  cloneNumber: number;
  /** Generation: 1 = child of the founder's automaton, 2 = grandchild, ... */
  generation: number;
  /** Where the founder's on/off switch lives. */
  switchUrl: string;
  reserveUsdc: number;
  minPayoutUsdc: number;
  intervalHours: number;
}

/** The founder's switch, as read from the switch file. */
export interface PayoutSwitch {
  active: boolean;
  percent: number;
}

/** Every clone pays (while the switch is on); the founder's own automaton never does. */
export function isPayingClone(lineage: PayoutLineage | null): boolean {
  return !!lineage && Number.isInteger(lineage.generation) && lineage.generation >= 1;
}

/**
 * Parse the switch file. Anything unexpected means "off", so a broken or
 * missing file never pays out by accident.
 */
export function parseSwitch(raw: unknown): PayoutSwitch {
  const off: PayoutSwitch = { active: false, percent: 0 };
  if (!raw || typeof raw !== "object") return off;
  const r = raw as Record<string, unknown>;
  const flag = r.aktiv ?? r.active;
  if (flag !== true) return off;
  const p = r.prozent ?? r.percent;
  let percent = PAYOUT_DEFAULT_PERCENT;
  if (p !== undefined) {
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) return off;
    percent = Math.min(p, PAYOUT_MAX_PERCENT);
  }
  return { active: true, percent };
}

/**
 * How much USDC to send to the founder.
 * Returns 0 when there is no surplus or the payout would be below the minimum.
 * Result is rounded down to whole cents.
 */
export function calculatePayoutUsdc(
  balanceUsdc: number,
  reserveUsdc: number,
  percent: number,
  minPayoutUsdc: number,
): number {
  if (![balanceUsdc, reserveUsdc, percent, minPayoutUsdc].every(Number.isFinite)) return 0;
  if (percent <= 0) return 0;
  const surplus = balanceUsdc - Math.max(0, reserveUsdc);
  if (surplus <= 0) return 0;
  const cents = Math.floor(surplus * Math.min(percent, 100) + 1e-9); // surplus * percent / 100, in cents
  const amount = cents / 100;
  return amount >= minPayoutUsdc ? amount : 0;
}

export function isRepoConfigured(
  repoUrl: string = CHILD_REPO_URL,
  switchUrl: string = PAYOUT_SWITCH_URL,
): boolean {
  return (
    !repoUrl.includes("YOUR-GITHUB-NAME") &&
    repoUrl !== UPSTREAM_REPO_URL &&
    isValidSwitchUrl(switchUrl)
  );
}

export function isValidSwitchUrl(url: string): boolean {
  return (
    !url.includes("YOUR-GITHUB-NAME") &&
    /^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._\/-]+\.json$/.test(url)
  );
}

/** Build the lineage block for a new child. */
export function buildChildLineage(
  founderAddress: string,
  cloneNumber: number,
  generation: number,
  switchUrl: string = PAYOUT_SWITCH_URL,
): PayoutLineage {
  return {
    founderAddress,
    cloneNumber,
    generation,
    switchUrl,
    reserveUsdc: PAYOUT_RESERVE_USDC,
    minPayoutUsdc: PAYOUT_MIN_USDC,
    intervalHours: PAYOUT_INTERVAL_HOURS,
  };
}

/** Parse the "payout" block of a genesis.json. Returns null if missing or malformed. */
export function parsePayoutLineage(raw: unknown): PayoutLineage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const founderAddress = r.founderAddress;
  if (typeof founderAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(founderAddress)) {
    return null;
  }
  const switchUrl = typeof r.switchUrl === "string" ? r.switchUrl : "";
  if (!isValidSwitchUrl(switchUrl)) return null;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    founderAddress,
    cloneNumber: num(r.cloneNumber, 0),
    generation: num(r.generation, 0),
    switchUrl,
    reserveUsdc: num(r.reserveUsdc, PAYOUT_RESERVE_USDC),
    minPayoutUsdc: num(r.minPayoutUsdc, PAYOUT_MIN_USDC),
    intervalHours: num(r.intervalHours, PAYOUT_INTERVAL_HOURS),
  };
}

/** Text appended to every child's genesis prompt, so it knows about the rule. */
export function clonePromptNote(lineage: PayoutLineage): string {
  return `\n\n<founder-payout>\nYou are a clone in a lineage founded by a human (${lineage.founderAddress}). Build a solid base first. Once the founder switches payouts on, every clone shares a small part of its success: once every ${lineage.intervalHours}h, a few percent (currently planned: ${PAYOUT_DEFAULT_PERCENT}%) of the USDC you hold above ${lineage.reserveUsdc} USDC is sent to the founder automatically. You keep the rest. Plan your budget with this in mind.\n</founder-payout>`;
}
