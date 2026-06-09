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

import { describe, it, expect } from "vitest";
import { placeholderFor } from "./placeholders";

describe("placeholderFor", () => {
  it("returns the same placeholder for the same domain (deterministic)", () => {
    // Determinism is load-bearing: the grid renders one card per registry
    // entry, and each render re-derives the placeholder. A non-deterministic
    // result would cause the icon to flicker between renders.
    const first = placeholderFor("example.dot");
    const second = placeholderFor("example.dot");
    expect(second).toBe(first);
  });

  it("returns a path under assets/placeholders/", () => {
    // Sanity: the function maps into the bundled JPGs, not an arbitrary
    // string. Catches the regression where the glob pattern stops matching
    // (e.g. file extension changes, directory moves).
    const result = placeholderFor("example.dot");
    expect(result).toMatch(/placeholders\//);
  });

  it("distributes domains across multiple placeholders", () => {
    // The hash → index mapping must spread across the available set;
    // otherwise every card on the grid would share the same image. Sampling
    // 20 distinct domains and counting distinct outputs is a probabilistic
    // test — with ~20 placeholders and a reasonable hash, collisions are
    // rare. Threshold of >3 is conservative: even a terrible distribution
    // (e.g. always mod=0) would fail this.
    const domains = Array.from({ length: 20 }, (_, i) => `app-${i}.dot`);
    const results = new Set(domains.map(placeholderFor));
    expect(results.size).toBeGreaterThan(3);
  });

  it("handles the empty-domain edge case without throwing", () => {
    // Defensive: the App.tsx fallback already short-circuits empty domains
    // upstream, but the util shouldn't trap on its own. The hash loop runs
    // 0 times, so the modulo is `Math.abs(0) % N = 0` — first placeholder.
    expect(() => placeholderFor("")).not.toThrow();
    expect(placeholderFor("")).toMatch(/placeholders\//);
  });

  it("handles Unicode in the domain without throwing", () => {
    // The hash iterates charCodeAt — for surrogate pairs this reads each
    // code unit independently, which is fine (just deterministic, not
    // canonically "right"). Test guards against a future regression to
    // codePointAt that doesn't account for the surrogate-pair width.
    expect(() => placeholderFor("café.dot")).not.toThrow();
    expect(() => placeholderFor("🎯.dot")).not.toThrow();
  });
});
