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

/**
 * Username helpers: client-side validation that mirrors the contract's
 * `validate_username`, plus React hooks for reading the per-account username
 * and batch-reading usernames for the leaderboard. Display fallbacks live in
 * `displayNameForAccount` so the same precedence (registry username →
 * deterministic generated name) is used everywhere.
 */

import { useEffect, useState } from "react";
import { registryReady } from "./contracts.ts";
import { stringify } from "./stringify.ts";

export const USERNAME_MIN_LEN = 3;
export const USERNAME_MAX_LEN = 30;
export const ZERO_H160 = `0x${"0".repeat(40)}` as const;

/**
 * Client-side validator mirroring the contract's `validate_username`. Returns
 * an error code matching the on-chain revert tag so the same message can be
 * surfaced regardless of where the rejection came from. Input is lowercased
 * before checking, which matches what the contract does internally.
 */
export type UsernameValidationError =
  | "UsernameTooShort"
  | "UsernameTooLong"
  | "UsernameInvalidChar"
  | "UsernameInvalidEdge"
  | "UsernameDoubleDash";

export function validateUsernameClient(raw: string): UsernameValidationError | null {
  const name = raw.toLowerCase();
  if (name.length < USERNAME_MIN_LEN) return "UsernameTooShort";
  if (name.length > USERNAME_MAX_LEN) return "UsernameTooLong";
  if (name.startsWith("-") || name.endsWith("-")) return "UsernameInvalidEdge";
  let prevDash = false;
  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    const ok =
      (ch >= 97 && ch <= 122) /* a-z */ ||
      (ch >= 48 && ch <= 57) /* 0-9 */ ||
      ch === 45; /* '-' */
    if (!ok) return "UsernameInvalidChar";
    const isDash = ch === 45;
    if (isDash && prevDash) return "UsernameDoubleDash";
    prevDash = isDash;
  }
  return null;
}

const VALIDATION_COPY: Record<UsernameValidationError, string> = {
  UsernameTooShort: `Use at least ${USERNAME_MIN_LEN} characters.`,
  UsernameTooLong: `Keep it under ${USERNAME_MAX_LEN + 1} characters.`,
  UsernameInvalidChar: "Only lowercase letters, digits, and hyphens.",
  UsernameInvalidEdge: "Cannot start or end with a hyphen.",
  UsernameDoubleDash: "No two hyphens in a row.",
};

export function describeValidationError(err: UsernameValidationError): string {
  return VALIDATION_COPY[err];
}

/**
 * Truncate an H160 to "0xabcd…1234" for compact display. Mirrors
 * `Leaderboard.shortAddr` but lives here so it can be shared without an
 * import cycle through the leaderboard component.
 */
export function shortAddr(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function isH160Address(input: string): input is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(input);
}

const ANONYMOUS_DESCRIPTORS = [
  "anonymous",
  "clandestine",
  "concealed",
  "cloaked",
  "covert",
  "cryptic",
  "disguised",
  "faceless",
  "furtive",
  "ghosted",
  "hidden",
  "hushed",
  "lowkey",
  "mysterious",
  "mystery",
  "masked",
  "nameless",
  "obscure",
  "incognito",
  "phantom",
  "private",
  "pseudonymous",
  "shrouded",
  "secret",
  "shadow",
  "silent",
  "stealthy",
  "unknown",
  "unseen",
  "veiled",
] as const;

const ANIMALS = [
  "aardvark",
  "albatross",
  "alpaca",
  "antelope",
  "armadillo",
  "axolotl",
  "badger",
  "barracuda",
  "beaver",
  "bison",
  "bobcat",
  "bonobo",
  "buffalo",
  "camel",
  "capybara",
  "caracal",
  "cassowary",
  "cheetah",
  "chinchilla",
  "chimera",
  "cobra",
  "cougar",
  "coyote",
  "crane",
  "crocodile",
  "deer",
  "dingo",
  "dolphin",
  "donkey",
  "dragon",
  "eagle",
  "echidna",
  "eel",
  "elephant",
  "elk",
  "falcon",
  "ferret",
  "flamingo",
  "fox",
  "frog",
  "gazelle",
  "gecko",
  "giraffe",
  "goat",
  "goose",
  "gorilla",
  "griffin",
  "hare",
  "hawk",
  "hedgehog",
  "heron",
  "hippo",
  "hippogriff",
  "hyena",
  "ibex",
  "iguana",
  "jackal",
  "jaguar",
  "jellyfish",
  "kangaroo",
  "kestrel",
  "kiwi",
  "koala",
  "kraken",
  "lemur",
  "leopard",
  "leviathan",
  "lion",
  "llama",
  "lobster",
  "lynx",
  "macaw",
  "manatee",
  "manticore",
  "manta",
  "marten",
  "meerkat",
  "minotaur",
  "moose",
  "narwhal",
  "newt",
  "nightingale",
  "orca",
  "oryx",
  "ostrich",
  "otter",
  "owl",
  "panda",
  "panther",
  "parrot",
  "peacock",
  "pegasus",
  "penguin",
  "phoenix",
  "platypus",
  "porcupine",
  "puffin",
  "python",
  "quokka",
  "rabbit",
  "raven",
  "salamander",
  "seal",
  "serval",
  "shark",
  "skink",
  "sloth",
  "sparrow",
  "sphinx",
  "squid",
  "stoat",
  "swan",
  "tapir",
  "tiger",
  "toad",
  "toucan",
  "turtle",
  "unicorn",
  "viper",
  "wallaby",
  "whale",
  "wolf",
  "wombat",
  "wyvern",
  "yak",
  "zebra",
] as const;

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function pickDeterministic<const T extends readonly string[]>(
  words: T,
  seed: string,
  salt: string,
): T[number] {
  return words[hashString(`${seed}:${salt}`) % words.length];
}

export function deterministicNameForAccount(account: string | null | undefined): string {
  const seed = account?.trim().toLowerCase();
  if (!seed) return "";
  return [
    pickDeterministic(ANONYMOUS_DESCRIPTORS, seed, "anonymous"),
    pickDeterministic(ANIMALS, seed, "animal"),
  ].join(" ");
}

export function profilePathForAccount(
  account: string,
  registryUsername: string | null | undefined,
): string {
  return `/profile/${encodeURIComponent(registryUsername || account)}`;
}

export type ProfileIdentifierResolution = {
  address: `0x${string}`;
  lookup: "address" | "username";
  normalizedInput: string;
};

/**
 * Resolve a public profile route segment into the owner H160 used by the
 * owner-app queries. Raw H160s pass through directly; usernames use the
 * registry's reverse index.
 */
export async function resolveProfileIdentifier(
  raw: string,
): Promise<ProfileIdentifierResolution | null> {
  const input = raw.trim();
  if (!input) return null;

  if (isH160Address(input)) {
    return {
      address: input.toLowerCase() as `0x${string}`,
      lookup: "address",
      normalizedInput: input.toLowerCase(),
    };
  }

  const name = input.toLowerCase();
  try {
    const registry = await registryReady;
    const res = await registry.getUsernameOwner.query(name);
    if (!res.success) {
      console.warn(
        `[playground] registry.getUsernameOwner(${name}) returned success:false — ${stringify(res)}`,
      );
      return null;
    }
    const address = String(res.value ?? "").toLowerCase();
    if (!isH160Address(address) || address === ZERO_H160) return null;
    return {
      address: address as `0x${string}`,
      lookup: "username",
      normalizedInput: name,
    };
  } catch (cause) {
    console.warn(
      `[playground] registry.getUsernameOwner(${name}) threw — ${stringify(cause)}`,
    );
    return null;
  }
}

/**
 * Display-name precedence:
 *   1. registry username (the user's chosen handle)
 *   2. deterministic generated name from the account address
 * Stays in one place so leaderboard, MyApps header, and badge UIs all agree.
 */
export function displayNameForAccount(
  registryUsername: string | null | undefined,
  h160: string | null | undefined,
): string {
  const username = registryUsername?.trim();
  if (username) return username;
  return deterministicNameForAccount(h160);
}

/**
 * Watch a single account's registry username with best-block freshness.
 * `null` means no name set yet (treat as anonymous); `undefined` means we
 * haven't loaded once yet. `refreshKey` reruns the read.
 */
export function useRegistryUsername(
  account: `0x${string}` | undefined | null,
  refreshKey: number = 0,
): { username: string | null | undefined; loading: boolean; refresh: () => void } {
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    if (!account) {
      setUsername(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const registry = await registryReady;
        const res = await registry.getUsername.query(account);
        if (cancelled) return;
        if (res.success) {
          const value = res.value ?? "";
          setUsername(value === "" ? null : value);
        } else {
          console.warn(
            `[playground] registry.getUsername(${account}) returned success:false — ${stringify(res)}`,
          );
          setUsername(null);
        }
      } catch (cause) {
        if (cancelled) return;
        console.warn(
          `[playground] registry.getUsername(${account}) threw — ${stringify(cause)}`,
        );
        setUsername(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account, refreshKey, localKey]);

  return {
    username,
    loading,
    refresh: () => setLocalKey((k) => k + 1),
  };
}

/**
 * Batch-read usernames for a list of addresses (leaderboard, future
 * collaborator lists). One contract call per address-set change. Empty
 * strings come back as `null` to make falsy checks easy. `refreshKey`
 * forces a re-read independent of address changes.
 */
export function useRegistryUsernamesBatch(
  addresses: ReadonlyArray<`0x${string}`>,
  refreshKey: number = 0,
): Map<string, string | null> {
  const [map, setMap] = useState<Map<string, string | null>>(new Map());

  // Stable key for the deps array — comparing the array by reference would
  // re-fire on every render when callers build the list inline. Lowercased
  // so the cache hits regardless of caller casing.
  const key = addresses.map((a) => a.toLowerCase()).join(",");

  useEffect(() => {
    if (addresses.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const registry = await registryReady;
        const res = await registry.getUsernames.query(addresses as `0x${string}`[]);
        if (cancelled) return;
        if (!res.success) {
          console.warn(
            `[playground] registry.getUsernames(${addresses.length}) returned success:false — ${stringify(res)}`,
          );
          return;
        }
        const next = new Map<string, string | null>();
        const values: string[] = res.value as unknown as string[];
        for (let i = 0; i < addresses.length; i++) {
          const addr = addresses[i].toLowerCase();
          const v = values[i] ?? "";
          next.set(addr, v === "" ? null : v);
        }
        setMap(next);
      } catch (cause) {
        if (cancelled) return;
        console.warn(
          `[playground] registry.getUsernames(${addresses.length}) threw — ${stringify(cause)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the
    // canonical form of `addresses` (see comment above).
  }, [key, refreshKey]);

  return map;
}
