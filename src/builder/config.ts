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

// Builder-local network config: DotNS contract addresses, gateway, and
// faucets for the active test network. The rpc/genesis fields in
// networks.json are vestigial here — chain connections are owned by
// playground's SDK stack (product-sdk-chain-client / cloud-storage), which
// resolves endpoints from its own environment presets.
//
// Single switch: the active network is ENVIRONMENT (VITE_ENVIRONMENT), the
// SAME value that selects the SDK chain client and PAPI descriptors in
// config.ts / utils/contracts.ts. networks.json keys mirror the Environment
// union, so the builder's contract addresses can never point at a different
// chain than the rest of the app.

import networksConfig from "./networks.json";
import { ENVIRONMENT } from "../config.ts";

export interface BuilderNetworkConfig {
  name: string;
  description: string;
  ipfsGateway: string;
  dotHost: string;
  nativeToEthRatio: number;
  bulletinFaucetUrl: string;
  pasFaucetUrl: string;
  contracts: {
    registry: string;
    registrar: string;
    registrarController: string;
    contentResolver: string;
    popRules: string;
  };
}

const networks: Record<string, BuilderNetworkConfig> = networksConfig.networks;
export const NETWORK: BuilderNetworkConfig = networks[ENVIRONMENT];
if (!NETWORK) {
  throw new Error(
    `builder/networks.json has no entry for ENVIRONMENT="${ENVIRONMENT}". ` +
      `Add a "${ENVIRONMENT}" network or fix VITE_ENVIRONMENT.`,
  );
}

export const BULLETIN_GATEWAY = `${NETWORK.ipfsGateway}/ipfs/`;

/** Host suffix where DotNS names resolve (e.g. `<name>.dot.li`). */
export const DOT_HOST = NETWORK.dotHost;

/** DotNS deployed contract addresses on the active network's Asset Hub. */
export const DOTNS_CONTRACTS = NETWORK.contracts;

/** Native-token base units → EVM Wei (18 decimals) conversion factor. */
export const NATIVE_TO_ETH_RATIO = BigInt(NETWORK.nativeToEthRatio);

/** Self-serve faucet for Bulletin storage authorization. */
export const BULLETIN_FAUCET_URL = NETWORK.bulletinFaucetUrl;

/** Faucet for native tokens to pay contract fees on Asset Hub. */
export const PAS_FAUCET_URL = NETWORK.pasFaucetUrl;
