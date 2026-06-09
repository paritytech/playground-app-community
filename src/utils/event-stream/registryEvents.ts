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

import { keccak256, utf8ToBytes, bytesToHex } from "@parity/product-sdk-utils";
import {
  decodeModPointEventPayload,
  decodePointAwardEventPayload,
  decodeStarPointEventPayload,
  type ModPointEventPayload,
  type PointAwardEventPayload,
  type StarPointEventPayload,
  type UsernameBonusEventPayload,
} from "./scaleDecode";

export const RAW_DOMAIN_REGISTRY_EVENTS = [
  "Published",
  "Unpublished",
  "Rated",
  "RatingRemoved",
  "VisibilityChanged",
  "Pinned",
  "Unpinned",
] as const;

// `PlaygroundPublishPointAwarded` and `ModdablePointAwarded` were emitted
// alongside the legacy +1-per-bucket model. After #286 only DeployPointAwarded
// fires for a launch reward (single +100). The legacy names stay declared so
// historical events from a pre-redeploy contract still resolve to a name
// rather than silently dropping; no new emissions are expected.
export const POINT_AWARD_REGISTRY_EVENTS = [
  "DeployPointAwarded",
  "PlaygroundPublishPointAwarded",
  "ModdablePointAwarded",
] as const;

// `StarPointRefunded` was emitted by `unstar` under the pre-#287 model where
// the owner's score went back down on unstar. The new model is one-way (no
// refund); the name is retained so historical refunds from older deployments
// still decode.
export const TYPED_REGISTRY_EVENTS = [
  ...POINT_AWARD_REGISTRY_EVENTS,
  "ModPointAwarded",
  "StarPointAwarded",
  "StarPointRefunded",
  "UsernameBonusAwarded",
] as const;

export const USERNAME_REGISTRY_EVENTS = [
  "UsernameSet",
  "UsernameCleared",
] as const;

export const REGISTRY_EVENT_NAMES = [
  ...RAW_DOMAIN_REGISTRY_EVENTS,
  ...TYPED_REGISTRY_EVENTS,
  ...USERNAME_REGISTRY_EVENTS,
] as const;

export type RawDomainRegistryEventName = (typeof RAW_DOMAIN_REGISTRY_EVENTS)[number];
export type PointAwardRegistryEventName = (typeof POINT_AWARD_REGISTRY_EVENTS)[number];
export type TypedRegistryEventName = (typeof TYPED_REGISTRY_EVENTS)[number];
export type UsernameRegistryEventName = (typeof USERNAME_REGISTRY_EVENTS)[number];
export type RegistryEventName = (typeof REGISTRY_EVENT_NAMES)[number];

export const TYPED_PAYLOAD_EVENTS: ReadonlySet<RegistryEventName> = new Set(TYPED_REGISTRY_EVENTS);

const RAW_DOMAIN_EVENT_SET: ReadonlySet<RegistryEventName> = new Set(RAW_DOMAIN_REGISTRY_EVENTS);
const POINT_AWARD_EVENT_SET: ReadonlySet<RegistryEventName> = new Set(POINT_AWARD_REGISTRY_EVENTS);
const USERNAME_EVENT_SET: ReadonlySet<RegistryEventName> = new Set(USERNAME_REGISTRY_EVENTS);

export interface RawDomainRegistryEventPayload {
  domain: string;
}

export interface UsernameRegistryEventPayload {
  username: string;
}

export interface RegistryEventPayloadBase {
  pointDelta?: 1 | -1;
}

export type RegistryEventPayload =
  | (RawDomainRegistryEventPayload & RegistryEventPayloadBase)
  | (UsernameRegistryEventPayload & RegistryEventPayloadBase)
  | (PointAwardEventPayload & RegistryEventPayloadBase)
  | (ModPointEventPayload & RegistryEventPayloadBase)
  | (StarPointEventPayload & RegistryEventPayloadBase)
  | (UsernameBonusEventPayload & RegistryEventPayloadBase);

export interface DecodedRegistryEvent<N extends RegistryEventName = RegistryEventName> {
  name: N;
  topic: `0x${string}`;
  payload: RegistryEventPayload;
  /** Domain whose app/social state should be refreshed, when the event has one. */
  primaryDomain?: string;
  /** Account whose points/name changed, when the event has one. */
  primaryAccount?: `0x${string}`;
  /** XP movement represented by this event, when the event is points-related. */
  pointDelta?: 1 | -1;
}

export interface ContractEmittedPayload {
  contract: unknown;
  topics?: readonly unknown[];
  data: unknown;
}

interface ContractEmittedWatchEvent {
  payload?: ContractEmittedPayload;
}

interface ContractEmittedWatchValue {
  type?: "new" | "drop" | "finalized";
  events?: readonly ContractEmittedWatchEvent[];
  payload?: ContractEmittedPayload;
}

export function registryEventTopic(name: RegistryEventName): `0x${string}` {
  return `0x${bytesToHex(keccak256(utf8ToBytes(name)))}` as `0x${string}`;
}

export const REGISTRY_EVENT_TOPICS: ReadonlyMap<string, RegistryEventName> = new Map(
  REGISTRY_EVENT_NAMES.map((name) => [registryEventTopic(name).toLowerCase(), name]),
);

export function registryEventNameForTopic(topicHex: string): RegistryEventName | undefined {
  return REGISTRY_EVENT_TOPICS.get(topicHex.toLowerCase());
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToPrefixedHex(bytes: Uint8Array | readonly number[]): `0x${string}` {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

function toHex(v: unknown): string {
  if (typeof v === "string") {
    return v.startsWith("0x") || v.startsWith("0X") ? v : `0x${v}`;
  }
  if (v instanceof Uint8Array) return bytesToPrefixedHex(v);
  if (Array.isArray(v) && v.every((byte) => typeof byte === "number")) {
    return bytesToPrefixedHex(v);
  }

  const maybeHex = v as { toHex?: () => string; asHex?: () => string; asBytes?: () => unknown };
  const hex = maybeHex?.toHex?.() ?? maybeHex?.asHex?.();
  if (typeof hex === "string") return hex;

  const bytes = maybeHex?.asBytes?.();
  if (bytes instanceof Uint8Array) return bytesToPrefixedHex(bytes);

  return String(v);
}

function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex byte string has odd length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function eventDataBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  const asBytes = (data as { asBytes?: () => unknown })?.asBytes?.();
  if (asBytes instanceof Uint8Array) return asBytes;
  if (Array.isArray(data) && data.every((byte) => typeof byte === "number")) return new Uint8Array(data);
  if (typeof data === "string") return bytesFromHex(data);
  throw new Error("unsupported ContractEmitted data shape");
}

function isContractEmittedPayload(value: unknown): value is ContractEmittedPayload {
  return !!value && typeof value === "object" && "contract" in value && "data" in value;
}

function hasPayload(value: unknown): value is { payload: ContractEmittedPayload } {
  if (!value || typeof value !== "object" || !("payload" in value)) return false;
  return isContractEmittedPayload((value as { payload?: unknown }).payload);
}

export function contractEmittedPayloadsFromWatchValue(value: unknown): readonly ContractEmittedPayload[] {
  if (!value || typeof value !== "object") return [];
  const watchValue = value as ContractEmittedWatchValue;
  if (watchValue.type && watchValue.type !== "new") return [];

  if (Array.isArray(watchValue.events)) {
    return watchValue.events.flatMap((event) => hasPayload(event) ? [event.payload] : []);
  }

  return hasPayload(watchValue) ? [watchValue.payload] : [];
}

export function decodeRegistryEventFromContractEmittedPayload(
  payload: ContractEmittedPayload,
  registryAddress: string,
): DecodedRegistryEvent | null {
  const contractHex = toHex(payload.contract);
  if (contractHex.toLowerCase() !== registryAddress.toLowerCase()) return null;

  const topics = Array.isArray(payload.topics) ? payload.topics : [];
  if (topics.length === 0) return null;

  const topicHex = toHex(topics[0]).toLowerCase();
  return decodeRegistryEventFromTopic(topicHex, eventDataBytes(payload.data));
}

export function decodeRegistryEventData(
  name: RegistryEventName,
  bytes: Uint8Array,
): DecodedRegistryEvent {
  const topic = registryEventTopic(name);

  if (RAW_DOMAIN_EVENT_SET.has(name)) {
    const domain = decodeUtf8(bytes);
    return {
      name,
      topic,
      payload: { domain },
      primaryDomain: domain,
    };
  }

  if (USERNAME_EVENT_SET.has(name)) {
    const username = decodeUtf8(bytes);
    return {
      name,
      topic,
      payload: { username },
    };
  }

  if (POINT_AWARD_EVENT_SET.has(name)) {
    const payload = { ...decodePointAwardEventPayload(bytes), pointDelta: 1 as const };
    return {
      name,
      topic,
      payload,
      primaryDomain: payload.domain,
      primaryAccount: payload.recipient,
      pointDelta: 1,
    };
  }

  if (name === "ModPointAwarded") {
    const payload = { ...decodeModPointEventPayload(bytes), pointDelta: 1 as const };
    return {
      name,
      topic,
      payload,
      primaryDomain: payload.sourceDomain,
      primaryAccount: payload.recipient,
      pointDelta: 1,
    };
  }

  if (name === "UsernameBonusAwarded") {
    // Wire format matches PointAwardEvent (Address + String); rename `domain`
    // to `username` at the boundary.
    const { recipient, domain: username } = decodePointAwardEventPayload(bytes);
    const payload: UsernameBonusEventPayload & { pointDelta: 1 } = {
      recipient,
      username,
      pointDelta: 1,
    };
    return {
      name,
      topic,
      payload,
      primaryAccount: recipient,
      pointDelta: 1,
    };
  }

  const starPayload = decodeStarPointEventPayload(bytes);
  const pointDelta: 1 | -1 = name === "StarPointRefunded" ? -1 : 1;
  const payload = { ...starPayload, pointDelta };
  return {
    name,
    topic,
    payload,
    primaryDomain: payload.domain,
    primaryAccount: payload.recipient,
    pointDelta,
  };
}

export function decodeRegistryEventFromTopic(
  topicHex: string,
  bytes: Uint8Array,
): DecodedRegistryEvent | null {
  const name = registryEventNameForTopic(topicHex);
  return name ? decodeRegistryEventData(name, bytes) : null;
}
