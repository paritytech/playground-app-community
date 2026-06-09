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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const getPointBreakdown = vi.fn();
vi.mock("./utils", () => ({
  registryReady: Promise.resolve({
    getPointBreakdown: { query: (...args: unknown[]) => getPointBreakdown(...args) },
  }),
  stringify: (v: unknown) => JSON.stringify(v),
}));

import PointsBreakdown from "./PointsBreakdown";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  getPointBreakdown.mockReset();
});

async function flushFetch() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("PointsBreakdown — rendering", () => {
  it("renders total XP + per-bucket XP (mod_count×50, star_count×10, deploys = residual)", async () => {
    // Scenario mirrors the smoke test's USER_B post-mod-credit state:
    // total = 100 (deploy) + 50 (one mod received) = 150. mod_count = 1,
    // star_count = 0. So Mods displays 50, Stars 0, Deploys = 150 - 50 = 100.
    getPointBreakdown.mockResolvedValue({
      success: true,
      value: { launch_points: 0n, mod_points: 1n, star_points: 0n, total: 150n },
    });
    render(<PointsBreakdown account={ACCOUNT} refreshKey={0} />);
    await flushFetch();

    expect(screen.getByTestId("points-total")).toHaveTextContent("150");
    expect(screen.getByTestId("points-mod")).toHaveTextContent("50");
    expect(screen.getByTestId("points-star")).toHaveTextContent("0");
    expect(screen.getByTestId("points-deploys")).toHaveTextContent("100");
  });

  it("derives star XP from star_count × STAR_RECEIVED_XP", async () => {
    // 3 stars received on a deploy-less account → total 30, all from stars.
    getPointBreakdown.mockResolvedValue({
      success: true,
      value: { launch_points: 0n, mod_points: 0n, star_points: 3n, total: 30n },
    });
    render(<PointsBreakdown account={ACCOUNT} refreshKey={0} />);
    await flushFetch();

    expect(screen.getByTestId("points-total")).toHaveTextContent("30");
    expect(screen.getByTestId("points-star")).toHaveTextContent("30");
    expect(screen.getByTestId("points-deploys")).toHaveTextContent("0");
  });

  it("falls back to zeros when the contract read fails", async () => {
    getPointBreakdown.mockResolvedValue({ success: false, value: null });
    render(<PointsBreakdown account={ACCOUNT} refreshKey={0} />);
    await flushFetch();

    // Component shows total 0 + three zero buckets — never throws or
    // shows NaN — so an offline chain doesn't blank the profile header.
    expect(screen.getByTestId("points-total")).toHaveTextContent("0");
    expect(screen.getByTestId("points-deploys")).toHaveTextContent("0");
    expect(screen.getByTestId("points-mod")).toHaveTextContent("0");
    expect(screen.getByTestId("points-star")).toHaveTextContent("0");
  });

  it("falls back to zeros when the query throws", async () => {
    getPointBreakdown.mockRejectedValue(new Error("WS down"));
    render(<PointsBreakdown account={ACCOUNT} refreshKey={0} />);
    await flushFetch();
    expect(screen.getByTestId("points-total")).toHaveTextContent("0");
  });
});

describe("PointsBreakdown — refresh wiring", () => {
  it("re-fetches when refreshKey bumps (driven by registry-event dispatcher)", async () => {
    getPointBreakdown.mockResolvedValueOnce({
      success: true,
      value: { launch_points: 2n, mod_points: 0n, star_points: 0n, total: 2n },
    });
    const { rerender } = render(<PointsBreakdown account={ACCOUNT} refreshKey={0} />);
    await flushFetch();
    expect(screen.getByTestId("points-total")).toHaveTextContent("2");
    expect(getPointBreakdown).toHaveBeenCalledTimes(1);

    getPointBreakdown.mockResolvedValueOnce({
      success: true,
      value: { launch_points: 2n, mod_points: 0n, star_points: 1n, total: 3n },
    });
    rerender(<PointsBreakdown account={ACCOUNT} refreshKey={1} />);
    await flushFetch();
    expect(screen.getByTestId("points-total")).toHaveTextContent("3");
    expect(getPointBreakdown).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when the account changes", async () => {
    getPointBreakdown.mockResolvedValue({
      success: true,
      value: { launch_points: 0n, mod_points: 0n, star_points: 0n, total: 0n },
    });
    const { rerender } = render(<PointsBreakdown account={ACCOUNT} refreshKey={0} />);
    await flushFetch();

    rerender(
      <PointsBreakdown
        account="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        refreshKey={0}
      />,
    );
    await flushFetch();

    expect(getPointBreakdown).toHaveBeenCalledTimes(2);
    expect(getPointBreakdown).toHaveBeenLastCalledWith(
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });
});
