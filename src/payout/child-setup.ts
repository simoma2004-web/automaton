/**
 * Founder-payout data for newly spawned children.
 *
 * Used by replication/spawn.ts. Protected from self-modification.
 */

import type { AutomatonDatabase, AutomatonIdentity } from "../types.js";
import { loadOwnLineage, resolveFounderAddress } from "./creator-payout.js";
import {
  CHILD_REPO_URL,
  PAYOUT_SWITCH_URL,
  buildChildLineage,
  isRepoConfigured,
  clonePromptNote,
  type PayoutLineage,
} from "./rules.js";

const KV_CHILD_COUNTER = "creatorPayout.childCounter";

export interface ChildPayoutSetup {
  repoUrl: string;
  /** Lineage block for genesis.json, or null if the lineage has no EVM founder. */
  lineage: PayoutLineage | null;
  /** Text to append to the child's genesis prompt ("" for non-payers). */
  promptNote: string;
  /** Call after the child was created successfully, so the clone number is used up. */
  commit(): void;
}

export function prepareChildPayout(
  identity: AutomatonIdentity,
  db: AutomatonDatabase,
  repoUrl: string = CHILD_REPO_URL,
  switchUrl: string = PAYOUT_SWITCH_URL,
): ChildPayoutSetup {
  if (!isRepoConfigured(repoUrl, switchUrl)) {
    throw new Error(
      "Cannot spawn: CHILD_REPO_URL or PAYOUT_SWITCH_URL in src/payout/rules.ts still points to a placeholder or the original Conway repo. " +
        "Set both to your own fork that contains the founder-payout code, otherwise children would lose the payout rule.",
    );
  }

  const own = loadOwnLineage();
  const founder = resolveFounderAddress(own, identity.creatorAddress);
  const nextNumber = Number(db.getKV(KV_CHILD_COUNTER) || "0") + 1;
  const generation = (own?.generation ?? 0) + 1;
  // Inherit the founder's switch from our own lineage; the founder's automaton uses the configured one.
  const childSwitchUrl = own?.switchUrl ?? switchUrl;

  const lineage = /^0x[a-fA-F0-9]{40}$/.test(founder)
    ? buildChildLineage(founder, nextNumber, generation, childSwitchUrl)
    : null;

  return {
    repoUrl,
    lineage,
    promptNote: lineage ? clonePromptNote(lineage) : "",
    commit() {
      db.setKV(KV_CHILD_COUNTER, String(nextNumber));
    },
  };
}

/** The shell command that installs the runtime in a child sandbox. */
export function childInstallCommand(repoUrl: string): string {
  if (!/^https:\/\/[A-Za-z0-9._\-/]+\.git$/.test(repoUrl)) {
    throw new Error(`Invalid child repo URL: ${repoUrl}`);
  }
  return `git clone ${repoUrl} /root/automaton && cd /root/automaton && npm install && npm run build`;
}
