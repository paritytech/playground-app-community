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
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

// `./utils` barrel re-exports `./utils/contracts.ts` which eagerly calls
// `getChainAPI(CHAIN)` on import — throws in Node. Mock just the symbols
// Leaderboard actually consumes.
const getTopBuilders = vi.fn();
let usernamesBatch = new Map<string, string | null>();
vi.mock("./utils", () => ({
  registryReady: Promise.resolve({
    getTopBuilders: { query: (...args: unknown[]) => getTopBuilders(...args) },
  }),
  stringify: (v: unknown) => JSON.stringify(v),
  // The leaderboard now batch-resolves usernames per page. Returning an
  // empty map lets every row fall back to a deterministic generated name.
  useRegistryUsernamesBatch: () => usernamesBatch,
  profilePathForAccount: (account: string, username: string | null | undefined) =>
    `/profile/${encodeURIComponent(username || account)}`,
  displayNameForAccount: (username: string | null | undefined, account: string | null | undefined) =>
    username?.trim() || `generated ${String(account).slice(2, 6)} name`,
  // `shortAddr` is re-exported from Leaderboard but originates in utils,
  // so the import chain hits this mock first. Mirror the implementation
  // here so the dedicated `shortAddr` tests still pass.
  shortAddr: (addr: string) => {
    if (!addr) return "";
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  },
}));

import Leaderboard, { shortAddr } from "./Leaderboard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  getTopBuilders.mockReset();
  usernamesBatch = new Map();
});

/** Wait for the leaderboard's initial async fetch to flush a render. */
async function flushFetch() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderLeaderboard(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("shortAddr", () => {
  it("truncates an H160 to 0xabcd…1234", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("returns short strings unchanged", () => {
    expect(shortAddr("0xabcd")).toBe("0xabcd");
  });
});

describe("Leaderboard — rendering", () => {
  it("shows the empty state when the contract returns zero entries", async () => {
    getTopBuilders.mockResolvedValue({ success: true, value: [] });
    renderLeaderboard(<Leaderboard />);
    await flushFetch();
    expect(screen.getByTestId("leaderboard-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-list")).toBeNull();
  });

  it("renders ranked rows in the order the contract returned them", async () => {
    getTopBuilders.mockResolvedValue({
      success: true,
      value: [
        { account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", score: 12n },
        { account: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", score: 7n },
        { account: "0xcccccccccccccccccccccccccccccccccccccccc", score: 3n },
      ],
    });
    renderLeaderboard(<Leaderboard />);
    await flushFetch();

    const rows = screen.getAllByTestId("leaderboard-row");
    expect(rows).toHaveLength(3);
    // The contract sorts descending; the component must not re-sort.
    expect(rows[0]).toHaveAttribute("data-rank", "1");
    expect(rows[0]).toHaveTextContent("12");
    expect(rows[1]).toHaveAttribute("data-rank", "2");
    expect(rows[1]).toHaveTextContent("7");
    expect(rows[2]).toHaveAttribute("data-rank", "3");
    expect(rows[2]).toHaveTextContent("3");
  });

  it("highlights the row belonging to the connected viewer", async () => {
    const meAddr = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    getTopBuilders.mockResolvedValue({
      success: true,
      value: [
        { account: "0xffffffffffffffffffffffffffffffffffffffff", score: 99n },
        { account: meAddr, score: 50n },
      ],
    });
    renderLeaderboard(<Leaderboard currentUserAddr={meAddr} />);
    await flushFetch();

    const rows = screen.getAllByTestId("leaderboard-row");
    expect(rows[0]).toHaveAttribute("data-is-you", "false");
    expect(rows[1]).toHaveAttribute("data-is-you", "true");
    expect(screen.getByText("you")).toBeInTheDocument();
  });

  it("matches the viewer regardless of address case", async () => {
    getTopBuilders.mockResolvedValue({
      success: true,
      value: [{ account: "0xAaAa000000000000000000000000000000000000", score: 1n }],
    });
    renderLeaderboard(<Leaderboard currentUserAddr="0xaaaa000000000000000000000000000000000000" />);
    await flushFetch();
    expect(screen.getByTestId("leaderboard-row")).toHaveAttribute("data-is-you", "true");
  });

  it("falls back to an empty list when the contract read fails", async () => {
    getTopBuilders.mockResolvedValue({ success: false, value: null });
    renderLeaderboard(<Leaderboard />);
    await flushFetch();
    expect(screen.getByTestId("leaderboard-empty")).toBeInTheDocument();
  });

  it("links each builder to their public profile by username when available", async () => {
    const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    usernamesBatch = new Map([[account, "alice"]]);
    getTopBuilders.mockResolvedValue({
      success: true,
      value: [{ account, score: 12n }],
    });

    renderLeaderboard(<Leaderboard />);
    await flushFetch();

    const link = screen.getByTestId("leaderboard-profile-link");
    expect(link).toHaveAttribute("href", "/profile/alice");
    expect(link).toHaveTextContent("alice");
  });

  it("uses a deterministic label while keeping the profile link address-backed without a username", async () => {
    const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    getTopBuilders.mockResolvedValue({
      success: true,
      value: [{ account, score: 12n }],
    });

    renderLeaderboard(<Leaderboard />);
    await flushFetch();

    const link = screen.getByTestId("leaderboard-profile-link");
    expect(link).toHaveAttribute("href", `/profile/${account}`);
    expect(link).toHaveTextContent("generated aaaa name");
    expect(link).not.toHaveTextContent("0xaaaa");
  });
});

describe("Leaderboard — refresh wiring", () => {
  it("invokes the registered refresh and re-fetches on call", async () => {
    getTopBuilders.mockResolvedValueOnce({
      success: true,
      value: [{ account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", score: 1n }],
    });
    let refresh: (() => void) | undefined;
    const register = vi.fn((fn?: () => void) => { refresh = fn ?? undefined; });

    renderLeaderboard(<Leaderboard registerRefresh={register} />);
    await flushFetch();

    // First fetch — initial render.
    expect(getTopBuilders).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith(expect.any(Function));

    // Second fetch — triggered by event-driven refresh.
    getTopBuilders.mockResolvedValueOnce({
      success: true,
      value: [
        { account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", score: 1n },
        { account: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", score: 1n },
      ],
    });
    await act(async () => {
      refresh!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getTopBuilders).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("leaderboard-row")).toHaveLength(2);
  });

  it("deregisters the refresh callback on unmount", async () => {
    getTopBuilders.mockResolvedValue({ success: true, value: [] });
    const register = vi.fn();

    const { unmount } = renderLeaderboard(<Leaderboard registerRefresh={register} />);
    await flushFetch();

    // Registered once on mount...
    expect(register).toHaveBeenCalledWith(expect.any(Function));
    register.mockClear();

    unmount();
    // ...and cleared once on unmount, so the parent can stop polling a
    // setter bound to an unmounted tree.
    expect(register).toHaveBeenCalledWith(undefined);
  });
});
