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

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Info, Square } from "lucide-react";
import CodeSnippet from "./CodeSnippet";
import XpLabel from "./XpLabel";
import { fetchPointBreakdown } from "./PointsBreakdown";
import { CLI_COMMAND, NO_CODE_APP_DOMAIN, REVX_URL, TUTORIAL_DOMAIN } from "./config.ts";
import { QUEST_COLORS } from "./questPalette.ts";
import { XP_VALUES } from "./xpValues.ts";
import { handleExternalClick } from "./utils/externalNavigation.ts";
import platformImg from "./assets/platform.png";
import hoverCharacter from "./assets/platform_hover_character.png";
import hoverPet from "./assets/platform_hover_pet.png";
import hoverUnderground from "./assets/platform_hover_underground.png";
import hoverLights from "./assets/platform_hover_lights.png";
import hoverStar from "./assets/platform_hover_star.png";
import hoverGates from "./assets/platform_hover_gates.png";

// Tutorial CTA targets, keyed off the same TUTORIAL_DOMAIN as the Apps tab so
// the mod command and RevX deep link always point at the pinned tutorial app.
const TUTORIAL_SLUG = TUTORIAL_DOMAIN.replace(/\.dot$/, "");
const TUTORIAL_URL = `${REVX_URL}/editor?mod=${encodeURIComponent(TUTORIAL_DOMAIN)}`;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

type XPSticker = {
  before?: string;
  amount: number;
  upTo?: boolean;
  after?: string;
};

type QuestConfig = {
  id: string;
  step: number;
  // Down-page section to deep-link to from the window's info button. Keyed off
  // the card CONTENT (decoupled from `id` in the reorder), matching the journey
  // section ids in PlaygroundTab.tsx / PlaygroundToc.tsx.
  anchor: string;
  title: string;
  xp?: XPSticker;
  xp2?: XPSticker;
  hoverImage: string;
  color: string;
  region: { top: string; left: string; width: string; height: string };
  circle: { top: string; left: string };
  label: { text: string; placement: "above" | "below" };
  // Optional override for where the window first opens. "center-right" pins it
  // vertically centred and 200px in from the right edge (default is a cascading
  // spawn anchored under the left rail).
  spawn?: "center-right";
  content: ReactNode;
};

// Ordered so larger regions sit beneath smaller ones in the DOM —
// later-declared hotspots win pointer events when they overlap.
// Each entry is a FIXED island spot: `id`, `hoverImage`, `color`, `region`,
// `circle`, and `label.placement` are bound to the artwork and never move. The
// badge number (`step`) and card payload (`title`/`xp`/`label.text`/`content`)
// were resequenced independently, so e.g. `id: "star"` opens the .dot-site card.
const QUESTS: QuestConfig[] = [
  {
    id: "lights",
    step: 5,
    anchor: "stars",
    title: "Give and receive stars",
    xp: { before: "receive", amount: XP_VALUES.starReceived },
    hoverImage: hoverLights,
    color: QUEST_COLORS.lights,
    region: { top: "4%", left: "20%", width: "65%", height: "25%" },
    circle: { top: "20%", left: "80%" },
    label: { text: "Star Apps", placement: "below" },
    content: (
      <>
        <p className="ucard-sub">
          Give stars to vote for apps you enjoy.
        <br />
          The builder earns XP. Stars are unlimited, one per app, and permanent.
        </p>
        <Link className="ucard-cta" to="/apps">
          Explore published apps →
        </Link>
      </>
    ),
  },
  {
    id: "underground",
    step: 4,
    anchor: "mod",
    title: "Mod an existing app",
    // No XP pill: modding pays the same deploy reward as any other publish
    // (and only on your first two deploys). Advertising +100 here on top of
    // the two other deploy-quest cards would imply +300 total, which isn't
    // available — only the first two deploys in any combination pay out.
    hoverImage: hoverUnderground,
    color: QUEST_COLORS.underground,
    region: { top: "60%", left: "20%", width: "70%", height: "38%" },
    circle: { top: "78%", left: "55%" },
    label: { text: "Mod an app", placement: "below" },
    content: (
      <>
        <p className="ucard-sub">
          Pick a moddable app, change something, deploy.
        </p>
        <CodeSnippet command={`${CLI_COMMAND} mod [url]`} />
        <p className="ucard-sub t-center">
          or
        </p>
        <Link className="ucard-cta" to="/apps">
          Explore moddable apps →
        </Link>
      </>
    ),
  },
  {
    id: "gates",
    step: 3,
    anchor: "tutorial",
    title: "Learn how to build games on Polkadot",
    xp: { amount: XP_VALUES.deploy },
    hoverImage: hoverGates,
    color: QUEST_COLORS.gates,
    region: { top: "0%", left: "44%", width: "30%", height: "40%" },
    circle: { top: "13%", left: "68%" },
    label: { text: "Learn games", placement: "above" },
    spawn: "center-right",
    content: (
      <>
        <dl className="ucard-stats">
          <div>
            <dt>Time</dt>
            <dd>~30m</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>easy → hard</dd>
          </div>
        </dl>
        <p className="ucard-sub">
          Build any game. Along the way, learn how decentralised storage, unstoppable logic and player-owned assets change what digital experiences are made of.
        </p>
        <ul className="ucard-checklist">
          <li><Square size={16} aria-hidden="true" /> Level 1: Set up</li>
          <li><Square size={16} aria-hidden="true" /> Level 2: Design game mechanics</li>
          <li><Square size={16} aria-hidden="true" /> Level 3: Add multiplayer</li>
          <li><Square size={16} aria-hidden="true" /> Level 4: Deploy your game</li>
        </ul>
        <p className="ucard-sub">
          To start:
        </p>
        <CodeSnippet command={`${CLI_COMMAND} mod ${TUTORIAL_SLUG}`} />
        <p className="ucard-sub t-center">
          or
        </p>
        <a
          className="ucard-cta"
          href={TUTORIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleExternalClick}
        >
          Vibe Code in RevX
        </a>
      </>
    ),
  },
  {
    id: "character",
    step: 1,
    anchor: "username",
    title: "Create your username",
    xp: { amount: XP_VALUES.username },
    hoverImage: hoverCharacter,
    color: QUEST_COLORS.character,
    region: { top: "31%", left: "28%", width: "16%", height: "24%" },
    circle: { top: "50%", left: "33%" },
    label: { text: "Username", placement: "below" },
    content: (
      <>
        <p className="ucard-sub">
          Claim a username for your playground profile. This is how you will appear on the leaderboard.
        </p>
        <Link className="ucard-cta" to="/profile">
          Open profile →
        </Link>
      </>
    ),
  },
  {
    id: "star",
    step: 2,
    anchor: "dot-site",
    title: "Launch your first .dot site",
    xp: { amount: XP_VALUES.deploy },
    hoverImage: hoverStar,
    color: QUEST_COLORS.star,
    region: { top: "32%", left: "44%", width: "12%", height: "14%" },
    circle: { top: "40%", left: "52%" },
    label: { text: "Your site on .dot domain", placement: "below" },
    content: (
      <>
        <p className="ucard-sub">Decentralise any existing page</p>
        <CodeSnippet command={`${CLI_COMMAND} decentralize`} />
        <p className="ucard-sub t-center">
          or create and launch your site
          <br/>
          without writing code
        </p>
        <a
          className="ucard-cta"
          href={`https://${NO_CODE_APP_DOMAIN}.li`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleExternalClick}
        >
          {NO_CODE_APP_DOMAIN}.li →
        </a>
      </>
    ),
  },
  {
    id: "pet",
    step: 6,
    anchor: "mod",
    title: "Someone mods your app",
    xp: { amount: XP_VALUES.modReceived },
    hoverImage: hoverPet,
    color: QUEST_COLORS.pet,
    region: { top: "60%", left: "5%", width: "20%", height: "25%" },
    circle: { top: "80%", left: "19%" },
    label: { text: "App modded", placement: "below" },
    content: (
      <>
        <p className="ucard-sub">
          Earn XP for inspiring someone else.
        <br/>
          Publish a moddable app and earn XP when someone builds on top of it.
        </p>
        <Link className="ucard-cta" to="/profile">
          My apps →
        </Link>
      </>
    ),
  },
];

interface IslandPortalProps {
  /** H160 of the connected account, or undefined when not signed in. */
  account?: string;
  /** Bumped on point-award events so the live XP total re-fetches. */
  pointsRefresh?: number;
}

export default function IslandPortal({ account, pointsRefresh }: IslandPortalProps) {
  const [, setSearchParams] = useSearchParams();
  // Live XP total below the island. The contract awards absolute XP (no client
  // multiplier — June 2026 scoring rework), so get_point_breakdown().total is
  // displayed as-is. Stays 0 until a signed-in account's points resolve.
  const [xpTotal, setXpTotal] = useState(0n);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  // Perpetual scroll nudge: fade the chevron in for a few bounce cycles, fade
  // it out, hold a pause while hidden, then repeat — forever. Self-scheduling
  // timeout chain (not setInterval) so show/hide phases can have distinct
  // durations and stay in lockstep with the state flips.
  useEffect(() => {
    const VISIBLE_MS = 4800; // ~3 bounce cycles (1.6s each)
    const PAUSE_MS = 3500; // good rest while hidden before the next nudge
    let showTimer = 0;
    let hideTimer = 0;
    const cycle = () => {
      setShowScrollHint(true);
      hideTimer = window.setTimeout(() => {
        setShowScrollHint(false);
        showTimer = window.setTimeout(cycle, PAUSE_MS);
      }, VISIBLE_MS);
    };
    showTimer = window.setTimeout(cycle, 2000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  // Fetch the connected account's XP total on mount, on account switch, and
  // whenever a point-award event bumps pointsRefresh. Resets to 0 when signed
  // out. Mirrors the cancelled-flag guard used by PointsBreakdown.
  useEffect(() => {
    if (!account) {
      setXpTotal(0n);
      return;
    }
    let cancelled = false;
    fetchPointBreakdown(account).then((b) => {
      if (!cancelled) setXpTotal(b.total);
    });
    return () => {
      cancelled = true;
    };
  }, [account, pointsRefresh]);

  const openOrFocus = useCallback((id: string) => {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }, []);

  const close = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = prev.filter((w) => w !== id);
      setActiveId((current) => {
        if (next.length === 0) return null;
        if (current === id) return next[next.length - 1];
        return current;
      });
      return next;
    });
  }, []);

  // Deep-link to the matching down-page journey section. The floating window
  // stays open (the user may want to keep it while reading the section).
  // Reuses the `?section=<id>` convention PlaygroundTab scrolls on.
  const goToSection = useCallback(
    (anchor: string) => {
      setSearchParams({ section: anchor }, { replace: true });
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!activeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(activeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, close]);

  const hoveredQuest = hoveredId
    ? QUESTS.find((q) => q.id === hoveredId) ?? null
    : null;
  const activeQuest = activeId
    ? QUESTS.find((q) => q.id === activeId) ?? null
    : null;
  const displayedQuest = hoveredQuest ?? activeQuest;

  return (
    <section className="row row-island" aria-label="Quest portal">
      <div className="island-platform">
        <span className="island-stage">
          <img
            className="island-img island-img-default"
            src={platformImg}
            alt="Floating island platform"
          />
          {/* key forces remount so the fade-in animation replays on quest change */}
          {displayedQuest && (
            <img
              key={displayedQuest.id}
              className="island-img island-img-hover is-visible"
              src={displayedQuest.hoverImage}
              alt=""
              aria-hidden="true"
            />
          )}
          {QUESTS.map((q) => (
            <QuestHotspot
              key={q.id}
              quest={q}
              isHovered={hoveredId === q.id}
              onHover={setHoveredId}
              onSelect={openOrFocus}
            />
          ))}
        </span>
        {/* Preload hover variants so first hover doesn't flash. */}
        <div className="island-preload" aria-hidden="true">
          {QUESTS.map((q) => (
            <img key={q.id} src={q.hoverImage} alt="" />
          ))}
        </div>
      </div>
      <div className="island-xp" aria-label="Experience points">
        <span className="island-xp-n">{xpTotal.toString()}</span> XP
      </div>
      <div
        className={`island-scroll-hint${showScrollHint ? " is-visible" : ""}`}
        aria-hidden="true"
      >
        <ChevronDown size={28} strokeWidth={1.5} />
      </div>

      {openIds.map((id, idx) => {
        const quest = QUESTS.find((q) => q.id === id);
        if (!quest) return null;
        return (
          <QuestWindow
            key={id}
            quest={quest}
            cascadeIndex={idx}
            isActive={activeId === id}
            onActivate={() => setActiveId(id)}
            onClose={() => close(id)}
            onInfo={() => goToSection(quest.anchor)}
          />
        );
      })}
    </section>
  );
}

type QuestHotspotProps = {
  quest: QuestConfig;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
};

function QuestHotspot({
  quest,
  isHovered,
  onHover,
  onSelect,
}: QuestHotspotProps) {
  const hotspotStyle = {
    ...quest.region,
    "--quest-accent": quest.color,
  } as CSSProperties;
  return (
    <>
      <button
        type="button"
        className="island-hotspot"
        style={hotspotStyle}
        aria-label={quest.title}
        onPointerEnter={() => onHover(quest.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(quest.id)}
        onBlur={() => onHover(null)}
        onClick={() => onSelect(quest.id)}
      />
      <span
        className="island-badge is-persistent"
        style={{ ...quest.circle, background: quest.color }}
        aria-hidden="true"
      >
        {quest.step}
      </span>
      <span
        className={`island-label island-label-${quest.label.placement}${isHovered ? " is-visible" : ""}`}
        style={{ ...quest.circle, color: quest.color }}
        aria-hidden="true"
      >
        {quest.label.text}
      </span>
    </>
  );
}

function XPGroup({ xp }: { xp: XPSticker }) {
  return (
    <span className="quest-window-xp">
      {xp.before && <span className="quest-window-xp-side">{xp.before}</span>}
      <XpLabel amount={xp.amount} upTo={xp.upTo} />
      {xp.after && <span className="quest-window-xp-side">{xp.after}</span>}
    </span>
  );
}

type QuestWindowProps = {
  quest: QuestConfig;
  cascadeIndex: number;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onInfo: () => void;
};

function QuestWindow({
  quest,
  cascadeIndex,
  isActive,
  onActivate,
  onClose,
  onInfo,
}: QuestWindowProps) {
  const windowRef = useRef<HTMLDivElement | null>(null);
  // Lock cascade index at mount so closing earlier windows doesn't slide later ones.
  const [initialCascadeIndex] = useState(cascadeIndex);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const didCenterRef = useRef(false);

  useEffect(() => {
    const w = Math.min(420, window.innerWidth * 0.9);
    if (quest.spawn === "center-right") {
      // 200px gap from the right edge; vertically centred (provisional height —
      // refined once measured in the layout effect below).
      setPos({
        left: clamp(window.innerWidth - w - 200, 8, window.innerWidth - w - 8),
        top: clamp((window.innerHeight - 360) / 2, 8, window.innerHeight - 8),
      });
      return;
    }
    const isMobile = window.innerWidth <= 820;
    let baseX = 16;
    let baseY = 80;
    if (!isMobile) {
      const rail = document.querySelector(".left-rail");
      const items = rail?.querySelectorAll(".nav-item") ?? [];
      const lastItem = items[items.length - 1];
      if (rail) baseX = rail.getBoundingClientRect().left;
      if (lastItem) baseY = lastItem.getBoundingClientRect().bottom + 24;
    }
    const offset = initialCascadeIndex * 24;
    setPos({
      left: clamp(baseX + offset, 8, window.innerWidth - w - 8),
      top: clamp(baseY + offset, 8, window.innerHeight - 200),
    });
    // Mount-only — initialCascadeIndex is locked at mount so this never re-runs.
  }, [initialCascadeIndex, quest.spawn]);

  // For "center-right" windows, recentre vertically using the real measured
  // height once rendered. Runs before paint (no flash) and only once.
  useLayoutEffect(() => {
    if (quest.spawn !== "center-right" || didCenterRef.current) return;
    const el = windowRef.current;
    if (!el) return;
    didCenterRef.current = true;
    const h = el.offsetHeight;
    setPos((p) =>
      p
        ? { left: p.left, top: clamp((window.innerHeight - h) / 2, 8, window.innerHeight - h - 8) }
        : p,
    );
  }, [pos, quest.spawn]);

  const dragState = useRef<{
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    pointerId: number;
    dragging: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (
      (e.target as HTMLElement).closest(
        ".quest-window-close, .quest-window-info",
      )
    )
      return;
    const el = windowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      pointerId: e.pointerId,
      dragging: true,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.add("is-dragging");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = dragState.current;
    const el = windowRef.current;
    if (!s || !s.dragging || !el) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const nx = clamp(s.originLeft + dx, 4, window.innerWidth - w - 4);
    const ny = clamp(s.originTop + dy, 4, window.innerHeight - h - 4);
    setPos({ left: nx, top: ny });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLElement>) => {
    const s = dragState.current;
    if (!s) return;
    s.dragging = false;
    e.currentTarget.classList.remove("is-dragging");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  if (!pos) return null;

  const style = {
    left: pos.left,
    top: pos.top,
    "--quest-accent": quest.color,
  } as CSSProperties;

  return createPortal(
    <div
      ref={windowRef}
      className={`quest-window${isActive ? " is-active" : ""}`}
      style={style}
      role="dialog"
      aria-label={quest.title}
      onPointerDownCapture={onActivate}
    >
      <header
        className="quest-window-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <span className="quest-window-grip" aria-hidden="true">⠿⠿</span>
        {quest.xp && <XPGroup xp={quest.xp} />}
        {quest.xp2 && <XPGroup xp={quest.xp2} />}
        {!quest.xp && !quest.xp2 && (
          <span
            className="quest-window-xp quest-window-xp--ghost"
            aria-hidden="true"
          >
            <XpLabel amount={50} />
          </span>
        )}
        <button
          type="button"
          className="quest-window-info"
          onClick={onInfo}
          aria-label="View full instructions"
        >
          <Info size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="quest-window-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </header>
      <div className="quest-window-body">
        <h3 className="ucard-title">{quest.title}</h3>
        {quest.content}
      </div>
    </div>,
    document.body,
  );
}
