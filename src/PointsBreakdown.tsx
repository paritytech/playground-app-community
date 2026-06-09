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

import { useEffect, useState } from "react";
import { registryReady, stringify } from "./utils";
import { XP_VALUES } from "./xpValues";

export interface PointBreakdown {
  total: bigint;
  launch_points: bigint;
  mod_points: bigint;
  star_points: bigint;
}

const ZERO: PointBreakdown = {
  total: 0n,
  launch_points: 0n,
  mod_points: 0n,
  star_points: 0n,
};

/**
 * Read get_point_breakdown(account) from the registry. Returns ZERO on
 * any failure so the UI degrades gracefully.
 */
export async function fetchPointBreakdown(account: string): Promise<PointBreakdown> {
  try {
    const registry = await registryReady;
    const res = await registry.getPointBreakdown.query(account as `0x${string}`);
    if (!res.success) {
      console.warn(
        `[playground] registry.getPointBreakdown(${account}) returned success:false — ${stringify(res)}`,
      );
      return ZERO;
    }
    return res.value;
  } catch (cause) {
    console.warn(
      `[playground] registry.getPointBreakdown(${account}) threw — ${stringify(cause)}`,
    );
    return ZERO;
  }
}

interface PointsBreakdownProps {
  /** H160 of the account whose points to show. */
  account: string;
  /**
   * Increment to force a refresh. The parent bumps this when an award
   * event fires (via refreshLeaderboard wired into the registry event
   * dispatcher), so the points update live without polling.
   */
  refreshKey: number;
}

const MOD_XP = BigInt(XP_VALUES.modReceived);
const STAR_XP = BigInt(XP_VALUES.starReceived);

/**
 * Renders the user's XP summary — total XP plus the per-source XP buckets.
 * Mods/Stars XP comes from multiplying the per-domain `mod_count`/`star_count`
 * counts the contract exposes; Deploys XP is the residual (total − mod − star),
 * which folds in the deploy reward plus the one-time username bonus and stays
 * correct under all the suppression edge cases (private apps, dev-signer, 3rd+
 * deploys) where `owner_app_count × DEPLOY_XP` would overstate.
 */
export default function PointsBreakdown({ account, refreshKey }: PointsBreakdownProps) {
  const [breakdown, setBreakdown] = useState<PointBreakdown>(ZERO);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPointBreakdown(account).then((b) => {
      if (cancelled) return;
      setBreakdown(b);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [account, refreshKey]);

  const modXp = breakdown.mod_points * MOD_XP;
  const starXp = breakdown.star_points * STAR_XP;
  // Residual; saturates at 0 in case of inconsistent reads.
  const deployXp =
    breakdown.total > modXp + starXp ? breakdown.total - modXp - starXp : 0n;

  return (
    <div className="points-breakdown" data-testid="points-breakdown" data-loading={loading ? "true" : "false"}>
      <dl className="points-stat points-stat-total" data-testid="points-total">
        <dt className="points-stat-label">Total XP</dt>
        <dd className="points-stat-value">{breakdown.total.toString()}</dd>
      </dl>
      <dl className="points-stat" data-testid="points-deploys">
        <dt className="points-stat-label">Deploy XP</dt>
        <dd className="points-stat-value">{deployXp.toString()}</dd>
      </dl>
      <dl className="points-stat" data-testid="points-mod">
        <dt className="points-stat-label">Mod XP</dt>
        <dd className="points-stat-value">{modXp.toString()}</dd>
      </dl>
      <dl className="points-stat" data-testid="points-star">
        <dt className="points-stat-label">Star XP</dt>
        <dd className="points-stat-value">{starXp.toString()}</dd>
      </dl>
    </div>
  );
}
