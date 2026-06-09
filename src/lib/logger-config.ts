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

import { configure, type LogLevel } from "@parity/product-sdk-logger";
import * as Sentry from "@sentry/react";
import { stringify } from "../utils/stringify.ts";
import { isSigningRejection } from "./telemetry";

type SentryLevel = "error" | "warning" | "info" | "debug";

// The host shell's console wrapper (Polkadot Desktop, the test fixture)
// coerces object args with String(), so the default `console.error("[ns]",
// msg, data)` prints `[object Object]`. Route data through our stringify()
// to keep bigints / byte arrays / Error own-props / circular refs readable.

const SENTRY_LEVEL: Record<LogLevel, SentryLevel> = {
  error: "error",
  warn: "warning",
  info: "info",
  debug: "debug",
};

// `@parity/product-sdk-tx` calls `log.error("Transaction subscription error",
// { error: "Rejected" })` BEFORE classifying — drop the level when it's
// just a user cancellation. The canonical rejection signal still surfaces
// via runTx + the call site. Wrap data.error in a synthetic Error so the
// upstream rejection classifier handles all the message variants the SDK
// recognises (cancelled / rejected / denied / user refused), instead of
// pattern-matching here.
function isLibraryUserRejection(namespace: string, data: unknown): boolean {
  if (namespace !== "tx") return false;
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err !== "string") return false;
  return isSigningRejection(new Error(err));
}

configure({
  handler: ({ level, namespace, message, data }) => {
    const effective: LogLevel = isLibraryUserRejection(namespace, data)
      ? "debug"
      : level;
    const isLoud = effective === "error" || effective === "warn";

    const prefix = `[${namespace}]`;
    // stringify() walks Error own-props + handles bigints/circular refs —
    // worth it for warn/error where we render readably; pass-through for
    // debug/info to skip the JSON.stringify allocation on hot paths.
    const args = data === undefined
      ? [prefix, message]
      : [prefix, message, isLoud ? stringify(data) : data];
    console[effective](...args);

    Sentry.addBreadcrumb({
      category: `polkadot-apps:${namespace}`,
      message,
      level: SENTRY_LEVEL[effective],
      data: data as Record<string, unknown> | undefined,
    });

    // Skip the standalone event for `tx` errors — runTx + call-site
    // captureException already record those, so capturing here would
    // duplicate every tx failure into Sentry.
    if (isLoud && namespace !== "tx") {
      Sentry.captureMessage(`[${namespace}] ${message}`, {
        level: SENTRY_LEVEL[effective],
        extra: data as Record<string, unknown> | undefined,
        tags: { source: "polkadot-apps", namespace },
      });
    }
  },
});
