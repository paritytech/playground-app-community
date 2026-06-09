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

import PrizeList from "./PrizeList";
import RewardLine from "./RewardLine";
import { XP_VALUES } from "./xpValues";

/**
 * The XP & Prizes information card — the first text a visitor reads below the
 * hero island. It carries the core message (Playground rewards starting points,
 * not just apps), the XP-mechanics list, the prize breakdown, and the two
 * entry-point CTAs. `id="xp-prizes"` is the anchor the TOC and the Leaderboard
 * "How XP & Prizes work" link target.
 */
export default function XpPrizesSection() {
  return (
    <section id="xp-prizes" className="xp-prizes" aria-labelledby="xp-prizes-title">
      <div className="xp-prizes-card">
        <header className="xp-prizes-head">
          <h2 id="xp-prizes-title" className="xp-prizes-title">
            XP &amp; Prizes
          </h2>
          <p className="xp-prizes-lede">
            Playground rewards people not only for building apps, but for creating
            starting points that inspire other people to build too.
          </p>
        </header>

        <p className="xp-prizes-body">
          Join the Playground, build apps, and earn XP when your ideas spark
          something new. Launch your first projects, publish them on a{" "}
          <code className="inline-code">.dot</code> domain, make them moddable, and
          collect XP when other builders remix your app or star it. The strongest
          apps do more than climb the leaderboard. They give someone else a place
          to start. Explore what others are making, star the apps you like, help
          choose the winners, and compete for prizes.
        </p>

        <div className="xp-prizes-grid">
          <div className="xp-prizes-col">
            <h3 className="xp-prizes-subhead">Prizes</h3>
            <PrizeList />
          </div>
          <div className="xp-prizes-col">
            <h3 className="xp-prizes-subhead">How you earn XP</h3>
            <ul className="reward-list">
              <RewardLine
                title="Name claimed"
                amount={XP_VALUES.username}
                condition="for setting your username"
              />
              <RewardLine
                title="Novice"
                amount={XP_VALUES.deploy}
                condition="awarded twice — for your 1st and 2nd deploy"
              />
              <RewardLine
                title="Starting point"
                amount={XP_VALUES.modReceived}
                condition="each time someone mods your app"
              />
              <RewardLine
                title="Crowd pick"
                amount={XP_VALUES.starReceived}
                condition="each time someone stars your app"
              />
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
