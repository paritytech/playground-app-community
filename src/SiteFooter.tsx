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

import { Link } from "react-router-dom";
import { BUILD_TIME, VERSION } from "./config";

const CAT_CLOUD: Array<{ cat: string; subs: string[] }> = [
  { cat: "Games", subs: ["arcade", "puzzle", "pvp", "leaderboard", "racing"] },
  { cat: "DeFi", subs: ["airdrop", "paymaster", "faucet", "tip jar", "vault"] },
  { cat: "Personal", subs: ["profile", "calendar"] },
  {
    cat: "Social",
    subs: ["chat", "channel", "poll", "vote", "members-only", "broadcast", "p2p"],
  },
  { cat: "IRL", subs: ["scavenger", "qr", "venue", "loyalty", "stamp"] },
  { cat: "Art", subs: ["generative"] },
];

/**
 * Shared site footer. Rendered at the bottom of both the Playground and About
 * tabs (the category cloud links into the Apps tab, the meta line carries the
 * build stamp).
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-col footer-col-cats">
          <div className="cat-cloud">
            {CAT_CLOUD.map(({ cat, subs }) => (
              <span key={cat} className="cat-cloud-group">
                <Link className="cat-chip" data-cat={cat} to={`/apps?cat=${cat}`}>
                  {cat}
                </Link>
                {subs.map((sub) => (
                  <span key={sub} className="cat-chip sub-tag">
                    {sub}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
        <div className="footer-col footer-col-meta">
          <p className="footer-meta">playground · web3 summit 2026</p>
          <p className="footer-meta">
            {BUILD_TIME
              ? `${VERSION} · built ${new Date(BUILD_TIME).toLocaleString()}`
              : `${VERSION} · local development build`}
          </p>
        </div>
      </div>
    </footer>
  );
}
