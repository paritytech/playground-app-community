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

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { Link, Routes, Route, useParams } from "react-router-dom";
import * as Sentry from "@sentry/react";
import { calculateCid } from "@parity/product-sdk-cloud-storage";
import {
  placeholderFor,
  runTx,
  useSignerState,
  registryReady,
  getBulletinClient,
  ensureSignerReady,
  useIconUrl,
  useRegistryUsername,
  resolveProfileIdentifier,
  displayNameForAccount,
  isH160Address,
  stringify,
  type SignerState,
} from "./utils";
import { handleExternalClick } from "./utils/externalNavigation.ts";
import SetUsernameModal from "./SetUsernameModal.tsx";
import { ExternalLink, Shuffle, Share2 } from "lucide-react";
import { CLI_COMMAND, INSTALL_CMD, PLAYGROUND_URL } from "./config.ts";
import { StarIcon, PinIcon, CopyIcon, CheckIcon } from "./icons.tsx";
import ModPopup from "./ModPopup.tsx";
import GrainCanvas from "./GrainCanvas.tsx";
import AppDetailPanel from "./AppDetailPanel.tsx";
import Leaderboard from "./Leaderboard.tsx";
import PointsBreakdown from "./PointsBreakdown.tsx";
import SectionBoundary from "./SectionBoundary.tsx";
import ErrorBanner from "./ErrorBanner.tsx";
import LeftRail from "./LeftRail.tsx";
import PlaygroundTab from "./PlaygroundTab.tsx";
import AboutTab from "./AboutTab.tsx";
import AppsTab from "./AppsTab.tsx";
import ProfileTab from "./ProfileTab.tsx";
import EventStream from "./utils/event-stream/EventStream.tsx";
import {
  journeyTracker,
  SpanOp,
  addUiBreadcrumb,
  addUserActionBreadcrumb,
  addAdminActionBreadcrumb,
  isSigningRejection,
} from "./lib/telemetry";
import {
  handleRegistryEvent,
  upsertEntry,
  removeEntry,
} from "./registryEventReducer";
import {
  runPublishFlow,
  type PublishStatus,
} from "./publishFlow";
import { runVisibilityToggle } from "./visibilityToggle";
import {
  playgroundEventStream,
  isRegistryEventStreamItem,
} from "./utils/event-stream/index.ts";

const PAGE = 12;
const PAGE_LOAD_WATCHDOG_MS = 8000;
export const TAGS = ["social", "chat", "defi", "utility", "gaming", "marketplace", "irl"] as const;

// Render-time fix for legacy mis-spelled metadata.tag values published before the moddable rename.
const TAG_SPELLING_FIXES: Record<string, string> = {
  modable: "moddable",
};
const displayTag = (tag?: string): string | undefined =>
  tag ? TAG_SPELLING_FIXES[tag] ?? tag : undefined;

const ZERO_H160 = `0x${"0".repeat(40)}`;

/**
 * Normalise an H160 returned from the registry into either an undefined
 * (entry has no recorded value) or a lowercase 0x-prefixed string. The
 * contract uses `unwrap_or_default()` for missing-info fallbacks so the
 * zero address surfaces as a placeholder, not a real owner.
 */
const normalizeAddress = (raw: unknown): string | undefined => {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).toLowerCase();
  return s === ZERO_H160 ? undefined : s;
};

// Dedupes concurrent fetches for the same CID/domain. Resolved values are
// cached in detailsRef by callers; these maps only guard against parallel
// requests racing before any of them populate that cache.
const _metadataInFlight = new Map<string, Promise<AppMetadata | null>>();
function fetchMetadata(cid: string): Promise<AppMetadata | null> {
  const existing = _metadataInFlight.get(cid);
  if (existing) return existing;
  const p = (async (): Promise<AppMetadata | null> => {
    try {
      const client = await getBulletinClient();
      return await client.fetchJson<AppMetadata>(cid);
    } catch {
      // Outside the Polkadot host, fetchJson throws CloudStorageHostUnavailableError.
      // See "Container-only delivery" in CLAUDE.md.
      return null;
    }
  })().finally(() => _metadataInFlight.delete(cid));
  _metadataInFlight.set(cid, p);
  return p;
}

/**
 * Read star + mod counts for a domain from the registry contract.
 * Returns null on read failure so callers can keep cached values.
 *
 * Replaces the prior `@mock/reputation`-backed avg/count metric — the
 * star button is now a binary toggle, so a cumulative count is the only
 * signal we surface.
 */
const _socialInFlight = new Map<string, Promise<{ starCount: number; modCount: number } | null>>();
function fetchAppSocialCounts(domain: string): Promise<{ starCount: number; modCount: number } | null> {
  const existing = _socialInFlight.get(domain);
  if (existing) return existing;
  const p = (async () => {
    try {
      const registry = await registryReady;
      const [starRes, modRes] = await Promise.all([
        registry.getStarCount.query(domain),
        registry.getModCount.query(domain),
      ]);
      if (!starRes.success || !modRes.success) {
        console.warn(
          `[playground] registry.getStarCount/getModCount(${domain}) returned success:false — ${stringify({ starRes, modRes })}`,
        );
        return null;
      }
      return { starCount: Number(starRes.value), modCount: Number(modRes.value) };
    } catch (cause) {
      console.warn(
        `[playground] registry.getStarCount/getModCount(${domain}) threw — ${stringify(cause)}`,
      );
      return null;
    } finally {
      _socialInFlight.delete(domain);
    }
  })();
  _socialInFlight.set(domain, p);
  return p;
}

// Query param (not hash) because some chat/share unfurlers strip fragments,
// which would break the post-deploy "Share your app" CTA.
function getAppFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("app");
}

// replaceState (not pushState) — Polkadot Desktop's shell intercepts the
// back button at the chrome level; it never reaches the iframe, so we can't
// hook back-closes-panel via popstate. Pushing history entries we can't pop
// is worse than not pushing at all. The URL still reflects the open panel
// for sharing; close is via the X button.
function setAppInUrl(domain: string | null) {
  const url = new URL(window.location.href);
  if (domain) url.searchParams.set("app", domain);
  else url.searchParams.delete("app");
  window.history.replaceState({}, "", url.toString());
}

// Build a shareable URL for an app. Always uses the canonical public host
// (PLAYGROUND_URL) so a link copied from inside Polkadot Desktop, from a
// localhost dev session, or from a PR-preview .dot.li gateway still resolves
// when pasted into any web2 chat client. Lands on /apps so closing the detail
// panel leaves the visitor on the grid (not the Playground homepage).
export function buildAppShareUrl(domain: string): string {
  const url = new URL("/apps", PLAYGROUND_URL);
  url.searchParams.set("app", domain);
  return url.toString();
}

/// Look up a single app's data by domain. The returned entry has no `index`
/// set — callers that need the slot index must supply it from a paginated
/// query result.
async function fetchAppEntry(domain: string): Promise<AppEntry | null> {
  const registry = await registryReady;
  const mRes = await registry.getMetadataUri.query(domain);
  if (!mRes.success || !mRes.value?.isSome) return null;
  const oRes = await registry.getOwner.query(domain);
  const vRes = await registry.getVisibility.query(domain);
  return {
    domain,
    metadataUri: mRes.value.value,
    owner: oRes.success ? String(oRes.value) : undefined,
    visibility: vRes.success ? Number(vRes.value) : VISIBILITY_PUBLIC,
  };
}

async function checkIsAdmin(address: string): Promise<boolean> {
  try {
    const registry = await registryReady;
    const res = await registry.isAdmin.query(address);
    return res.success && res.value === true;
  } catch {
    return false;
  }
}

async function fetchHasStarred(domain: string, voter: string): Promise<boolean> {
  try {
    const registry = await registryReady;
    const res = await registry.hasStarred.query(voter as `0x${string}`, domain);
    if (!res.success) {
      console.warn(
        `[playground] registry.hasStarred(${domain}, ${voter}) returned success:false — ${stringify(res)}`,
      );
      return false;
    }
    return res.value;
  } catch (cause) {
    console.warn(
      `[playground] registry.hasStarred(${domain}, ${voter}) threw — ${stringify(cause)}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppMetadata {
  name?: string;
  description?: string;
  repository?: string;
  icon_cid?: string;
  // 2:1 hero cover image, owner-editable from the App Detail Page. Falls back
  // to icon_cid when unset so apps that never set a cover keep their current
  // detail-page hero.
  cover_cid?: string;
  tag?: string;
  readme?: string;
  moddedFrom?: string;
}

export const VISIBILITY_PRIVATE = 0;
export { VISIBILITY_PUBLIC, type AppEntry } from "./registryTypes";
import { VISIBILITY_PUBLIC, type AppEntry } from "./registryTypes";

export interface AppDetails {
  metadata?: AppMetadata;
  /** Cumulative stars given to this app (decremented on unstar). */
  starCount?: number;
  /** Whether the current viewer has currently starred this app. */
  hasStarred?: boolean;
  /** Number of unique modders who have published a mod of this app. */
  modCount?: number;
}

/// Apps-grid sort key. `newest` paginates `registry.getApps` (reverse-index
/// order, the legacy default); `stars` / `mods` paginate `getTopStarred` /
/// `getTopModded`, each backed by an on-chain OrderedIndex maintained by the
/// star/unstar/mod-credit paths. Lazy-backfill caveat applies: v13 indexes
/// start empty and only contain domains touched since the redeploy.
export type AppsSort = "newest" | "stars" | "mods";

/// Maps each sort key to the registry method that returns its page.
const METHOD_BY_SORT: Record<AppsSort, "getApps" | "getTopStarred" | "getTopModded"> = {
  newest: "getApps",
  stars: "getTopStarred",
  mods: "getTopModded",
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [entries, setEntries] = useState<AppEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  // Apps-grid sort. Lives in App.tsx (not AppsTab) because it changes the
  // backing read call: paginated `getApps` for newest, `getTopStarred` /
  // `getTopModded` for the on-chain sorted indexes. `fetchPage` reads
  // `sortByRef` so existing callbacks (loadMore, retryLoad) don't churn deps.
  const [sortBy, setSortBy] = useState<AppsSort>("newest");
  const sortByRef = useRef<AppsSort>("newest");
  const signer = useSignerState();

  // Reads use the dedicated dry-run origin (no signerManager on the
  // ContractManager), so the grid loads without a signer prompt. `runTx`
  // calls `ensureSignerReady` lazily before each write, which is when the
  // host prompts the user to connect + grant the SmartContractAllowance.
  const [detailEntry, setModEntry] = useState<AppEntry | null>(null);
  const [myAppsRefresh, setMyAppsRefresh] = useState(0);
  // Bumped on every point-award event (see the dispatcher's refreshLeaderboard
  // below) so the Playground island's live XP total re-fetches without polling.
  const [pointsRefresh, setPointsRefresh] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pinnedEntries, setPinnedEntries] = useState<AppEntry[]>([]);
  const [pinnedDomains, setPinnedDomains] = useState<Set<string>>(new Set());

  const loadedRef = useRef(0);
  const totalRef = useRef(-1);
  const busyRef = useRef(false);
  // Mirror the current user's address into a ref so the event subscription
  // (set up once on mount) can read the latest value without re-subscribing.
  const currentUserRef = useRef<string | undefined>(signer.selectedAccount?.h160Address);
  useEffect(() => {
    currentUserRef.current = signer.selectedAccount?.h160Address;
  }, [signer.selectedAccount?.h160Address]);

  // Feat dropped the per-account myRating prefetch in favour of `hasStarred`,
  // which is fetched lazily by AppDetailPanel via `fetchHasStarred` when the
  // detail panel mounts (no bulk grid-side prefetch). Account-switch state
  // wipe is now handled per-domain by the same component.
  const prefetchRef = useRef<Promise<{ entries: AppEntry[]; scanned: number }> | null>(null);
  const detailsRef = useRef<Map<string, AppDetails>>(new Map());
  // Wired by the Leaderboard component on mount — calling this triggers a
  // re-fetch of get_top_builders. Stays as undefined when the leaderboard
  // surface isn't mounted, so the registry-event dispatch is a no-op then.
  const leaderboardVersionRef = useRef<(() => void) | undefined>(undefined);
  const [detailsVersion, setDetailsVersion] = useState(0);
  // Coalesce detailsRef mutations into one render per animation frame: many
  // metadata/metrics fetches can resolve close together, but we only need to
  // re-render at most once per frame.
  const flushScheduled = useRef(false);
  const scheduleDetailsFlush = useCallback(() => {
    if (flushScheduled.current) return;
    flushScheduled.current = true;
    requestAnimationFrame(() => {
      flushScheduled.current = false;
      setDetailsVersion(v => v + 1);
      if (journeyTracker.isActive("page-load")) {
        journeyTracker.milestone("page-load", "metadata-rendered");
        journeyTracker.complete("page-load");
      }
    });
  }, []);

  // Fetch a page and return parsed entries + scanned slot count for correct
  // offset advancement. Branches on the current sort (read from a ref so the
  // callback identity stays stable across sort changes — pagination state is
  // reset by an effect, not by fetchPage's identity).
  const fetchPage = useCallback(async (offset: number): Promise<{ entries: AppEntry[]; scanned: number }> => {
    const sort = sortByRef.current;
    const method = METHOD_BY_SORT[sort];
    const spanName = `registry.${method}`;
    return Sentry.startSpan(
      { name: spanName, op: SpanOp.CHAIN_QUERY, attributes: { offset, page_size: PAGE, sort } },
      async (span) => {
        const registry = await registryReady;
        const r = await (registry as any)[method].query(offset, PAGE);
        if (!r.success) {
          // `r.value` carries the raw dispatch-error payload (e.g.
          // `{ type: "AccountNotMapped" }`, `{ type: "ContractReverted" }`,
          // `{ type: "Module", value: ... }`). The tag is a useful hint in
          // the banner; the full payload goes to the console + Sentry.
          const detail = r.value as { type?: string } | undefined;
          const tag = typeof detail?.type === "string" ? detail.type : null;
          console.error(
            `[playground] ${spanName}(${offset}, ${PAGE}) returned success=false: ${stringify(r)}`,
          );
          span.setStatus({ code: 2, message: tag ? `query-failed:${tag}` : "query-not-success" });
          throw new Error(
            tag
              ? `Couldn't reach the registry contract (${tag}). Please try again.`
              : "Couldn't reach the registry contract. Please try again.",
          );
        }
        if (r.value == null || typeof r.value !== "object" || !("total" in r.value)) {
          // eth_call returned ok with empty bytes (or a non-struct shape) —
          // typical when the registry contract isn't deployed at the resolved
          // address (e.g. cdm.json points at a chain that hasn't been
          // redeployed to). Surface a clearer error than the downstream
          // `Cannot read 'total' of undefined`.
          span.setStatus({ code: 2, message: "registry-empty-response" });
          throw new Error(
            `Registry contract returned an unexpected response (success=${r.success}, valueType=${typeof r.value}). The contract is likely not deployed at the resolved address on the current chain — redeploy contracts and re-run \`cdm install\`, or update cdm.json.`,
          );
        }
        const total = r.value.total;
        if (totalRef.current === -1) totalRef.current = total;
        const entries = (r.value.entries ?? []).map((e: any) => ({
          index: e.index,
          domain: e.domain,
          metadataUri: e.metadata_uri,
          owner: String(e.owner),
          visibility: e.visibility,
          publisher: normalizeAddress(e.publisher),
        }));
        return { entries, scanned: Number(r.value.scanned ?? entries.length) };
      },
    );
  }, []);

  // Backfill metadata + ratings into detailsRef map. Each fetch updates the
  // map and schedules a render flush as soon as it resolves, so fast fetches
  // appear without waiting for the slowest one.
  const backfillDetails = useCallback((batch: AppEntry[]) => {
    const map = detailsRef.current;

    batch
      .filter(entry => entry.metadataUri && !map.get(entry.domain)?.metadata)
      .forEach(entry => {
        fetchMetadata(entry.metadataUri!).then(metadata => {
          if (!metadata) return;
          map.set(entry.domain, { ...map.get(entry.domain), metadata });
          scheduleDetailsFlush();
        });
      });

    batch
      .filter(entry => map.get(entry.domain)?.starCount === undefined)
      .forEach(entry => {
        fetchAppSocialCounts(entry.domain).then(counts => {
          if (!counts) return;
          map.set(entry.domain, {
            ...map.get(entry.domain),
            starCount: counts.starCount,
            modCount: counts.modCount,
          });
          scheduleDetailsFlush();
        });
      });

    // myRating prefetch removed with the rating-system drop; AppDetailPanel
    // fetches `hasStarred` lazily for the single open entry instead.
  }, [scheduleDetailsFlush]);

  const loadMore = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = loadedRef.current;

      // Use prefetched page if available, otherwise fetch now
      const page = prefetchRef.current
        ? await prefetchRef.current
        : await fetchPage(loaded);
      prefetchRef.current = null;

        if (page.entries.length === 0) { setHasMore(false); return; }

      loadedRef.current = loaded + page.scanned;
      const total = totalRef.current;
      setEntries(prev => [...prev, ...page.entries]);
      setHasMore(loaded + page.scanned < total);

      if (loaded === 0) {
        journeyTracker.milestone("page-load", "first-page-loaded");
        journeyTracker.addAttributes("page-load", {
          "page_load.entry_count": page.entries.length,
          "page_load.total_apps": total,
        });
        if (page.entries.length === 0) {
          // No apps to backfill — close the journey now.
          journeyTracker.complete("page-load");
        } else {
          // Watchdog: closes the journey if every metadata fetch stalls (e.g. IPFS down).
          setTimeout(() => {
            if (journeyTracker.isActive("page-load")) {
              journeyTracker.addAttributes("page-load", { "page_load.metadata_stalled": true });
              journeyTracker.complete("page-load");
            }
          }, PAGE_LOAD_WATCHDOG_MS);
        }
      }

      backfillDetails(page.entries);

      // Prefetch the next page in the background
      const nextOffset = loaded + page.scanned;
      if (nextOffset < total) {
        prefetchRef.current = fetchPage(nextOffset).catch(() => ({ entries: [], scanned: 0 }));
      }
    } catch (err) {
      console.error("Load error:", err);
      setHasMore(false);
      setLoadError(err instanceof Error ? err.message : String(err));
      if (journeyTracker.isActive("page-load")) {
        journeyTracker.fail("page-load", "load-page-failed", err);
      }
      Sentry.captureException(err, { tags: { phase: "load-more" } });
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [fetchPage, backfillDetails]);

  const removeDomain = useCallback((domain: string) => {
    setEntries(prev => removeEntry(prev, domain));
    setPinnedEntries(prev => removeEntry(prev, domain));
    setPinnedDomains(prev => { const next = new Set(prev); next.delete(domain); return next; });
  }, []);

  const refreshSocialCounts = useCallback((domain: string) => {
    fetchAppSocialCounts(domain).then(counts => {
      const map = detailsRef.current;
      const prev = map.get(domain);
      if (counts) {
        map.set(domain, { ...prev, starCount: counts.starCount, modCount: counts.modCount });
      } else if (prev) {
        map.set(domain, { ...prev, starCount: undefined, modCount: undefined });
      }
      setDetailsVersion(v => v + 1);
    });
    // Per-account refresh removed with the rating-system drop. The
    // hasStarred flag is owned by AppDetailPanel and refreshed on its own
    // mount cycle.
  }, []);

  const handleSelectEntry = useCallback((entry: AppEntry) => {
    addUiBreadcrumb("Open app detail", { domain: entry.domain });
    setAppInUrl(entry.domain);
    setModEntry(entry);
  }, []);
  const handleSelectByDomain = useCallback(async (domain: string): Promise<boolean> => {
    const entry = await fetchAppEntry(domain);
    if (!entry) return false;
    backfillDetails([entry]);
    handleSelectEntry(entry);
    return true;
  }, [backfillDetails, handleSelectEntry]);
  const handleCloseDetail = useCallback(() => {
    setModEntry(null);
    setAppInUrl(null);
  }, []);

  // Close the detail pane on Escape. Listener is only attached while the
  // pane is open, so it doesn't compete with other Escape handlers (modals,
  // browser controls) when nothing is open.
  useEffect(() => {
    if (!detailEntry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailEntry, handleCloseDetail]);

  // Initial deep link: open the panel for ?app=<domain> on first mount.
  const initialDeepLinkRef = useRef(false);
  useEffect(() => {
    if (initialDeepLinkRef.current) return;
    initialDeepLinkRef.current = true;
    const domain = getAppFromUrl();
    if (!domain) return;
    fetchAppEntry(domain).then(entry => {
      if (!entry) return;
      if (getAppFromUrl() !== domain) return;
      backfillDetails([entry]);
      setModEntry(entry);
    });
  }, [backfillDetails]);

  // best-block waitFor for the interactive star toggle: the count refreshes
  // the moment the tx is included, without the finalization wait. Self-
  // corrects on revert via the post-tx refreshSocialCounts re-read.
  const handleStar = useCallback(async (domain: string) => {
    const registry = await registryReady;
    await runTx(
      "star",
      (opts) => registry.star.tx(domain, opts),
      { domain },
      { waitFor: "best-block" },
    );
    refreshSocialCounts(domain);
  }, [refreshSocialCounts]);

  const handleUnstar = useCallback(async (domain: string) => {
    const registry = await registryReady;
    await runTx(
      "unstar",
      (opts) => registry.unstar.tx(domain, opts),
      { domain },
      { waitFor: "best-block" },
    );
    refreshSocialCounts(domain);
  }, [refreshSocialCounts]);

  // Wraps the v_new binary-star contract methods so AppCard / AppsTab can
  // keep their pre-merge `onToggleFav(domain, makeFav)` shape. The old
  // 0-255 rating route + handleRate / handleRemoveRating were dropped on
  // the feat branch; this adapter routes through the equivalent
  // star/unstar handlers without forcing every call site to be touched.
  //
  // AppCard's onClick has no surrounding catch; swallow here to suppress
  // `onunhandledrejection`. `runTx` already logs the failure to the console.
  const handleToggleFav = useCallback(async (domain: string, makeFav: boolean) => {
    try {
      if (makeFav) await handleStar(domain);
      else await handleUnstar(domain);
    } catch {
      // intentionally empty
    }
  }, [handleStar, handleUnstar]);

  const handleSetVisibility = useCallback(async (domain: string, vis: number) => {
    // setVisibility gates on `is_authorized(caller())` (owner OR sudo/admin).
    // See handleTogglePin for the dry-run-origin rationale.
    const origin = signer.selectedAccount?.address;
    return runVisibilityToggle(
      domain,
      vis,
      {
        setVisibility: async (d, v) => {
          const registry = await registryReady;
          return runTx(
            "setVisibility",
            (opts) => registry.setVisibility.tx(d, v, { ...opts, origin }) as Promise<{ ok: boolean }>,
            { domain: d, visibility: v },
          );
        },
        fetchEntry: fetchAppEntry,
      },
      {
        breadcrumb: (opts) => addUserActionBreadcrumb("Toggle visibility", opts),
        removeDomain,
        prependEntry: (entry) =>
          setEntries((prev) => [entry, ...removeEntry(prev, entry.domain)]),
        backfillDetails,
        patchModEntry: (d, v) =>
          setModEntry((prev) =>
            prev && prev.domain === d ? { ...prev, visibility: v } : prev,
          ),
        isSigningRejection,
        captureException: (err, tags) => Sentry.captureException(err, { tags }),
      },
    );
  }, [removeDomain, backfillDetails, signer.selectedAccount?.address]);

  const handleDelete = useCallback(async (domain: string) => {
    addUserActionBreadcrumb("Delete app", { domain });
    try {
      const registry = await registryReady;
      // unpublish gates on `is_authorized(caller())` (owner OR sudo/admin).
      // See handleTogglePin for the dry-run-origin rationale.
      const origin = signer.selectedAccount?.address;
      await runTx(
        "unpublish",
        (opts) => registry.unpublish.tx(domain, { ...opts, origin }),
        { domain },
      );
      removeDomain(domain);
      setModEntry(null);
      setMyAppsRefresh(k => k + 1);
    } catch (err) {
      if (isSigningRejection(err)) return;
      Sentry.captureException(err, { tags: { action: "delete", domain } });
      throw err;
    }
  }, [removeDomain, signer.selectedAccount?.address]);

  // Upload a new cover image and re-publish the app's metadata pointing at it.
  // Re-publish preserves owner + publisher on the contract (only visibility
  // and metadata_uri are mutable after first publish), so passing the current
  // visibility keeps the rest of the entry intact.
  const handleUpdateCoverImage = useCallback(async (domain: string, bytes: Uint8Array) => {
    addUserActionBreadcrumb("Edit cover image", { domain });
    // Connect + request the bundled SmartContract / BulletIn / AutoSigning
    // allowances up front. The Bulletin uploads below otherwise trip the
    // host's "message too big" IPC error when BulletInAllowance is missing.
    // `runTx` further down also calls `ensureSignerReady` but it's
    // idempotent and the permissions are cached after the first grant.
    console.log("[cover-editor] ensuring product permissions");
    await ensureSignerReady();
    const registry = await registryReady;

    // Read the existing metadata so we preserve every other field — the
    // editor only mutates `cover_cid`. The detailsRef cache has it for any
    // currently-visible app; falling back to a fresh fetch keeps the path
    // correct if it isn't cached yet.
    let metadata: AppMetadata = detailsRef.current.get(domain)?.metadata ?? {};
    if (!metadata.name) {
      const entry = await fetchAppEntry(domain);
      if (entry?.metadataUri) {
        metadata = (await fetchMetadata(entry.metadataUri)) ?? metadata;
      }
    }

    const coverCidObj = await calculateCid(bytes);
    const coverCid = coverCidObj.toString();
    const nextMetadata: AppMetadata = { ...metadata, cover_cid: coverCid };
    const metadataBytes = new TextEncoder().encode(JSON.stringify(nextMetadata));
    const metadataCidObj = await calculateCid(metadataBytes);
    const metadataCid = metadataCidObj.toString();

    // Upload the cover bytes then the metadata blob. Sequential so the
    // metadata it points to is durably stored before we publish a CID that
    // references it.
    console.log(
      `[cover-editor] bulletin upload sizes — cover: ${bytes.byteLength} bytes (${(bytes.byteLength / 1024).toFixed(1)} KB), metadata: ${metadataBytes.byteLength} bytes (${(metadataBytes.byteLength / 1024).toFixed(1)} KB)`,
    );
    const bulletin = await getBulletinClient();
    await Sentry.startSpan(
      { name: "bulletin.upload", op: SpanOp.BULLETIN_UPLOAD, attributes: { item_count: 2 } },
      async () => {
        await bulletin.store(bytes).send();
        await bulletin.store(metadataBytes).send();
      },
    );
    console.log("[cover-editor] registry.publish — submitting");

    // Re-publish: owner = None (defaults to caller; ignored on re-publish),
    // modded_from = "" (re-publish ignores it), is_moddable preserves the
    // repository signal, is_dev_signer = false (always false in the UI path).
    const currentEntry = detailEntry?.domain === domain
      ? detailEntry
      : entries.find(e => e.domain === domain)
        ?? pinnedEntries.find(e => e.domain === domain);
    const visibility = currentEntry?.visibility ?? VISIBILITY_PUBLIC;
    const isModdable = !!nextMetadata.repository?.trim();
    await runTx(
      "publish",
      (opts) =>
        registry.publish.tx(
          domain,
          metadataCid,
          visibility,
          { isSome: false, value: "0x0000000000000000000000000000000000000000" as const },
          "",
          isModdable,
          false,
          opts,
        ) as Promise<{ ok: boolean }>,
      { domain, action: "edit-cover" },
    );

    // Patch the cached metadata so the detail panel re-renders with the new
    // cover immediately, without waiting for the chain event round-trip.
    const prev = detailsRef.current.get(domain) ?? {};
    detailsRef.current.set(domain, { ...prev, metadata: nextMetadata });
    setDetailsVersion(v => v + 1);
    // Mirror the new metadataUri onto the entry list / detail entry so a page
    // refresh keeps showing the new cover.
    setEntries(prev =>
      prev.map(e => (e.domain === domain ? { ...e, metadataUri: metadataCid } : e)),
    );
    setModEntry(prev =>
      prev && prev.domain === domain ? { ...prev, metadataUri: metadataCid } : prev,
    );
  }, [detailEntry, entries, pinnedEntries]);

  const fetchPinnedApps = useCallback(async () => {
    try {
      const registry = await registryReady;
      const r = await registry.getPinnedApps.query();
      if (!r.success) return;
      const apps: AppEntry[] = (r.value ?? []).map((e: any) => ({
        index: e.index,
        domain: e.domain,
        metadataUri: e.metadata_uri,
        owner: String(e.owner),
        pinned: true,
        visibility: e.visibility,
        publisher: normalizeAddress(e.publisher),
      }));
      setPinnedEntries(apps);
      setPinnedDomains(new Set(apps.map(a => a.domain)));
      backfillDetails(apps);
    } catch (err) {
      console.error("Failed to fetch pinned apps:", err);
    }
  }, [backfillDetails]);

  const handleTogglePin = useCallback(async (domain: string, pin: boolean) => {
    addAdminActionBreadcrumb(pin ? "Pin app" : "Unpin app", { domain });
    try {
      const registry = await registryReady;
      // pin/unpin gate on `is_sudo_or_admin(caller())` — and the SDK's dry-run
      // origin otherwise defaults to `defaultOrigin` (the //playground-querier
      // read origin set in contracts.ts) because no `signerManager` is wired
      // into ContractManager. Without this explicit override the dry-run runs
      // as the querier, fails the admin check, and the tx is never submitted
      // even though the signed caller IS in the admin set. Pass the connected
      // SS58 so the dry-run runs as the real caller.
      const origin = signer.selectedAccount?.address;
      await runTx(
        pin ? "pin" : "unpin",
        (opts) => (pin
          ? registry.pin.tx(domain, { ...opts, origin })
          : registry.unpin.tx(domain, { ...opts, origin })),
        { domain },
      );
      await fetchPinnedApps();
    } catch (err) {
      if (isSigningRejection(err)) return;
      Sentry.captureException(err, { tags: { action: pin ? "pin" : "unpin", domain } });
      throw err;
    }
  }, [fetchPinnedApps, signer.selectedAccount?.address]);

  // Pinned apps are global — fetch once on mount.
  useEffect(() => { fetchPinnedApps(); }, [fetchPinnedApps]);

  // Load apps and check admin status. Re-runs when account changes so
  // get_apps uses the new caller (shows owner's private apps).
  const accountRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const addr = signer.selectedAccount?.h160Address;

    // Check admin status
    if (!addr) { setIsAdmin(false); } else {
      checkIsAdmin(addr).then(setIsAdmin);
    }

    // On account change (not initial mount), reset before refetching
    if (accountRef.current !== undefined && accountRef.current !== addr) {
      loadedRef.current = 0;
      totalRef.current = -1;
      prefetchRef.current = null;
      busyRef.current = false;
      setEntries([]);
      setHasMore(true);
    }
    accountRef.current = addr;

    loadMore();
  }, [signer.selectedAccount?.h160Address, loadMore]);

  // Subscribe to contract events for live updates
  useEffect(() => {
    return playgroundEventStream.subscribeItems((item) => {
      if (!isRegistryEventStreamItem(item) || !item.payload) return;
      const event = item.payload;
      handleRegistryEvent(event.name, event.primaryDomain ?? "", {
        fetchEntry: fetchAppEntry,
        applyDecision: (entry, decision) => {
          if (decision === "remove") {
            removeDomain(entry.domain);
          } else if (sortByRef.current === "newest") {
            setEntries((prev) => upsertEntry(prev, entry));
          }
          // For sorted views (stars/mods) a fresh publish has count 0 and
          // isn't in the on-chain index. The user gets it on next sort
          // switch or scroll-refresh; injecting at index 0 would mis-rank it.
        },
        removeDomain,
        fetchPinnedApps,
        backfillDetails,
        getCurrentUserAddr: () => currentUserRef.current,
        refreshSocialCounts,
        refreshLeaderboard: () => {
          leaderboardVersionRef.current?.();
          setPointsRefresh((k) => k + 1);
        },
      });
    });
  }, [backfillDetails, fetchPinnedApps, removeDomain, refreshSocialCounts]);

  const retryLoad = useCallback(() => {
    loadedRef.current = 0;
    totalRef.current = -1;
    prefetchRef.current = null;
    busyRef.current = false;
    setEntries([]);
    setHasMore(true);
    loadMore();
  }, [loadMore]);

  // Sort-change reset: wipe pagination state (offset, total, prefetched
  // page, current entries) and trigger a fresh load against the new sort's
  // backing read method. Skips the initial mount (where the load is driven
  // by the account-change effect above). The ref mirror lets fetchPage
  // observe the chosen sort without re-creating loadMore.
  const handleSortChange = useCallback((next: AppsSort) => {
    if (sortByRef.current === next) return;
    sortByRef.current = next;
    setSortBy(next);
    loadedRef.current = 0;
    totalRef.current = -1;
    prefetchRef.current = null;
    busyRef.current = false;
    setEntries([]);
    setHasMore(true);
    setLoadError(null);
    loadMore();
  }, [loadMore]);

  return (
    <>
      <div className="grain-bg"><GrainCanvas /></div>
      <EventStream />
      <div className="app-shell">
        <LeftRail />
        <main className="app-main">
          <Routes>
            <Route
              path="/"
              element={
                <PlaygroundTab
                  account={signer.selectedAccount?.h160Address}
                  pointsRefresh={pointsRefresh}
                />
              }
            />
            <Route path="/about" element={<AboutTab />} />
            <Route
              path="/apps"
              element={
                <AppsTab
                  entries={entries}
                  pinnedEntries={pinnedEntries}
                  pinnedDomains={pinnedDomains}
                  loading={loading}
                  loadError={loadError}
                  hasMore={hasMore}
                  detailsRef={detailsRef}
                  detailsVersion={detailsVersion}
                  loadMore={loadMore}
                  handleSelectEntry={handleSelectEntry}
                  retryLoad={retryLoad}
                  reviewer={signer.selectedAccount?.h160Address}
                  onToggleFav={handleToggleFav}
                  sortBy={sortBy}
                  onSortChange={handleSortChange}
                />
              }
            />
            <Route
              path="/profile"
              element={
                <ProfileTab
                  signer={signer}
                  isAdmin={isAdmin}
                  onMod={handleSelectEntry}
                  refreshTrigger={myAppsRefresh}
                />
              }
            />
            <Route
              path="/profile/:profileId"
              element={
                <PublicProfilePage
                  signer={signer}
                  isAdmin={isAdmin}
                  onMod={handleSelectEntry}
                  refreshTrigger={myAppsRefresh}
                />
              }
            />
            <Route
              path="/leaderboard"
              element={
                <SectionBoundary name="leaderboard">
                  <Leaderboard
                    currentUserAddr={signer.selectedAccount?.h160Address}
                    registerRefresh={(refresh) => {
                      leaderboardVersionRef.current = refresh;
                    }}
                  />
                </SectionBoundary>
              }
            />
          </Routes>
        </main>
      </div>

      {detailEntry && (
        <SectionBoundary name="app-detail">
          <AppDetailPanel
            entry={detailEntry}
            details={detailsRef.current.get(detailEntry.domain)}
            signer={signer}
            isAdmin={isAdmin}
            isPinned={pinnedDomains.has(detailEntry.domain)}
            fetchHasStarred={fetchHasStarred}
            onClose={handleCloseDetail}
            onStar={handleStar}
            onUnstar={handleUnstar}
            onDelete={handleDelete}
            onTogglePin={handleTogglePin}
            onSetVisibility={handleSetVisibility}
            onSelectApp={handleSelectByDomain}
            onUpdateCoverImage={handleUpdateCoverImage}
          />
        </SectionBoundary>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------------

function PublicProfilePage({
  signer,
  onMod,
  refreshTrigger,
  isAdmin,
}: {
  signer: SignerState;
  onMod: (e: AppEntry) => void;
  refreshTrigger: number;
  isAdmin: boolean;
}) {
  const { profileId = "" } = useParams();
  const [resolution, setResolution] = useState<Awaited<ReturnType<typeof resolveProfileIdentifier>>>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setResolution(null);
    resolveProfileIdentifier(profileId).then((next) => {
      if (cancelled) return;
      setResolution(next);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  const { username } = useRegistryUsername(resolution?.address, refreshTrigger);

  if (loading) {
    return (
      <div className="tab-profile public-profile" data-testid="public-profile-page">
        <div className="public-profile-state" data-testid="public-profile-loading">
          Loading profile...
        </div>
      </div>
    );
  }

  if (!resolution) {
    const missingProfile = isH160Address(profileId)
      ? "that profile"
      : profileId
        ? `"${profileId}"`
        : "that profile";
    return (
      <div className="tab-profile public-profile" data-testid="public-profile-page">
        <section className="public-profile-state" data-testid="public-profile-not-found">
          <h1>Profile not found</h1>
          <p>No builder matches {missingProfile}.</p>
          <Link className="btn btn-ghost" to="/leaderboard">Leaderboard</Link>
        </section>
      </div>
    );
  }

  const displayName =
    username ??
    (resolution.lookup === "username"
      ? resolution.normalizedInput
      : displayNameForAccount(null, resolution.address));

  return (
    <div className="tab-profile public-profile" data-testid="public-profile-page">
      <section className="account-panel public-profile-panel" data-testid="public-profile-header">
        <div className="account-panel-row">
          <h1 className="account-panel-name" data-testid="public-profile-name">
            {displayName}
          </h1>
          <Link className="btn btn-ghost account-panel-action" to="/leaderboard">
            Leaderboard
          </Link>
        </div>
      </section>
      <MyApps
        signer={signer}
        onMod={onMod}
        refreshTrigger={refreshTrigger}
        isAdmin={isAdmin}
        ownerAddress={resolution.address}
        readOnly
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Apps
// ---------------------------------------------------------------------------

export function MyApps({
  signer,
  onMod,
  refreshTrigger,
  isAdmin,
  ownerAddress,
  readOnly,
}: {
  signer: SignerState;
  onMod: (e: AppEntry) => void;
  refreshTrigger: number;
  isAdmin: boolean;
  ownerAddress?: string;
  readOnly?: boolean;
}) {
  const [myEntries, setMyEntries] = useState<AppEntry[]>([]);
  const myDetailsRef = useRef<Map<string, AppDetails>>(new Map());
  const [loading, setLoading] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const account = signer.selectedAccount;
  const selfAddress = account?.h160Address;
  const targetAddress = ownerAddress ?? selfAddress;
  const isSelf = !ownerAddress;

  // Set/Change username flow.
  const [showSetUsername, setShowSetUsername] = useState(false);
  const [usernameRefreshTick, setUsernameRefreshTick] = useState(0);
  // Optimistically holds the just-claimed name until the chain read confirms.
  const [optimisticUsername, setOptimisticUsername] = useState<string | null>(null);
  const [usernameToast, setUsernameToast] = useState<string | null>(null);
  // Synchronous mutex so a fast double-click doesn't fire two parallel txs.
  const usernameInflightRef = useRef(false);

  const usernameReadRefresh = isSelf
    ? usernameRefreshTick + refreshTrigger
    : refreshTrigger;
  const { username: chainUsername } = useRegistryUsername(
    targetAddress as `0x${string}` | undefined,
    usernameReadRefresh,
  );

  // Retire optimistic only when the chain read confirms the same value;
  // a mismatch means the read is still stale, and snapping back to the
  // old name would flicker during a rapid rename.
  useEffect(() => {
    if (!optimisticUsername) return;
    if (chainUsername === undefined) return;
    if (chainUsername === optimisticUsername) {
      setOptimisticUsername(null);
    }
  }, [chainUsername, optimisticUsername]);

  useEffect(() => {
    if (!usernameToast) return;
    const id = setTimeout(() => setUsernameToast(null), 4000);
    return () => clearTimeout(id);
  }, [usernameToast]);

  const handleClaimUsername = useCallback((name: string) => {
    if (usernameInflightRef.current) return;
    usernameInflightRef.current = true;
    setOptimisticUsername(name);
    setUsernameToast(null);

    void (async () => {
      try {
        const registry = await registryReady;
        const res = await runTx(
          "setUsername",
          (opts) => registry.setUsername.tx(name, opts),
          { username: name },
          {
            waitFor: "best-block",
            // SDK estimator undershoots first-time storage inserts; pin to
            // avoid Revive.OutOfGas. See scripts/smoke-test-usernames.ts.
            gasLimit: { ref_time: 1_500_000_000_000n, proof_size: 2_000_000n },
            storageDepositLimit: 1_000_000_000_000n,
          },
        );
        if ((res as { ok?: boolean }).ok === false) {
          setOptimisticUsername(null);
          setUsernameToast("Couldn't save your username. Try again?");
          console.warn(`[playground] setUsername returned ok=false: ${stringify(res)}`);
          return;
        }
        setUsernameRefreshTick((k) => k + 1);
      } catch (cause) {
        if (isSigningRejection(cause)) {
          setOptimisticUsername(null);
        } else {
          setOptimisticUsername(null);
          setUsernameToast("Couldn't save your username. Try again?");
          console.warn(`[playground] setUsername threw: ${stringify(cause)}`);
        }
      } finally {
        usernameInflightRef.current = false;
      }
    })();
  }, []);

  const effectiveUsername = isSelf
    ? optimisticUsername ?? chainUsername ?? null
    : chainUsername ?? null;

  useEffect(() => {
    if (!targetAddress) {
      setMyEntries([]);
      myDetailsRef.current.clear();
      return;
    }
    myDetailsRef.current.clear();

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const registry = await registryReady;
        const countRes = await registry.getOwnerAppCount.query(targetAddress);
        const total = countRes.success ? Number(countRes.value) : 0;

        const batch: AppEntry[] = [];
        for (let i = total - 1; i >= 0; i--) {
          if (cancelled) break;
          const dRes = await registry.getOwnerDomainAt.query(targetAddress, i);
          if (!dRes.success || !dRes.value?.isSome) continue;
          const domain = dRes.value.value;

          const entry = await fetchAppEntry(domain);
          if (!entry) continue; // unpublished
          if (readOnly && (entry.visibility ?? VISIBILITY_PUBLIC) < VISIBILITY_PUBLIC) continue;
          batch.push({ ...entry, index: i, owner: targetAddress });
        }

        if (!cancelled) {
          await Promise.allSettled(batch.map(async entry => {
            if (!entry.metadataUri) return;
            const metadata = await fetchMetadata(entry.metadataUri);
            if (metadata) myDetailsRef.current.set(entry.domain, { metadata });
          }));
          setMyEntries(batch);
        }
      } catch (err) {
        console.error("MyApps load error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [targetAddress, refreshKey, refreshTrigger]);

  // Viewing own profile while not connected → connect prompt.
  if (isSelf && !targetAddress) {
    const connecting = signer.status === "connecting";
    return (
      <div className="my-apps-connect" data-testid="my-apps-connect-prompt">
        <h2>My Apps</h2>
        <p className="my-apps-sub">
          {connecting ? "Connecting..." : "Connect your account to see your published apps."}
        </p>
      </div>
    );
  }

  const title = isSelf ? "Hello," : "Apps";
  const displayName = displayNameForAccount(effectiveUsername, targetAddress);

  return (
    <div className="tab-center" data-testid="my-apps-view">
      <header className="tab-header tab-header--inline">
        <h1 className="tab-title">
          {title}{" "}
          <span className="tab-name" data-testid="my-apps-account">
            {displayName}
          </span>
        </h1>
        {isSelf && account && (
          <button
            className="btn btn-ghost"
            onClick={() => setShowSetUsername(true)}
            data-testid="set-username-btn"
          >
            {effectiveUsername ? "Change username" : "Set username"}
          </button>
        )}
      </header>

      {isSelf && isAdmin && !readOnly && (
        <button
          className="btn btn-publish"
          onClick={() => setShowPublish(true)}
          data-testid="publish-app-btn"
        >
          Publish App
        </button>
      )}

      {targetAddress && (
        <PointsBreakdown account={targetAddress} refreshKey={refreshKey + refreshTrigger} />
      )}

      {loading ? (
        <div className="spinner" data-testid="my-apps-loading">Loading apps...</div>
      ) : myEntries.length === 0 ? (
        <div className="empty" data-testid="my-apps-empty-state">
          No apps published yet.
        </div>
      ) : (
        <div className="grid" data-testid="my-apps-grid">
          {myEntries.map(entry => (
            <AppCard key={entry.domain} entry={entry} details={myDetailsRef.current.get(entry.domain)} onSelect={onMod} />
          ))}
        </div>
      )}

      {showPublish && isSelf && account && (
        <SectionBoundary name="publish-modal">
          <PublishModal
            onClose={() => setShowPublish(false)}
            onPublished={() => { setShowPublish(false); setRefreshKey(k => k + 1); }}
          />
        </SectionBoundary>
      )}

      {showSetUsername && isSelf && account && (
        <SetUsernameModal
          callerH160={account.h160Address as `0x${string}`}
          currentUsername={effectiveUsername}
          onConfirm={handleClaimUsername}
          onClose={() => setShowSetUsername(false)}
        />
      )}

      {usernameToast && (
        <div className="username-toast" role="status" data-testid="username-toast">
          {usernameToast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Publish modal
// ---------------------------------------------------------------------------

function PublishModal({ onClose, onPublished }: {
  onClose: () => void;
  onPublished: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repository, setRepository] = useState("");
  const [tag, setTag] = useState("");
  const [visibility, setVisibility] = useState(VISIBILITY_PUBLIC);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<PublishStatus>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  const pickIcon = (f: File | undefined) => {
    if (!f) return;
    setIconFile(f);
    setIconPreview(URL.createObjectURL(f));
    setError("");
  };

  // Parent might unmount the modal mid-flow (e.g. account change, navigation).
  useEffect(() => () => journeyTracker.abandon("publish"), []);

  const canSubmit = domain.trim() && name.trim() && status === "idle";

  const publish = async () => {
    setError("");
    // Read icon if provided — caller responsibility before runPublishFlow.
    let iconBytes: Uint8Array | null = null;
    if (iconFile) {
      setStatusMsg("Reading icon...");
      iconBytes = new Uint8Array(await iconFile.arrayBuffer());
    }

    const registry = await registryReady;
    const bulletin = await getBulletinClient();

    const outcome = await runPublishFlow(
      {
        domain,
        name,
        description,
        repository,
        tag,
        visibility,
        iconBytes,
      },
      {
        calculateCid,
        storeBytes: (bytes) => bulletin.store(bytes).send(),
        publishToRegistry: (d, cid, vis, moddedFrom, isModdable) =>
          runTx(
            "publish",
            // owner = None → contract defaults to env::caller() (the signed-in user).
            // The Option<Address> param exists for the CLI's dev-mode flow (Alice
            // signs the tx but the user's H160 is recorded as owner); the frontend
            // is always called by the actual user, so None is correct here.
            //
            // The frontend publish flow has no UI for "modded from" — that's a
            // CLI-side feature (`dot mod` captures the source domain in
            // `dot.json`). We always pass "" here. `isModdable` flips true
            // whenever the user provided a repository URL, mirroring how the
            // CLI derives it (a public GitHub URL is the moddable signal).
            //
            // `modded_from` is plain `string` on the contract, NOT
            // `Option<String>` — the latter's SolAbi layout is incompatible
            // with viem's tuple encoding (32-byte vs 64-byte head). Empty
            // string is the "no source" sentinel.
            (opts) =>
              registry.publish.tx(
                d,
                cid,
                vis,
                { isSome: false, value: "0x0000000000000000000000000000000000000000" as const },
                moddedFrom ?? "",
                isModdable,
                // is_dev_signer: the playground-app UI publish flow always
                // runs under the user's phone-mode session; never a dev/
                // --suri signer. The CLI passes true when appropriate.
                false,
                opts,
              ) as Promise<{ ok: boolean }>,
            { domain: d, modded_from: moddedFrom ?? "", is_moddable: isModdable },
          ),
        startBulletinSpan: (attrs, fn) =>
          Sentry.startSpan(
            {
              name: "bulletin.upload",
              op: SpanOp.BULLETIN_UPLOAD,
              attributes: { item_count: attrs.itemCount },
            },
            fn,
          ),
      },
      {
        status: setStatus,
        message: setStatusMsg,
        errorMessage: setError,
        start: (opts) =>
          journeyTracker.start("publish", {
            "publish.has_icon": opts.hasIcon,
            "publish.visibility": opts.visibility,
            "publish.has_tag": opts.hasTag,
          }),
        milestone: (name) => journeyTracker.milestone("publish", name),
        complete: () => journeyTracker.complete("publish"),
        fail: (reason, err) => {
          journeyTracker.fail("publish", reason, err);
          Sentry.captureException(err, {
            tags: { phase: "publish", failure_reason: reason },
          });
        },
      },
    );

    if (outcome.ok) {
      setTimeout(onPublished, 1200);
    }
  };

  const isWorking = status !== "idle" && status !== "done" && status !== "error";

  const handleClose = () => {
    if (isWorking) return;
    journeyTracker.abandon("publish");
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal publish-modal"
        onClick={e => e.stopPropagation()}
        data-testid="publish-modal"
        data-status={status}
      >
        <h2>Publish an App</h2>

        {(status === "idle" || status === "error") ? (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Domain</label>
                <div className="form-domain-wrap">
                  <input
                    className="form-input"
                    placeholder="my-app"
                    value={domain}
                    onChange={e => setDomain(e.target.value)}
                    data-testid="field-domain"
                  />
                  <span className="form-domain-suffix">.dot</span>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Tag</label>
                <select
                  className="form-input"
                  value={tag}
                  onChange={e => setTag(e.target.value)}
                  data-testid="field-tag"
                >
                  <option value="">None</option>
                  {TAGS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Visibility</label>
              <div className="visibility-toggle">
                <button
                  type="button"
                  className={`visibility-option${visibility === VISIBILITY_PUBLIC ? " active" : ""}`}
                  onClick={() => setVisibility(VISIBILITY_PUBLIC)}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={`visibility-option${visibility === VISIBILITY_PRIVATE ? " active" : ""}`}
                  onClick={() => setVisibility(VISIBILITY_PRIVATE)}
                >
                  Private
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                placeholder="My Cool App"
                value={name}
                onChange={e => setName(e.target.value)}
                data-testid="field-name"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input form-textarea"
                placeholder="A short description of your app..."
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                data-testid="field-description"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Repository URL</label>
              <input
                className="form-input"
                placeholder="https://github.com/..."
                value={repository}
                onChange={e => setRepository(e.target.value)}
                data-testid="field-repo-url"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Icon</label>
              <label className="form-icon-upload">
                {iconPreview
                  ? <img src={iconPreview} alt="" className="form-icon-preview" />
                  : <span className="form-icon-placeholder">Choose image</span>
                }
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={e => pickIcon(e.target.files?.[0])}
                  data-testid="field-icon"
                />
              </label>
            </div>

            {error && <ErrorBanner message={error} compact testid="publish-error" />}

            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={handleClose}
                data-testid="publish-cancel-btn"
              >Cancel</button>
              <button
                className="btn btn-publish"
                onClick={publish}
                disabled={!canSubmit}
                data-testid="publish-submit-btn"
              >
                Publish
              </button>
            </div>
          </>
        ) : (
          <div className="publish-progress">
            <p className="publish-status-msg" data-testid="publish-status-msg">{statusMsg}</p>
            {status === "done" && (
              <p className="publish-done" data-testid="publish-success">Published successfully!</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App card
// ---------------------------------------------------------------------------

type AppCardProps = {
  entry: AppEntry;
  details?: AppDetails;
  onSelect: (entry: AppEntry) => void;
  reviewer?: string;
  onToggleFav?: (domain: string, makeFav: boolean) => Promise<void>;
};

export const AppCard = memo(function AppCard({ entry, details, onSelect, reviewer, onToggleFav }: AppCardProps) {
  const name = details?.metadata?.name ?? entry.domain.replace(/\.dot$/, "");
  const desc = details?.metadata?.description ?? "Customise and deploy your own version.";
  const tag = displayTag(details?.metadata?.tag);
  const moddable = !!details?.metadata?.repository;
  const iconUrl = useIconUrl(details?.metadata?.icon_cid);
  const starCount = details?.starCount ?? 0;
  const modCount = details?.modCount ?? 0;
  const hasStarred = details?.hasStarred === true;

  const [modOpen, setModOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [favBusy, setFavBusy] = useState(false);
  const modAnchorRef = useRef<HTMLButtonElement | null>(null);

  // v_new is a binary star (no rating scale). `hasStarred` from the contract
  // controls which direction the toggle fires; `onToggleFav(domain, makeFav)`
  // in App.tsx adapts to handleStar / handleUnstar.
  const isFav = hasStarred;
  // The contract reverts SelfStarForbidden when an owner tries to star their
  // own app — disable the button so the click never reaches the chain.
  const isOwner = !!reviewer && !!entry.owner && entry.owner.toLowerCase() === reviewer.toLowerCase();
  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onToggleFav || !reviewer || favBusy || isOwner) return;
    setFavBusy(true);
    onToggleFav(entry.domain, !isFav).finally(() => setFavBusy(false));
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(buildAppShareUrl(entry.domain));
    addUserActionBreadcrumb("Share app", { domain: entry.domain });
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 1400);
  };

  const handleMod = (e: React.MouseEvent) => {
    e.stopPropagation();
    setModOpen(o => !o);
  };

  const slug = entry.domain.replace(/\.dot$/, "");
  const launchHref = `https://${slug}.dot.li`;

  const handleLaunch = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    addUserActionBreadcrumb("Launch app", { domain: entry.domain });
    handleExternalClick(e);
  };

  return (
    <article
      className="app-post"
      onClick={() => onSelect(entry)}
      data-testid="app-card"
      data-domain={entry.domain}
      data-metadata-loaded={details?.metadata ? "true" : "false"}
      data-tag={tag ?? ""}
      data-moddable={moddable ? "true" : "false"}
      data-pinned={entry.pinned ? "true" : "false"}
    >
      <header className="app-post-head">
        <h2 className="app-post-title" data-testid="card-name">
          {entry.pinned && (
            <span className="app-post-pin" aria-label="Pinned" title="Pinned">
              <PinIcon width="20" height="20" />
            </span>
          )}
          <span className="app-post-title-text">{name}</span>
        </h2>
        <a
          className="btn-primary"
          href={launchHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleLaunch}
          data-testid="app-post-launch"
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span>Launch</span>
        </a>
      </header>
      <p className="app-post-blurb" data-testid="card-desc">{desc}</p>
      <div className="app-post-tags">
        {tag && (
          <span className="filter-pill is-filled" data-tag={tag} data-testid="card-tag">{tag}</span>
        )}
        {moddable && (
          <span className="filter-pill is-filled" data-tag="moddable" data-testid="card-moddable-chip">Moddable</span>
        )}
        {entry.visibility === VISIBILITY_PRIVATE && (
          <span className="filter-pill is-filled" data-tag="private">Private</span>
        )}
        {modCount > 0 && (
          <span
            className="filter-pill is-filled"
            data-tag="modcount"
            data-testid="card-modcount"
            title={`${modCount} modder${modCount === 1 ? "" : "s"}`}
          >
            {modCount}× modded
          </span>
        )}
      </div>
      {iconUrl && (
        <div className="app-post-image">
          <img src={iconUrl} alt="" loading="lazy" />
        </div>
      )}
      <div className="app-post-bar">
        <span className="bar-btn-mod-wrap">
          <button
            ref={modAnchorRef}
            type="button"
            className={`bar-btn bar-btn-mod${modOpen ? " is-open" : ""}`}
            onClick={handleMod}
            data-testid="bar-btn-mod"
            aria-haspopup="dialog"
            aria-expanded={modOpen}
          >
            <Shuffle size={18} aria-hidden="true" />
            <span className="bar-label">Mod</span>
          </button>
          {modOpen && (
            <ModPopup
              domain={entry.domain}
              moddable={moddable}
              onClose={() => setModOpen(false)}
              anchorRef={modAnchorRef}
            />
          )}
        </span>
        <button
          type="button"
          className={`bar-btn bar-btn-fav${isFav ? " is-active" : ""}`}
          disabled={!onToggleFav || !reviewer || favBusy || isOwner}
          onClick={handleFav}
          data-testid="bar-btn-fav"
          data-active={isFav ? "true" : "false"}
          aria-pressed={isFav}
          title={isOwner ? "You can't star your own app" : undefined}
        >
          <StarIcon width="16" height="16" />
          <span className="bar-label">Star</span>
          {details?.starCount === undefined ? (
            <span className="bar-count is-loading" aria-hidden="true" />
          ) : starCount > 0 ? (
            <span className="bar-count" data-testid="card-stars">{starCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          className={`bar-btn bar-btn-share${shareCopied ? " is-copied" : ""}`}
          data-right="true"
          onClick={handleShare}
          data-testid="bar-btn-share"
        >
          <Share2 size={18} aria-hidden="true" />
          <span className="bar-label">{shareCopied ? "Link copied!" : "Share link"}</span>
        </button>
      </div>
    </article>
  );
});

// ---------------------------------------------------------------------------
// Install widget
// ---------------------------------------------------------------------------

export function InstallWidget() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(INSTALL_CMD);
    addUserActionBreadcrumb("Copy install command");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="install-widget">
      <span className="install-widget-title">Install {CLI_COMMAND} CLI</span>
      <div
        className={`install-line${copied ? " install-line-copied" : ""}`}
        onClick={handleCopy}
      >
        <span className="install-line-prompt">$</span>
        <span className="install-line-cmd">{INSTALL_CMD}</span>
        {copied ? <CheckIcon className="install-line-icon" /> : <CopyIcon className="install-line-icon" />}
        <span className={`install-line-tooltip${copied ? " install-line-tooltip-visible" : ""}`}>
          Copied!
        </span>
      </div>
    </div>
  );
}
