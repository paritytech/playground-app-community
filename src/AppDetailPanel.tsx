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

import { useState, useEffect, useMemo } from "react";
import * as Sentry from "@sentry/react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SignerState } from "@parity/product-sdk-signer";
import { VISIBILITY_PRIVATE, VISIBILITY_PUBLIC, buildAppShareUrl, type AppEntry, type AppDetails } from "./App.tsx";
import { REVX_URL, CLI_COMMAND } from "./config.ts";
import { placeholderFor, useIconUrl } from "./utils";
import { handleExternalClick } from "./utils/externalNavigation";
import { StarIcon, PinIcon, CopyIcon, CheckIcon } from "./icons.tsx";
import ErrorBanner from "./ErrorBanner.tsx";
import CoverImageEditor from "./CoverImageEditor.tsx";
import { journeyTracker, addUserActionBreadcrumb, isSigningRejection } from "./lib/telemetry";

interface AppDetailPanelProps {
  entry: AppEntry;
  details?: AppDetails;
  signer: SignerState;
  isAdmin?: boolean;
  isPinned?: boolean;
  /** Check whether the current viewer has starred this app. */
  fetchHasStarred: (domain: string, voter: string) => Promise<boolean>;
  onClose: () => void;
  /** Star this app (+1 point to the owner). */
  onStar: (domain: string) => Promise<void>;
  /** Unstar this app (-1 point from the owner). */
  onUnstar: (domain: string) => Promise<void>;
  onDelete: (domain: string) => Promise<void>;
  onTogglePin?: (domain: string, pinned: boolean) => Promise<void>;
  onSetVisibility?: (domain: string, visibility: number) => Promise<void>;
  onSelectApp?: (domain: string) => Promise<boolean>;
  /** Owner-only — upload new cover image bytes and re-publish metadata. */
  onUpdateCoverImage?: (domain: string, bytes: Uint8Array) => Promise<void>;
}

export default function AppDetailPanel({ entry, details, signer, isAdmin, isPinned, fetchHasStarred, onClose, onStar, onUnstar, onDelete, onTogglePin, onSetVisibility, onSelectApp, onUpdateCoverImage }: AppDetailPanelProps) {
  // --- State ---
  const [copied, setCopied] = useState<"mod" | "repo" | "link" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pinStatus, setPinStatus] = useState<"idle" | "working">("idle");
  const [hasStarred, setHasStarred] = useState(false);
  const [starStatus, setStarStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "confirm" | "deleting" | "error">("idle");
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);

  // --- Derived ---
  const voter = signer.selectedAccount?.h160Address;
  const isOwner = !!voter && !!entry.owner
    && voter.toLowerCase() === entry.owner.toLowerCase();
  const name = details?.metadata?.name ?? entry.domain.replace(/\.dot$/, "");
  const desc = details?.metadata?.description;
  const repo = details?.metadata?.repository;
  const tag = details?.metadata?.tag;
  const readme = details?.metadata?.readme;
  const moddedFrom = details?.metadata?.moddedFrom;
  const modCmd = `${CLI_COMMAND} mod ${entry.domain.replace(/\.dot$/, "")}`;
  // Cover takes precedence over icon when set. `useIconUrl` is content-cached
  // by CID, so passing it whichever CID we have is cheap.
  const coverUrl = useIconUrl(details?.metadata?.cover_cid);
  const iconUrl = useIconUrl(details?.metadata?.icon_cid);
  const heroUrl = coverUrl ?? iconUrl;
  const bgSrc = heroUrl ?? placeholderFor(entry.domain);
  const starCount = details?.starCount ?? 0;
  const modCount = details?.modCount ?? 0;
  const readmeHtml = useMemo(() => {
    if (!readme) return null;
    return DOMPurify.sanitize(marked.parse(readme) as string);
  }, [readme]);

  // --- Effects ---
  useEffect(() => {
    if (!voter) return;
    fetchHasStarred(entry.domain, voter).then(setHasStarred);
  }, [entry.domain, voter, fetchHasStarred]);

  useEffect(() => () => journeyTracker.abandon("star-app"), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  // --- Handlers ---
  const toggleStar = async () => {
    if (!voter || isOwner || starStatus === "submitting") return;
    const wasStarred = hasStarred;
    journeyTracker.start("star-app", {
      "star.domain": entry.domain,
      "star.action": wasStarred ? "unstar" : "star",
    });
    setStarStatus("submitting");
    try {
      if (wasStarred) {
        await onUnstar(entry.domain);
      } else {
        await onStar(entry.domain);
      }
      journeyTracker.milestone("star-app", "tx-submitted");
      setHasStarred(!wasStarred);
      setStarStatus("idle");
      journeyTracker.complete("star-app");
    } catch (err) {
      if (isSigningRejection(err)) {
        setStarStatus("idle");
        journeyTracker.abandon("star-app");
        return;
      }
      setStarStatus("error");
      journeyTracker.fail("star-app", "star-tx-failed", err);
      Sentry.captureException(err, {
        tags: { action: wasStarred ? "unstar" : "star", domain: entry.domain },
      });
    }
  };

  const handleDelete = async () => {
    if (deleteStatus !== "confirm") { setDeleteStatus("confirm"); return; }
    setDeleteStatus("deleting");
    try { await onDelete(entry.domain); } catch { setDeleteStatus("error"); }
  };

  const handleTogglePin = async () => {
    if (!onTogglePin || pinStatus === "working") return;
    setPinStatus("working");
    try {
      await onTogglePin(entry.domain, !isPinned);
    } finally {
      setPinStatus("idle");
    }
  };

  const copyText = (text: string, key: "mod" | "repo" | "link") => {
    navigator.clipboard.writeText(text);
    addUserActionBreadcrumb(`Copy ${key}`, { domain: entry.domain });
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const shareUrl = useMemo(() => buildAppShareUrl(entry.domain), [entry.domain]);

  return (
    <div className="detail-backdrop" onClick={onClose} data-testid="app-detail-backdrop">
      <div
        className="detail-panel"
        onClick={e => e.stopPropagation()}
        data-testid="app-detail-panel"
        data-domain={entry.domain}
        data-is-owner={isOwner ? "true" : "false"}
      >
        {isAdmin && onTogglePin && (
          <button
            className={`detail-pin ${isPinned ? "detail-pin-active" : ""}`}
            disabled={pinStatus === "working"}
            onClick={e => { e.stopPropagation(); handleTogglePin(); }}
            aria-label={isPinned ? "Unpin app" : "Pin app"}
            title={pinStatus === "working" ? (isPinned ? "Unpinning..." : "Pinning...") : isPinned ? "Unpin app" : "Pin app"}
            data-testid="detail-pin-btn"
            data-pinned={isPinned ? "true" : "false"}
          >
            <PinIcon width="16" height="16" />
          </button>
        )}
        {isPinned && !isAdmin && (
          <div
            className="detail-pin detail-pin-active detail-pin-readonly"
            data-testid="detail-pin-indicator"
          >
            <PinIcon width="16" height="16" />
          </div>
        )}
        <button
          className="detail-close"
          onClick={onClose}
          aria-label="Close"
          data-testid="detail-close-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="detail-hero" style={{ backgroundImage: `url(${bgSrc})` }}>
          <div className="detail-hero-fade" />
          {isOwner && onUpdateCoverImage && (
            <button
              type="button"
              className="detail-edit-cover"
              onClick={() => setCoverEditorOpen(true)}
              data-testid="detail-edit-cover-btn"
            >
              Edit cover
            </button>
          )}
          <div className="detail-hero-content">
            <div className="detail-tag-row">
              {tag && <span className="detail-tag" data-testid="detail-tag">{tag}</span>}
              {starCount > 0 && (
                <span className="detail-rating" data-testid="detail-stars">
                  <StarIcon width="14" height="14" />
                  <span className="detail-rating-count" data-testid="detail-star-count">{starCount}</span>
                </span>
              )}
              {modCount > 0 && (
                <span className="detail-modcount" data-testid="detail-modcount">
                  {modCount}× modded
                </span>
              )}
            </div>
            <h1 className="detail-name" data-testid="detail-name">{name}</h1>
            {desc && <p className="detail-desc" data-testid="detail-description">{desc}</p>}
          </div>
        </div>

        <div className="detail-body">
          <div className="detail-links">
            <a
              className="detail-link"
              href={`https://${entry.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleExternalClick}
              data-testid="detail-domain-link"
            >
              {entry.domain}
            </a>
            {repo && (
              <span
                className="detail-link detail-link-copy"
                onClick={() => copyText(repo, "repo")}
                data-testid="detail-repo-link"
                data-href={repo}
              >
                {repo.replace(/^https?:\/\/(www\.)?/, "")}
                <span className="detail-link-icon">
                  {copied === "repo" ? <CheckIcon /> : <CopyIcon />}
                </span>
              </span>
            )}
            <span
              className="detail-link detail-link-copy"
              onClick={() => copyText(shareUrl, "link")}
              data-testid="detail-share-link"
              data-href={shareUrl}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyText(shareUrl, "link"); } }}
            >
              {copied === "link" ? "Link copied" : "Share"}
              <span className="detail-link-icon">
                {copied === "link" ? <CheckIcon /> : <CopyIcon />}
              </span>
            </span>
            {moddedFrom && (
              <span
                className="detail-modded-from"
                data-testid="detail-modded-from"
                data-domain={moddedFrom}
              >
                Modded from{" "}
                <a
                  className="detail-link"
                  href={buildAppShareUrl(moddedFrom)}
                  data-testid="detail-modded-from-link"
                  onClick={e => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onSelectApp?.(moddedFrom).then(ok => {
                      if (!ok) setToast(`${moddedFrom} is no longer available`);
                    });
                  }}
                >
                  {moddedFrom}
                </a>
              </span>
            )}
          </div>

          <div className="detail-section">
            <h3 className="detail-section-title">Star this app</h3>
            {signer.selectedAccount ? (
              isOwner ? (
                <p className="detail-no-readme" data-testid="star-self-notice">
                  <em>You can't star your own app.</em>
                </p>
              ) : (
                <div className="review-form" data-testid="star-form">
                  <button
                    className={`btn btn-publish ${hasStarred ? "btn-starred" : ""}`}
                    disabled={starStatus === "submitting"}
                    onClick={toggleStar}
                    data-testid="star-toggle-btn"
                    data-status={starStatus}
                    data-starred={hasStarred ? "true" : "false"}
                    aria-label={hasStarred ? "Remove star" : "Star this app"}
                  >
                    <StarIcon width="14" height="14" />
                    {starStatus === "submitting"
                      ? hasStarred ? "Unstarring..." : "Starring..."
                      : hasStarred ? "Starred" : "Star"}
                  </button>
                  {starStatus === "error" && (
                    <ErrorBanner
                      message="Failed to update star. Please try again."
                      compact
                      testid="star-error"
                    />
                  )}
                </div>
              )
            ) : (
              <p className="detail-no-readme" data-testid="star-connect-prompt">
                <em>Sign in to star this app.</em>
              </p>
            )}
          </div>

          <div className="detail-section">
            <h3 className="detail-section-title">Mod</h3>
            {repo ? (
              <div className="mod-actions">
                <a
                  className="btn btn-revx"
                  href={`${REVX_URL}/editor?mod=${encodeURIComponent(entry.domain)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleExternalClick}
                  data-testid="detail-revx-link"
                >
                  Vibe Code in RevX
                </a>
                <span className="mod-actions-or">or with {CLI_COMMAND} CLI</span>
                <div
                  className="code-block"
                  onClick={() => copyText(modCmd, "mod")}
                  data-testid="mod-command"
                >
                  <code>{modCmd}</code>
                  <span className="copy-icon">{copied === "mod" ? <CheckIcon /> : <CopyIcon />}</span>
                </div>
              </div>
            ) : (
              <p className="detail-play-only" data-testid="detail-play-only">
                <em>This app is play-only — its source isn't published, so it can't be modded.</em>
              </p>
            )}
          </div>

          <div className="detail-section">
            <h3 className="detail-section-title">Readme</h3>
            {readmeHtml ? (
              <div
                className="detail-readme"
                data-testid="detail-readme"
                dangerouslySetInnerHTML={{ __html: readmeHtml }}
              />
            ) : (
              <p className="detail-no-readme" data-testid="detail-no-readme"><em>No readme provided.</em></p>
            )}
          </div>

          {isOwner && onSetVisibility && (
            <div className="detail-section" data-testid="detail-visibility-section">
              <h3 className="detail-section-title">Visibility</h3>
              <div className="visibility-toggle">
                <button
                  type="button"
                  className={`visibility-option${(entry.visibility ?? VISIBILITY_PUBLIC) === VISIBILITY_PUBLIC ? " active" : ""}`}
                  onClick={() => onSetVisibility(entry.domain, VISIBILITY_PUBLIC)}
                  data-testid="visibility-public-btn"
                  data-active={(entry.visibility ?? VISIBILITY_PUBLIC) === VISIBILITY_PUBLIC ? "true" : "false"}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={`visibility-option${(entry.visibility ?? VISIBILITY_PUBLIC) === VISIBILITY_PRIVATE ? " active" : ""}`}
                  onClick={() => onSetVisibility(entry.domain, VISIBILITY_PRIVATE)}
                  data-testid="visibility-private-btn"
                  data-active={(entry.visibility ?? VISIBILITY_PUBLIC) === VISIBILITY_PRIVATE ? "true" : "false"}
                >
                  Private
                </button>
              </div>
              <p className="visibility-hint">
                {(entry.visibility ?? VISIBILITY_PUBLIC) === VISIBILITY_PRIVATE
                  ? "Only you can see this app."
                  : "This app is visible to everyone."}
              </p>
            </div>
          )}

          {(isOwner || isAdmin) && (
            <div className="detail-section detail-danger" data-testid="detail-danger-zone">
              {deleteStatus === "error" && (
                <ErrorBanner
                  message="Failed to delete. Please try again."
                  compact
                  testid="delete-error"
                />
              )}
              <div className="detail-delete-actions">
                <button
                  className={`btn ${deleteStatus === "confirm" ? "btn-delete-confirm" : "btn-delete"}`}
                  disabled={deleteStatus === "deleting"}
                  onClick={handleDelete}
                  data-testid={deleteStatus === "confirm" ? "delete-confirm-btn" : "delete-btn"}
                  data-status={deleteStatus}
                >
                  {deleteStatus === "confirm" ? "Confirm Delete" : deleteStatus === "deleting" ? "Deleting..." : "Delete App"}
                </button>
                {deleteStatus === "confirm" && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => setDeleteStatus("idle")}
                    data-testid="delete-cancel-btn"
                  >Cancel</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div className="detail-toast" role="status" data-testid="detail-toast">
          {toast}
        </div>
      )}
      {coverEditorOpen && onUpdateCoverImage && (
        <CoverImageEditor
          currentCoverUrl={heroUrl}
          onClose={() => setCoverEditorOpen(false)}
          onSave={async bytes => {
            await onUpdateCoverImage(entry.domain, bytes);
            setCoverEditorOpen(false);
          }}
          onCancelled={() => setToast("Cover edit cancelled — permission not granted.")}
        />
      )}
    </div>
  );
}
