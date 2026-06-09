// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

/**
 * Manage the `playground.dot` context on @polkadot/contexts.
 *
 *   bun scripts/register-context.ts                # register (signer = owner = initial operator)
 *   bun scripts/register-context.ts add [<0x...>]  # add operator (defaults to registry from cdm.json)
 *   bun scripts/register-context.ts remove <0x...> # remove operator
 *
 * Env: MNEMONIC = sr25519 mnemonic of the context owner.
 */

import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import {
  ContractManager,
  type CdmJson,
} from "@parity/product-sdk-contracts";
import { seedToAccount } from "@parity/product-sdk-keys";
import { keccak256, utf8ToBytes, bytesToHex } from "@parity/product-sdk-utils";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import cdmJson from "../cdm.json" with { type: "json" };
import {
  CONTEXTS_CONTRACT,
  PLAYGROUND_REGISTRY_CONTRACT,
} from "../src/utils/contractManifest.ts";
import { assetHubWsUrl } from "./_lib.ts";

const CONTEXT_LABEL = "playground.dot";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Mode =
  | { kind: "register" }
  | { kind: "add" | "remove"; operator: `0x${string}` };

function resolveRegistryAddress(): `0x${string}` {
  const contracts = (cdmJson as { contracts: Record<string, { address: `0x${string}` }> }).contracts;
  const addr = contracts[PLAYGROUND_REGISTRY_CONTRACT]?.address;
  if (!addr) throw new Error(`cdm.json has no ${PLAYGROUND_REGISTRY_CONTRACT} entry.`);
  return addr;
}

function parseArgs(argv: string[]): Mode {
  const [cmd, arg] = argv.slice(2);
  if (cmd === undefined) return { kind: "register" };
  if (cmd === "add") {
    return { kind: "add", operator: (arg as `0x${string}`) ?? resolveRegistryAddress() };
  }
  if (cmd === "remove") {
    if (!arg) {
      console.error("Usage: remove <0x-h160>");
      process.exit(2);
    }
    return { kind: "remove", operator: arg as `0x${string}` };
  }
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}

const mode = parseArgs(process.argv);

const mnemonic = process.env.MNEMONIC;
if (!mnemonic) {
  console.error("MNEMONIC env var required (context-owner sr25519 mnemonic)");
  process.exit(1);
}

const contextId = `0x${bytesToHex(keccak256(utf8ToBytes(CONTEXT_LABEL)))}` as `0x${string}`;
const { signer, ss58Address: origin, h160Address: ownerH160 } = seedToAccount(mnemonic, "");

console.log(`Context label : "${CONTEXT_LABEL}"`);
console.log(`Context ID    : ${contextId}`);
console.log(`Signer        : ${origin}  (${ownerH160})`);
console.log();

const client = createClient(getWsProvider(assetHubWsUrl()));

// `registryOrigin: origin` keeps the CDM meta-registry dry-runs aligned with
// the signer's mapped account so they don't fall back to Alice (which spams
// "[contracts] No origin configured" warnings).
const manager = await ContractManager.fromLiveClient(
  cdmJson as unknown as CdmJson,
  client,
  paseo_asset_hub,
  {
    defaultSigner: signer,
    defaultOrigin: origin,
    registryOrigin: origin,
    libraries: [PLAYGROUND_REGISTRY_CONTRACT, CONTEXTS_CONTRACT],
  },
);

try {
  const contexts = manager.getContract(CONTEXTS_CONTRACT as never) as any;
  console.log(`Contexts contract: ${manager.getAddress(CONTEXTS_CONTRACT as never)}\n`);

  const ownerRes = await contexts.getOwner.query(contextId);
  const existingOwner: `0x${string}` = ownerRes.success ? ownerRes.value : ZERO_ADDRESS;
  const isRegistered = existingOwner.toLowerCase() !== ZERO_ADDRESS;
  console.log(`Existing owner: ${isRegistered ? existingOwner : "<unregistered>"}`);

  if (mode.kind === "register") {
    if (isRegistered) {
      if (existingOwner.toLowerCase() !== ownerH160.toLowerCase()) {
        throw new Error(
          `Context already registered with a different owner (${existingOwner}). Re-run from the original owner.`,
        );
      }
      console.log("Already registered with this owner — nothing to do.");
    } else {
      console.log(`Registering context with owner = operator = ${ownerH160}...`);
      const res = await contexts.registerContext.tx(contextId, ownerH160, ownerH160);
      if (!res.ok) throw new Error("registerContext transaction failed");
      console.log(`Tx: ${res.txHash}`);
    }
  } else {
    if (!isRegistered) {
      throw new Error(`Context not registered — run \`pnpm tsx scripts/register-context.ts\` first.`);
    }
    // Contexts v4 exposes batched addOperators/removeOperators; pass a
    // single-element Vec. Idempotent at the contract level (presence-only),
    // so no pre-check — just submit and let the chain dedupe.
    const method = mode.kind === "add" ? "addOperators" : "removeOperators";
    console.log(`${mode.kind === "add" ? "Adding" : "Removing"} operator ${mode.operator}...`);
    const res = await contexts[method].tx(contextId, [mode.operator]);
    if (!res.ok) throw new Error(`${method} transaction failed`);
    console.log(`Tx: ${res.txHash}`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  client.destroy();
}
