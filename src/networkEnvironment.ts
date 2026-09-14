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

export const ENVIRONMENTS = ["paseo", "devnet"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Keep runtime network selection identical to Vite's literal descriptor fold. */
export function resolveEnvironment(raw: string | undefined): Environment {
  if (raw === undefined || raw === "") return "paseo";
  if (raw === "paseo" || raw === "devnet") return raw;
  throw new Error(`Unsupported VITE_ENVIRONMENT: ${JSON.stringify(raw)}. Use exactly paseo or devnet.`);
}
