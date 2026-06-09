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

import { beforeEach, describe, expect, it, vi } from "vitest";

const getUsernameOwner = vi.hoisted(() => vi.fn());

vi.mock("./contracts.ts", () => ({
  registryReady: Promise.resolve({
    getUsernameOwner: { query: (...args: unknown[]) => getUsernameOwner(...args) },
  }),
}));

import {
  deterministicNameForAccount,
  displayNameForAccount,
  profilePathForAccount,
  resolveProfileIdentifier,
  ZERO_H160,
} from "./username";

beforeEach(() => {
  getUsernameOwner.mockReset();
});

describe("profilePathForAccount", () => {
  it("prefers a registry username over the raw address", () => {
    expect(
      profilePathForAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "alice"),
    ).toBe("/profile/alice");
  });

  it("falls back to the address when no username is set", () => {
    expect(
      profilePathForAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", null),
    ).toBe("/profile/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });
});

describe("displayNameForAccount", () => {
  const account = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("prefers a registry username", () => {
    expect(displayNameForAccount("alice", account)).toBe("alice");
  });

  it("falls back to a deterministic two-word name", () => {
    const name = displayNameForAccount(null, account);

    expect(name).toBe(deterministicNameForAccount(account));
    expect(name.split(" ")).toHaveLength(2);
    expect(name).not.toContain("0x");
  });

  it("normalizes account casing before deriving the fallback", () => {
    expect(deterministicNameForAccount(account.toUpperCase())).toBe(
      deterministicNameForAccount(account),
    );
  });
});

describe("resolveProfileIdentifier", () => {
  it("accepts a raw H160 without querying the username reverse index", async () => {
    const result = await resolveProfileIdentifier("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    expect(result).toEqual({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      lookup: "address",
      normalizedInput: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(getUsernameOwner).not.toHaveBeenCalled();
  });

  it("resolves a username to its owner H160", async () => {
    getUsernameOwner.mockResolvedValue({
      success: true,
      value: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const result = await resolveProfileIdentifier("Alice");

    expect(getUsernameOwner).toHaveBeenCalledWith("alice");
    expect(result).toEqual({
      address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      lookup: "username",
      normalizedInput: "alice",
    });
  });

  it("returns null for unclaimed usernames", async () => {
    getUsernameOwner.mockResolvedValue({ success: true, value: ZERO_H160 });

    await expect(resolveProfileIdentifier("nobody")).resolves.toBeNull();
  });
});
