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

import { hostApi, sandboxTransport } from "@novasamatech/host-api-wrapper";
import type React from "react";
import { captureWarning } from "../lib/telemetry";
import { stringify } from "./stringify";

// Inside the Polkadot Desktop host (iframe/webview), route navigation through
// hostApi so the app shell handles the URL. Outside Desktop, fall through to
// the anchor's default browser navigation by NOT calling preventDefault.
export function handleExternalClick(e: React.MouseEvent<HTMLAnchorElement>) {
  // Outside the Polkadot Desktop host (normal browser), let the anchor navigate
  // by default — don't preventDefault, or the link does nothing.
  if (!sandboxTransport.isCorrectEnvironment()) return;
  e.preventDefault();
  const url = e.currentTarget.href;
  hostApi.navigateTo({ tag: "v1", value: url }).then(result => {
    if (result.isErr()) {
      // stringify because the host's console wrapper flattens objects.
      captureWarning(
        "hostApi.navigateTo failed",
        { url, error: stringify(result.error) },
      );
    }
  });
}
