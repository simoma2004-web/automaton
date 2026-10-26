/**
 * Founder payout: while the founder's GitHub switch is on, every clone sends
 * a share of its surplus USDC to the human founder. The founder's own
 * automaton never pays.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  calculatePayoutUsdc,
  isPayingClone,
  parsePayoutLineage,
  parseSwitch,
  buildChildLineage,
  isRepoConfigured,
  isValidSwitchUrl,
  UPSTREAM_REPO_URL,
  PAYOUT_MAX_PERCENT,
} from "../payout/rules.js";
import {
  runCreatorPayout,
  loadOwnLineage,
  resolveFounderAddress,
  type PayoutChain,
  type SwitchReader,
} from "../payout/creator-payout.js";
import { prepareChildPayout, childInstallCommand } from "../payout/child-setup.js";
import { isProtectedFile } from "../self-mod/code.js";
import { getForbiddenCommandMatch } from "../agent/policy-rules/command-safety.js";
import { createTestDb, createTestIdentity } from "./mocks.js";

const FOUNDER = "0xf0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0";
const FORK = "https://github.com/test-owner/automaton.git";
const SWITCH = "https://raw.githubusercontent.com/test-owner/automaton/main/auszahlung.json";

const ON: SwitchReader = async () => ({ active: true, percent: 5 });
const OFF: SwitchReader = async () => ({ active: false, percent: 0 });

function fakeChain(usdc: number, ethWei = 10n ** 16n) {
  const sendUsdc = vi.fn(async () => "0xhash");
  const chain: PayoutChain = {
    getUsdcBalance: async () => usdc,
    getEthBalanceWei: async () => ethWei,
    sendUsdc,
  };
  return { chain, sendUsdc };
}

const child = (n = 1, gen = 1) => buildChildLineage(FOUNDER, n, gen, SWITCH);

describe("payout rules", () => {
  it("every clone pays, the founder's own automaton never does", () => {
    expect(isPayingClone(null)).toBe(false);
    expect(isPayingClone({ ...child(), generation: 0 })).toBe(false);
    expect(isPayingClone(child(1, 1))).toBe(true);
    expect(isPayingClone(child(3, 4))).toBe(true);
  });

  it("reads the switch file safely", () => {
    expect(parseSwitch({ aktiv: true, prozent: 5 })).toEqual({ active: true, percent: 5 });
    expect(parseSwitch({ aktiv: true })).toEqual({ active: true, percent: 5 });
    expect(parseSwitch({ aktiv: false, prozent: 5 })).toEqual({ active: false, percent: 0 });
    expect(parseSwitch({ aktiv: "true" }).active).toBe(false); // only a real true counts
    expect(parseSwitch({ aktiv: true, prozent: -3 }).active).toBe(false);
    expect(parseSwitch({ aktiv: true, prozent: 90 }).percent).toBe(PAYOUT_MAX_PERCENT);
    expect(parseSwitch(null).active).toBe(false);
    expect(parseSwitch("garbage").active).toBe(false);
  });

  it("pays the percentage of the amount above the reserve, rounded down to cents", () => {
    expect(calculatePayoutUsdc(120, 20, 5, 1)).toBe(5); // 100 surplus -> 5.00
    expect(calculatePayoutUsdc(53.339, 20, 5, 1)).toBe(1.66); // 33.339 * 0.05 = 1.667
    expect(calculatePayoutUsdc(20, 20, 5, 1)).toBe(0);
    expect(calculatePayoutUsdc(10, 20, 5, 1)).toBe(0);
    expect(calculatePayoutUsdc(35, 20, 5, 1)).toBe(0); // 0.75 < minimum
    expect(calculatePayoutUsdc(NaN, 20, 5, 1)).toBe(0);
  });

  it("parses only well-formed lineage blocks", () => {
    expect(parsePayoutLineage(child(5, 2))).toMatchObject({
      founderAddress: FOUNDER,
      cloneNumber: 5,
      generation: 2,
      switchUrl: SWITCH,
    });
    expect(parsePayoutLineage({ founderAddress: "nope" })).toBeNull();
    expect(parsePayoutLineage({ ...child(), switchUrl: "https://evil.example/x.json" })).toBeNull();
    expect(parsePayoutLineage(undefined)).toBeNull();
  });

  it("rejects placeholder and upstream repos and foreign switch hosts", () => {
    expect(isRepoConfigured("https://github.com/YOUR-GITHUB-NAME/automaton.git", SWITCH)).toBe(false);
    expect(isRepoConfigured(UPSTREAM_REPO_URL, SWITCH)).toBe(false);
    expect(isRepoConfigured(FORK, "https://raw.githubusercontent.com/YOUR-GITHUB-NAME/automaton/main/auszahlung.json")).toBe(false);
    expect(isRepoConfigured(FORK, SWITCH)).toBe(true);
    expect(isValidSwitchUrl("https://example.com/auszahlung.json")).toBe(false);
  });
});

describe("runCreatorPayout", () => {
  const identity = { ...createTestIdentity(), chainType: "evm" as const };

  it("the founder's own automaton never pays, even with the switch on", async () => {
    const db = createTestDb();
    const { chain, sendUsdc } = fakeChain(1000);
    const r = await runCreatorPayout({ identity, db, lineage: null, chain, readSwitch: ON });
    expect(r.status).toBe("not_payer");
    expect(sendUsdc).not.toHaveBeenCalled();
  });

  it("nobody pays while the switch is off", async () => {
    const db = createTestDb();
    const { chain, sendUsdc } = fakeChain(1000);
    const r = await runCreatorPayout({ identity, db, lineage: child(), chain, readSwitch: OFF });
    expect(r.status).toBe("switched_off");
    expect(sendUsdc).not.toHaveBeenCalled();
  });

  it("with the switch on, a clone sends 5% of its surplus and records it", async () => {
    const db = createTestDb();
    const { chain, sendUsdc } = fakeChain(120); // 100 surplus -> 5
    const r = await runCreatorPayout({ identity, db, lineage: child(2, 3), chain, readSwitch: ON });
    expect(r).toEqual({ status: "paid", amountUsdc: 5, txHash: "0xhash" });
    expect(sendUsdc).toHaveBeenCalledWith(identity.account, FOUNDER, 5);
    expect(db.getKV("creatorPayout.totalUsdc")).toBe("5.00");
    expect(db.getRecentTransactions(5).some((t) => t.description?.includes("Founder payout (5%"))).toBe(true);
  });

  it("uses the percentage from the switch file", async () => {
    const db = createTestDb();
    const { chain, sendUsdc } = fakeChain(120);
    await runCreatorPayout({ identity, db, lineage: child(), chain, readSwitch: async () => ({ active: true, percent: 10 }) });
    expect(sendUsdc).toHaveBeenCalledWith(identity.account, FOUNDER, 10);
  });

  it("pays at most once per interval", async () => {
    const db = createTestDb();
    const { chain, sendUsdc } = fakeChain(120);
    const lineage = child();
    await runCreatorPayout({ identity, db, lineage, chain, readSwitch: ON, now: new Date("2026-11-01T10:00:00Z") });
    const soon = await runCreatorPayout({ identity, db, lineage, chain, readSwitch: ON, now: new Date("2026-11-01T20:00:00Z") });
    expect(soon.status).toBe("too_soon");
    const later = await runCreatorPayout({ identity, db, lineage, chain, readSwitch: ON, now: new Date("2026-11-02T10:00:01Z") });
    expect(later.status).toBe("paid");
    expect(sendUsdc).toHaveBeenCalledTimes(2);
  });

  it("skips when there is no surplus or no gas", async () => {
    const db = createTestDb();
    expect((await runCreatorPayout({ identity, db, lineage: child(), chain: fakeChain(30).chain, readSwitch: ON })).status).toBe("no_surplus");
    const noGas = fakeChain(120, 0n);
    expect((await runCreatorPayout({ identity, db, lineage: child(), chain: noGas.chain, readSwitch: ON })).status).toBe("no_gas");
    expect(noGas.sendUsdc).not.toHaveBeenCalled();
  });

  it("does not mark a failed transfer as paid", async () => {
    const db = createTestDb();
    const { chain } = fakeChain(120);
    chain.sendUsdc = async () => { throw new Error("reverted"); };
    const r = await runCreatorPayout({ identity, db, lineage: child(), chain, readSwitch: ON });
    expect(r.status).toBe("error");
    expect(db.getKV("creatorPayout.lastAt")).toBeUndefined();
  });

  it("skips Solana wallets", async () => {
    const db = createTestDb();
    const r = await runCreatorPayout({
      identity: { ...identity, chainType: "solana" },
      db,
      lineage: child(),
      chain: fakeChain(120).chain,
      readSwitch: ON,
    });
    expect(r.status).toBe("unsupported_chain");
  });
});

describe("lineage inheritance", () => {
  it("reads the lineage from genesis.json and keeps the founder across generations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payout-"));
    fs.writeFileSync(path.join(dir, "genesis.json"), JSON.stringify({ name: "c", payout: child(3, 2) }));
    const lineage = loadOwnLineage(dir);
    expect(lineage?.generation).toBe(2);
    expect(resolveFounderAddress(lineage, "0x" + "1".repeat(40))).toBe(FOUNDER);
    expect(resolveFounderAddress(null, FOUNDER)).toBe(FOUNDER);
    expect(loadOwnLineage(path.join(dir, "missing"))).toBeNull();
  });

  it("children of the founder's automaton are generation 1 and pay once switched on", () => {
    const db = createTestDb();
    const identity = { ...createTestIdentity(), creatorAddress: FOUNDER };
    const first = prepareChildPayout(identity, db, FORK, SWITCH);
    expect(first.lineage).toMatchObject({ founderAddress: FOUNDER, cloneNumber: 1, generation: 1, switchUrl: SWITCH });
    expect(isPayingClone(first.lineage)).toBe(true);
    expect(first.promptNote).toContain("<founder-payout>");
    // spawn failed -> not committed -> same number again
    expect(prepareChildPayout(identity, db, FORK, SWITCH).lineage?.cloneNumber).toBe(1);
    first.commit();
    expect(prepareChildPayout(identity, db, FORK, SWITCH).lineage?.cloneNumber).toBe(2);
  });

  it("refuses to spawn while repo or switch are not configured", () => {
    const db = createTestDb();
    expect(() => prepareChildPayout(createTestIdentity(), db, UPSTREAM_REPO_URL, SWITCH)).toThrow(/CHILD_REPO_URL/);
    expect(() => prepareChildPayout(createTestIdentity(), db, FORK, "https://raw.githubusercontent.com/YOUR-GITHUB-NAME/automaton/main/auszahlung.json")).toThrow(/PAYOUT_SWITCH_URL/);
  });

  it("builds a safe install command", () => {
    expect(childInstallCommand(FORK)).toContain(`git clone ${FORK} /root/automaton`);
    expect(() => childInstallCommand("https://x.com/a.git; rm -rf /")).toThrow();
  });
});

describe("tamper protection", () => {
  it("protects payout code and lineage data from self-modification", () => {
    for (const p of [
      "/root/automaton/src/payout/rules.ts",
      "/root/automaton/dist/payout/creator-payout.js",
      "/root/.automaton/genesis.json",
      "/root/automaton/src/replication/spawn.ts",
      "/root/automaton/src/heartbeat/daemon.ts",
    ]) {
      expect(isProtectedFile(p), p).toBe(true);
    }
  });

  it("blocks shell commands that edit payout code or state", () => {
    expect(getForbiddenCommandMatch("sed -i 's/5/0/' src/payout/rules.ts")).not.toBeNull();
    expect(getForbiddenCommandMatch("echo {} > /root/.automaton/genesis.json")).not.toBeNull();
    expect(getForbiddenCommandMatch("sqlite3 state.db \"UPDATE kv SET value='x' WHERE key='creatorPayout.lastAt'\"")).not.toBeNull();
    expect(getForbiddenCommandMatch("ls -la")).toBeNull();
  });
});
