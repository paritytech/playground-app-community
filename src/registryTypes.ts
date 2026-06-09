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

// Side-effect-free types + constants for registry-domain code.
// Lives separately from App.tsx so unit-test importers don't pull in
// chain-connection side effects via the App module's transitive imports.

export const VISIBILITY_PUBLIC = 1;

export interface AppEntry {
  /// Slot index in the global registry. Only set when the entry comes from
  /// a paginated query (getApps / getPinnedApps); absent for entries
  /// fetched by domain.
  index?: number;
  domain: string;
  owner?: string;
  metadataUri?: string;
  pinned?: boolean;
  visibility?: number;
  /// The H160 that submitted the original `publish` call. May differ from
  /// `owner` when the CLI's dev-mode flow records the user as owner while
  /// signing with Alice. Populated from `get_apps` / `get_pinned_apps`;
  /// not surfaced by per-domain getters in V1.
  publisher?: string;
}
