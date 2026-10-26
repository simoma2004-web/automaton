/**
 * Creator Payout Runtime
 *
 * Runs inside every automaton, independent of the agent loop and of the
 * agent-editable heartbeat.yml. Only clones pay (never the founder's own
 * automaton), and only while the founder's switch file says so. Transfers are plain USDC (ERC-20) transfers on Base,
 * paid for with a little ETH for gas from the clone's own wallet.
 *
 * This file is protected from self-modification (see self-mod/code.ts).
 */

import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { base } from "viem/chains";
import { ulid } from "ulid";
import type { AutomatonDatabase, AutomatonIdentity } from "../types.js";
import { getAutomatonDir } from "../identity/wallet.js";
import { createLogger } from "../observability/logger.js";
import {
  calculatePayoutUsdc,
  isPayingClone,
  parsePayoutLineage,
  parseSwitch,
  type PayoutLineage,
  type PayoutSwitch,
} from "./rules.js";

const logger = createLogger("creator-payout");

const USDC_BASE: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/** Minimum ETH (in wei) needed to attempt a transfer on Base (~0.00002 ETH). */
const MIN_GAS_WEI = 20_000_000_000_000n;

const KV_LAST_PAYOUT = "creatorPayout.lastAt";
const KV_TOTAL_PAID = "creatorPayout.totalUsdc";

/** Read the founder's switch file. Any error means "off". Injectable for tests. */
export type SwitchReader = (url: string) => Promise<PayoutSwitch>;

export const readSwitchFromGitHub: SwitchReader = async (url) => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const resp = await fetch(`${url}?t=${Date.now()}`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!resp.ok) return { active: false, percent: 0 };
    return parseSwitch(await resp.json());
  } catch {
    return { active: false, percent: 0 };
  }
};

/** Chain access, injectable for tests. */
export interface PayoutChain {
  getUsdcBalance(address: Address): Promise<number>;
  getEthBalanceWei(address: Address): Promise<bigint>;
  sendUsdc(account: PrivateKeyAccount, to: Address, amountUsdc: number): Promise<string>;
}

export function createBaseChain(rpcUrl?: string): PayoutChain {
  const transport = http(rpcUrl || process.env.AUTOMATON_RPC_URL || undefined, { timeout: 20_000 });
  const publicClient = createPublicClient({ chain: base, transport });
  return {
    async getUsdcBalance(address) {
      const raw = await publicClient.readContract({
        address: USDC_BASE,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      return Number(raw) / 1_000_000;
    },
    async getEthBalanceWei(address) {
      return publicClient.getBalance({ address });
    },
    async sendUsdc(account, to, amountUsdc) {
      const walletClient = createWalletClient({ account, chain: base, transport });
      const hash = await walletClient.writeContract({
        address: USDC_BASE,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [to, parseUnits(amountUsdc.toFixed(2), 6)],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") {
        throw new Error(`USDC transfer reverted (tx ${hash})`);
      }
      return hash;
    },
  };
}

/** Read this automaton's lineage block from ~/.automaton/genesis.json (children only). */
export function loadOwnLineage(dir: string = getAutomatonDir()): PayoutLineage | null {
  try {
    const file = path.join(dir, "genesis.json");
    if (!fs.existsSync(file)) return null;
    const genesis = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsePayoutLineage(genesis?.payout);
  } catch {
    return null;
  }
}

/**
 * The founder of this lineage. For the founder's own automaton (no lineage
 * block) that is its configured creator; for clones it is inherited.
 */
export function resolveFounderAddress(
  lineage: PayoutLineage | null,
  configCreatorAddress: string,
): string {
  return lineage?.founderAddress || configCreatorAddress;
}

export type PayoutOutcome =
  | { status: "not_payer" }
  | { status: "switched_off" }
  | { status: "unsupported_chain" }
  | { status: "too_soon"; nextAt: string }
  | { status: "no_surplus"; balanceUsdc: number }
  | { status: "no_gas"; amountUsdc: number }
  | { status: "paid"; amountUsdc: number; txHash: string }
  | { status: "error"; error: string };

export interface PayoutRunParams {
  identity: AutomatonIdentity;
  db: AutomatonDatabase;
  lineage: PayoutLineage | null;
  chain: PayoutChain;
  readSwitch?: SwitchReader;
  now?: Date;
}

/** One payout attempt. Safe to call often; it rate-limits itself. */
export async function runCreatorPayout(params: PayoutRunParams): Promise<PayoutOutcome> {
  const { identity, db, lineage, chain } = params;
  const now = params.now ?? new Date();

  if (!lineage || !isPayingClone(lineage)) {
    return { status: "not_payer" };
  }
  if ((identity.chainType ?? "evm") !== "evm") {
    return { status: "unsupported_chain" };
  }

  const last = db.getKV(KV_LAST_PAYOUT);
  if (last) {
    const nextAt = new Date(new Date(last).getTime() + lineage.intervalHours * 3_600_000);
    if (now < nextAt) return { status: "too_soon", nextAt: nextAt.toISOString() };
  }

  const sw = await (params.readSwitch ?? readSwitchFromGitHub)(lineage.switchUrl);
  if (!sw.active) return { status: "switched_off" };

  try {
    const self = identity.address as Address;
    const balanceUsdc = await chain.getUsdcBalance(self);
    const amountUsdc = calculatePayoutUsdc(
      balanceUsdc,
      lineage.reserveUsdc,
      sw.percent,
      lineage.minPayoutUsdc,
    );
    if (amountUsdc <= 0) return { status: "no_surplus", balanceUsdc };

    const gas = await chain.getEthBalanceWei(self);
    if (gas < MIN_GAS_WEI) {
      logger.warn(`Payout of ${amountUsdc} USDC due, but no ETH on Base for gas. Send a little ETH to ${self}.`);
      return { status: "no_gas", amountUsdc };
    }

    const txHash = await chain.sendUsdc(identity.account, lineage.founderAddress as Address, amountUsdc);

    db.setKV(KV_LAST_PAYOUT, now.toISOString());
    const total = Number(db.getKV(KV_TOTAL_PAID) || "0") + amountUsdc;
    db.setKV(KV_TOTAL_PAID, total.toFixed(2));
    db.insertTransaction({
      id: ulid(),
      type: "transfer_out",
      amountCents: Math.round(amountUsdc * 100),
      description: `Founder payout (${sw.percent}% of surplus above ${lineage.reserveUsdc} USDC) to ${lineage.founderAddress}, tx ${txHash}`,
      timestamp: now.toISOString(),
    });
    logger.info(`Paid ${amountUsdc} USDC to founder ${lineage.founderAddress} (tx ${txHash})`);
    return { status: "paid", amountUsdc, txHash };
  } catch (err: any) {
    const error = err?.message || String(err);
    logger.error(`Founder payout failed: ${error}`);
    return { status: "error", error };
  }
}

/**
 * Start the background payout check. Runs hourly; the 24h interval is
 * enforced inside runCreatorPayout. Does nothing for the founder's own automaton.
 */
export function startCreatorPayoutLoop(opts: {
  identity: AutomatonIdentity;
  db: AutomatonDatabase;
  rpcUrl?: string;
  checkEveryMs?: number;
}): () => void {
  const lineage = loadOwnLineage();
  if (!lineage || !isPayingClone(lineage)) {
    return () => {};
  }
  logger.info(
    `This clone (generation ${lineage.generation}, #${lineage.cloneNumber}) pays the founder ${lineage.founderAddress} while the founder's switch is on.`,
  );

  const chain = createBaseChain(opts.rpcUrl);
  const every = opts.checkEveryMs ?? 3_600_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runCreatorPayout({ identity: opts.identity, db: opts.db, lineage, chain });
    } catch {
      // runCreatorPayout already logs
    }
    if (!stopped) timer = setTimeout(tick, every);
  };
  timer = setTimeout(tick, 5 * 60_000); // first check 5 minutes after start

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
