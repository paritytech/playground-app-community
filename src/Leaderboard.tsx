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

import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  registryReady,
  stringify,
  shortAddr,
  displayNameForAccount,
  profilePathForAccount,
  useRegistryUsernamesBatch,
} from "./utils";

interface TopBuilderRow { account: string; score: bigint }

const PAGE_SIZE = 20;

export interface TopBuilder {
  account: string;
  score: bigint;
}

export { shortAddr };

async function fetchTopBuilders(start: number, count: number): Promise<TopBuilder[]> {
  try {
    const registry = await registryReady;
    const res = await registry.getTopBuilders.query(start, count);
    if (!res.success) {
      console.warn(
        `[playground] registry.getTopBuilders(${start}, ${count}) returned success:false — ${stringify(res)}`,
      );
      return [];
    }
    return res.value.map((e: TopBuilderRow) => ({ account: e.account, score: e.score }));
  } catch (cause) {
    console.warn(
      `[playground] registry.getTopBuilders(${start}, ${count}) threw — ${stringify(cause)}`,
    );
    return [];
  }
}

interface LeaderboardProps {
  /** H160 of the current viewer — their row gets a "you" highlight. */
  currentUserAddr?: string | null;
  /**
   * Setter that exposes a refresh function to the parent. Wired into the
   * registry event dispatcher so award events trigger a re-fetch. The
   * parent receives `undefined` on unmount so it stops invoking a stale
   * setter bound to a tree that's no longer mounted.
   */
  registerRefresh?: (refresh: (() => void) | undefined) => void;
}

export default function Leaderboard({ currentUserAddr, registerRefresh }: LeaderboardProps) {
  const [entries, setEntries] = useState<TopBuilder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!registerRefresh) return;
    registerRefresh(triggerRefresh);
    return () => registerRefresh(undefined);
  }, [registerRefresh, triggerRefresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchTopBuilders(0, PAGE_SIZE).then((rows) => {
      if (cancelled) return;
      setEntries(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const me = currentUserAddr?.toLowerCase();

  // Batch-resolve usernames for the current page. The hook keys on the joined
  // lowercase address list, so it only re-fires when the leaderboard rotates,
  // not on every render.
  const addressesForBatch = useMemo(
    () => entries.map((e) => e.account as `0x${string}`),
    [entries],
  );
  const usernames = useRegistryUsernamesBatch(addressesForBatch, refreshKey);

  return (
    <div className="tab tab-leaderboard" data-testid="leaderboard" data-loading={loading ? "true" : "false"}>
      <div className="tab-center">
        <header className="tab-header">
          <h1 className="tab-title">Leaderboard</h1>
          <p className="tab-lead">
            Top builders by XP. You earn XP when you deploy an app, when someone mods your app, and when someone stars it.
          </p>
          <Link className="leaderboard-xp-link" to="/?section=xp-prizes">
            How XP &amp; Prizes work →
          </Link>
        </header>

        <section className="leaderboard-card">
          <div className="leaderboard-colhead" role="row">
            <span>Rank</span>
            <span>Builder</span>
            <span className="leaderboard-col-xp">XP</span>
          </div>

          {entries.length === 0 ? (
            <p className="leaderboard-empty" data-testid="leaderboard-empty">
              <em>{loading ? "Loading…" : "No points awarded yet. Publish an app to earn launch XP."}</em>
            </p>
          ) : (
            <ol className="leaderboard-list" data-testid="leaderboard-list">
              {entries.map((e, i) => {
                const isYou = !!me && e.account.toLowerCase() === me;
                const username = usernames.get(e.account.toLowerCase()) ?? null;
                const label = displayNameForAccount(username, e.account);
                return (
                  <li
                    key={e.account}
                    className={`leaderboard-row${isYou ? " leaderboard-row-me" : ""}`}
                    data-testid="leaderboard-row"
                    data-rank={i + 1}
                    data-account={e.account}
                    data-username={username ?? ""}
                    data-is-you={isYou ? "true" : "false"}
                  >
                    <span className="leaderboard-rank">{i + 1}</span>
                    <Link
                      className="leaderboard-name leaderboard-profile-link"
                      title={label}
                      to={profilePathForAccount(e.account, username)}
                      data-testid="leaderboard-profile-link"
                    >
                      {label}
                      {isYou && <span className="leaderboard-you-badge">you</span>}
                    </Link>
                    <span className="leaderboard-xp">{e.score.toString()}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
