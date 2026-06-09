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
import {
  bytesToHex0x,
  domainToEntity,
  decodeContextIdValue,
} from "./registryUtils";

describe("bytesToHex0x", () => {
  it("prefixes a hex-encoded byte string with 0x", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToHex0x(bytes)).toBe("0xdeadbeef");
  });

  it("returns 0x for an empty byte array", () => {
    expect(bytesToHex0x(new Uint8Array([]))).toBe("0x");
  });

  it("preserves leading zeros (a regression-prone case for naive impls)", () => {
    // Naive Number/BigInt round-trips would silently drop leading zeros.
    // Pin the byte-faithful behaviour.
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x01]);
    expect(bytesToHex0x(bytes)).toBe("0x00000001");
  });
});

describe("domainToEntity", () => {
  it("hashes a domain string to a 32-byte 0x-prefixed hex (64 hex chars + 0x)", () => {
    const out = domainToEntity("example.dot");
    expect(out).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic — same input → same output", () => {
    expect(domainToEntity("playground-e2e-app.dot"))
      .toBe(domainToEntity("playground-e2e-app.dot"));
  });

  it("produces different hashes for different domains (collision check, sanity)", () => {
    expect(domainToEntity("a.dot")).not.toBe(domainToEntity("b.dot"));
    // Subtle: case-sensitive UTF-8 — capital A is a different byte sequence.
    expect(domainToEntity("a.dot")).not.toBe(domainToEntity("A.dot"));
  });

  it("treats domains with the same chars but different unicode normalisation as different inputs", () => {
    // "é" can be NFC (one codepoint) or NFD (two). Encoded bytes differ.
    // The function intentionally does not normalise — callers + the
    // contract see identical strings as identical, divergent normalisations
    // as different (matches on-chain behaviour).
    const nfc = "ré.dot";       // U+00E9
    const nfd = "ré.dot"; // U+0065 U+0301
    expect(domainToEntity(nfc)).not.toBe(domainToEntity(nfd));
  });
});

describe("decodeContextIdValue", () => {
  it("returns 0x-prefixed strings unchanged", () => {
    const s = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    expect(decodeContextIdValue(s)).toBe(s);
  });

  it("prepends 0x to bare hex strings (no 0x prefix)", () => {
    const bare = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    expect(decodeContextIdValue(bare)).toBe("0x" + bare);
  });

  it("calls asHex() on SDK wrapper objects", () => {
    let called = 0;
    const wrapper = {
      asHex() {
        called++;
        return "0xdeadbeef";
      },
    };
    expect(decodeContextIdValue(wrapper)).toBe("0xdeadbeef");
    expect(called).toBe(1);
  });

  it("converts Uint8Array via bytesToHex0x", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(decodeContextIdValue(bytes)).toBe("0xdeadbeef");
  });

  it("throws on unknown shapes (defensive — SDK ABI change should surface loudly)", () => {
    // Number, object without asHex, null, undefined, plain array — all
    // should error so a regression in the SDK's return shape can't
    // silently produce garbage context IDs.
    expect(() => decodeContextIdValue(42)).toThrow(/Unexpected getContextId value shape/);
    expect(() => decodeContextIdValue({ random: "object" })).toThrow();
    expect(() => decodeContextIdValue(null)).toThrow();
    expect(() => decodeContextIdValue(undefined)).toThrow();
    expect(() => decodeContextIdValue([0xde, 0xad])).toThrow();
  });

  it("includes the offending value in the error message for debugging", () => {
    try {
      decodeContextIdValue({ weird: "shape" });
      expect.fail("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("Unexpected getContextId value shape");
      expect(msg).toContain("weird");
    }
  });
});
