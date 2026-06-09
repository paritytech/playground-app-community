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

// Side-effect-free helpers for the registry-domain code in App.tsx. Lives
// separately so unit tests can import without pulling chain-init side
// effects from the App module's transitive imports.

import { keccak256, utf8ToBytes, bytesToHex } from "@parity/product-sdk-utils";

export type Hex32 = `0x${string}`;

/**
 * Prefix a hex-encoded byte string with `0x`. Matches the
 * `@parity/product-sdk-contracts` ≥ 0.4 expectation that bytes32 args
 * arrive as `0x`-prefixed `SizedHex<N>` strings rather than the SDK's
 * lenient runtime-decode shapes.
 */
export function bytesToHex0x(bytes: Uint8Array): Hex32 {
  return `0x${bytesToHex(bytes)}` as Hex32;
}

/**
 * Hash a domain string into a 32-byte entity ID (keccak256 of UTF-8
 * bytes), returned as a `0x`-prefixed hex string. The reputation
 * pallet uses this as the per-app key inside a context.
 */
export function domainToEntity(domain: string): Hex32 {
  return bytesToHex0x(keccak256(utf8ToBytes(domain)));
}

/**
 * Decode a `getContextId` query result into a `0x`-prefixed hex string.
 *
 * The SDK has returned the bytes32 value in three different shapes
 * across versions:
 *   1. **String** — either already `0x`-prefixed or bare hex
 *   2. **`{ asHex(): string }`** — SDK wrapper objects in older versions
 *   3. **`Uint8Array`** — raw bytes from low-level decode paths
 *
 * This decoder normalises all three to the `Hex32` type the contract
 * wrappers expect. Throws on any other shape so an SDK ABI change
 * surfaces loudly instead of silently producing garbage IDs.
 */
export function decodeContextIdValue(v: unknown): Hex32 {
  if (typeof v === "string") {
    return (v.startsWith("0x") ? v : `0x${v}`) as Hex32;
  }
  if (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { asHex?: unknown }).asHex === "function"
  ) {
    return (v as { asHex: () => string }).asHex() as Hex32;
  }
  if (v instanceof Uint8Array) return bytesToHex0x(v);
  throw new Error(`Unexpected getContextId value shape: ${JSON.stringify(v)}`);
}
