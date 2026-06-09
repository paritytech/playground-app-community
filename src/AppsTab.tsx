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

import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { Check, X } from "lucide-react";
import { AppCard, TAGS, type AppDetails, type AppsSort } from "./App";
import type { AppEntry } from "./registryTypes";
import { useIntersectionObserver } from "./utils";
import { TUTORIAL_DOMAIN } from "./config";
import ErrorBanner from "./ErrorBanner.tsx";
import { addUiBreadcrumb } from "./lib/telemetry";

const TUTORIAL_HREF = `/apps?app=${TUTORIAL_DOMAIN}`;

const PAGE = 12;

// Mockup-category → app-TAG mapping. Categories without a matching TAG resolve
// to null (filter cleared). To make Personal/Art first-class, add them to TAGS.
const CAT_TO_TAG: Record<string, (typeof TAGS)[number] | null> = {
  Games: "gaming",
  DeFi: "defi",
  Social: "social",
  IRL: "irl",
  Personal: null,
  Art: null,
};

const SORT_OPTIONS: { id: AppsSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "stars", label: "Most starred" },
  { id: "mods", label: "Most modded" },
];

type Props = {
  entries: AppEntry[];
  pinnedEntries: AppEntry[];
  pinnedDomains: Set<string>;
  loading: boolean;
  loadError: string | null;
  hasMore: boolean;
  detailsRef: MutableRefObject<Map<string, AppDetails>>;
  detailsVersion: number;
  loadMore: () => void;
  handleSelectEntry: (entry: AppEntry) => void;
  retryLoad: () => void;
  reviewer?: string;
  onToggleFav: (domain: string, makeFav: boolean) => Promise<void>;
  sortBy: AppsSort;
  onSortChange: (next: AppsSort) => void;
};

export default function AppsTab({
  entries,
  pinnedEntries,
  pinnedDomains,
  loading,
  loadError,
  hasMore,
  detailsRef,
  detailsVersion,
  loadMore,
  handleSelectEntry,
  retryLoad,
  reviewer,
  onToggleFav,
  sortBy,
  onSortChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [moddableOnly, setModdableOnly] = useState(false);
  const [hiwDrawerOpen, setHiwDrawerOpen] = useState(false);
  const sentinelRef = useIntersectionObserver(loadMore, hasMore && !loading);

  const [searchParams] = useSearchParams();
  const catParam = searchParams.get("cat");
  useEffect(() => {
    if (catParam === null) return;
    const mapped = CAT_TO_TAG[catParam] ?? null;
    setActiveTag(mapped);
  }, [catParam]);

  const filtered = useMemo(() => {
    const filter = (e: AppEntry) => {
      const details = detailsRef.current.get(e.domain);
      if (activeTag) {
        const entryTag = (details?.metadata?.tag ?? "").toLowerCase();
        if (entryTag !== activeTag.toLowerCase()) return false;
      }
      if (moddableOnly && !details?.metadata?.repository) return false;
      if (search) {
        const q = search.toLowerCase();
        const name = (details?.metadata?.name ?? e.domain).toLowerCase();
        if (!name.includes(q) && !e.domain.toLowerCase().includes(q)) return false;
      }
      return true;
    };
    // Ordering for `entries` comes from the on-chain read method that
    // App.tsx invoked (getApps / getTopStarred / getTopModded). Pinned is
    // curated separately and stays at the top regardless of sort.
    const pinned = pinnedEntries.filter(filter);
    const rest = entries.filter(e => !pinnedDomains.has(e.domain)).filter(filter);
    return [...pinned, ...rest];
    // detailsVersion intentionally in deps so metadata-driven filters re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, pinnedEntries, pinnedDomains, activeTag, moddableOnly, search, detailsVersion]);

  return (
    <div className="tab tab-apps" data-testid="tab-apps">
      <div className="tab-center">
        <header className="tab-header">
          <h1 className="tab-title">Apps</h1>
          <p className="tab-lead">
            Every app is designed to be modded. Pick a starting point, customise with AI, deploy. Tap stars to rate.
          </p>
        </header>
        {loadError && (
          <ErrorBanner
            title="Couldn't load apps."
            message={loadError}
            testid="load-error"
            onRetry={retryLoad}
          />
        )}
        <div className="grid" data-testid="app-grid">
          {filtered.map(entry => (
            <AppCard
              key={entry.domain}
              entry={entry}
              details={detailsRef.current.get(entry.domain)}
              onSelect={handleSelectEntry}
              reviewer={reviewer}
              onToggleFav={onToggleFav}
            />
          ))}
          {filtered.length === 0 && loading &&
            Array.from({ length: PAGE }, (_, i) => (
              <div key={`skel-${i}`} className="card card-skeleton" />
            ))
          }
        </div>
        {loading && filtered.length > 0 && (
          <div className="spinner" data-testid="loading-spinner">Loading...</div>
        )}
        {!loading &&
          filtered.length === 0 &&
          (entries.length > 0 || pinnedEntries.length > 0) &&
          (search || activeTag || moddableOnly) && (
            <div className="empty" data-testid="empty-state-filtered">
              No apps match your filter.
              {moddableOnly && " Try turning off \"Moddable only\"."}
              {search && activeTag
                ? ` Try clearing the search or the "${activeTag}" tag.`
                : search
                ? " Try clearing the search."
                : activeTag
                ? ` No apps tagged "${activeTag}".`
                : ""}
            </div>
          )}
        {!hasMore &&
          filtered.length === 0 &&
          !loading &&
          !loadError &&
          !search &&
          !activeTag &&
          !moddableOnly && (
            <div className="empty" data-testid="empty-state">No apps registered yet.</div>
          )}
        {hasMore && (
          <div ref={sentinelRef} className="sentinel" data-testid="infinite-scroll-sentinel" />
        )}
      </div>

      <aside className="tab-right-rail" data-testid="tab-right-rail">
        <button
          type="button"
          className="btn-primary btn-primary--how-it-works"
          onClick={() => setHiwDrawerOpen(true)}
          aria-haspopup="dialog"
          data-testid="how-it-works-trigger"
        >
          How it works
        </button>

        <form
          role="search"
          className="search-bar tab-rail-search"
          onSubmit={e => e.preventDefault()}
        >
          <input
            type="text"
            className="search-input"
            placeholder="Filter by name or domain…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Filter apps"
            data-testid="search-input"
          />
          {search && (
            <button
              className="search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear filter"
              type="button"
            >
              ×
            </button>
          )}
        </form>

        <div className="filters tab-rail-sort" data-testid="apps-sort" role="radiogroup" aria-label="Sort apps">
          {SORT_OPTIONS.map(opt => {
            const isActive = sortBy === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`filter-pill${isActive ? " active" : ""}`}
                onClick={() => {
                  if (isActive) return;
                  addUiBreadcrumb("Sort apps", { sortBy: opt.id });
                  onSortChange(opt.id);
                }}
                data-testid="sort-pill"
                data-sort={opt.id}
                data-active={isActive ? "true" : "false"}
                role="radio"
                aria-checked={isActive}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="filters tab-rail-filters" data-testid="apps-filters">
          {[null, ...TAGS].map(tag => {
            const isActive = activeTag === tag;
            const isClearable = isActive && tag !== null;
            return (
              <button
                key={tag ?? "all"}
                className={`filter-pill${isActive ? " active" : ""}`}
                onClick={() => {
                  const next = isClearable ? null : tag;
                  addUiBreadcrumb("Filter tag", { tag: next ?? "all" });
                  setActiveTag(next);
                }}
                data-testid="filter-pill"
                data-tag={tag ?? "all"}
                data-active={isActive ? "true" : "false"}
                aria-pressed={isActive}
                aria-label={isClearable ? `Clear ${tag} filter` : undefined}
              >
                {tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : "All"}
                {isClearable && (
                  <span className="filter-pill-clear" aria-hidden="true">
                    <X size={12} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
          <span className="filters-pipe" aria-hidden="true">|</span>
          <button
            type="button"
            className={`filter-pill${moddableOnly ? " active" : ""}`}
            data-tag="moddable"
            onClick={() => {
              const next = !moddableOnly;
              addUiBreadcrumb("Filter moddable", { moddableOnly: next });
              setModdableOnly(next);
            }}
            data-testid="filter-moddable-toggle"
            data-active={moddableOnly ? "true" : "false"}
            aria-pressed={moddableOnly}
          >
            <span className="filter-pill-check" aria-hidden="true">
              <Check size={10} strokeWidth={3} />
            </span>
            Moddable only
          </button>
        </div>

        <aside className="feat-card" data-testid="how-it-works">
          <h3>How it works</h3>
          <p className="feat-card-body">
            Every app here is open-source and deployed live. Tap launch to try it, mod to remix, or fav to keep it around. Build your own from the{" "}
            <Link className="pitch-link" to={TUTORIAL_HREF}>
              tutorial
            </Link>
            .
          </p>
        </aside>

        <aside className="feat-card" data-testid="give-receive-stars">
          <h3>Give and receive stars</h3>
          <p className="feat-card-body">
            Star apps you find interesting to save them to your favourites. The builder earns XP, and you get a little back too.
          </p>
        </aside>
      </aside>

      {hiwDrawerOpen && createPortal(
        <div
          className="drawer-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hiw-drawer-title"
          onClick={() => setHiwDrawerOpen(false)}
          data-testid="how-it-works-drawer"
        >
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <h3 id="hiw-drawer-title">How it works</h3>
            <p>
              Every app here is open-source and deployed live. Tap launch to try it, mod to remix, or fav to keep it around. Build your own from the{" "}
              <Link
                className="pitch-link"
                to={TUTORIAL_HREF}
                onClick={() => setHiwDrawerOpen(false)}
              >
                tutorial
              </Link>
              .
            </p>
            <h3 className="drawer-section">Give and receive stars</h3>
            <p>
              Star apps you find interesting to save them to your favourites. The builder earns XP, and you get a little back too.
            </p>
            <button
              type="button"
              className="btn-ghost drawer-close"
              onClick={() => setHiwDrawerOpen(false)}
            >
              Close
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
