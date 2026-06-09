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

import "./sentry.ts";
import "./lib/logger-config.ts";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import * as Sentry from "@sentry/react";
import "@fontsource-variable/inter";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./App.css";

// Lazy-loaded so that App.tsx's module-level side effects (page-load journey,
// signer subscription) don't execute when the user is on the test-sentry page
// or when a Polkadot Desktop dashboard widget mounts the lean widget root.
const App = lazy(() => import("./App.tsx"));
const TestSentry = lazy(() => import("./TestSentry.tsx"));
const MyAppsWidget = lazy(() => import("./MyAppsWidget.tsx"));

const isTestPage = new URLSearchParams(window.location.search).has("test-sentry");
// Interim hookup for the Polkadot Desktop *Widget* modality. The eventual
// shape (see "Product Manifest Proposal.md") is a separately-deployed
// widget executable referenced from a dotNS root manifest's
// `Topology::Widget` list — likely served from a subdomain like
// `myapps-widget.playground.dot` with its own IPFS bundle and checksum.
// Until that lands, we share this SPA's bundle and branch on the pathname.
// Branching here (not inside <App />) keeps the heavy grid + admin +
// pinned-apps initialisation out of the widget tile so first paint is fast.
const isWidget = window.location.pathname.startsWith("/widget");

const FallbackUi = () => (
  <div style={{ padding: "2rem", color: "#fff", fontFamily: "ui-monospace, monospace" }}>
    <h2>Something went wrong.</h2>
    <p>The error has been reported. Reload the page to try again.</p>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={<FallbackUi />}
      beforeCapture={(scope) => scope.setTag("boundary", "root")}
    >
      <Suspense fallback={null}>
        {isTestPage ? (
          <TestSentry />
        ) : isWidget ? (
          <MyAppsWidget />
        ) : (
          <BrowserRouter>
            <App />
          </BrowserRouter>
        )}
      </Suspense>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
