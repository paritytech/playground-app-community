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

import { useEffect, useMemo, useState } from "react";
import {
  registryReady,
  validateUsernameClient,
  describeValidationError,
  USERNAME_MAX_LEN,
} from "./utils";
import XpLabel from "./XpLabel";

interface Props {
  /** Caller's H160 — used for the `isUsernameAvailable` self-check so the
   *  "already yours" case doesn't flag as taken. */
  callerH160: `0x${string}`;
  /** Current username (null if unset) — shown as the input placeholder. */
  currentUsername: string | null;
  /**
   * Called when the user confirms a new (validated, available) name.
   * Parent owns the tx lifecycle from here — it sets optimistic state,
   * fires the on-chain write in the background, and toasts on failure.
   * The modal closes immediately after; the host-app's sign prompt is
   * the visible activity during the actual chain round-trip.
   */
  onConfirm: (name: string) => void;
  onClose: () => void;
}

/**
 * Validate + check availability for a username. The actual write is owned
 * by the parent so the modal can dismiss the instant the user confirms,
 * without waiting on best-block inclusion (~6-12s on Paseo Asset Hub Next).
 *
 * UX rationale: keeping the modal mounted during the entire `.tx()` await
 * makes the user stare at a "Saving..." button while the host-app sign
 * prompt is what they should be acting on. Closing eagerly + painting
 * optimistic on the parent removes that perceived wait while preserving
 * correctness (failed txs revert the optimistic state via the parent's
 * error path).
 */
export default function SetUsernameModal({
  callerH160,
  currentUsername,
  onConfirm,
  onClose,
}: Props) {
  const [name, setName] = useState("");
  const [availability, setAvailability] = useState<"checking" | "free" | "taken" | "self" | "idle">(
    "idle",
  );

  const validationErr = useMemo(() => {
    if (!name) return null;
    return validateUsernameClient(name);
  }, [name]);

  // Live availability probe — only when the name is locally valid. Debounced
  // 300 ms so each keystroke doesn't burst-call the chain.
  useEffect(() => {
    if (!name || validationErr) {
      setAvailability("idle");
      return;
    }
    setAvailability("checking");
    const timer = setTimeout(async () => {
      try {
        const registry = await registryReady;
        const res = await registry.isUsernameAvailable.query(name.toLowerCase(), callerH160);
        if (!res.success) {
          setAvailability("idle");
          return;
        }
        if (res.value) {
          // Free OR already mine. Distinguish so the button copy can flip
          // between "Claim" and "Save" (no-op same-name case).
          setAvailability(name.toLowerCase() === (currentUsername ?? "") ? "self" : "free");
        } else {
          setAvailability("taken");
        }
      } catch {
        setAvailability("idle");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [name, validationErr, callerH160, currentUsername]);

  const canSubmit = name !== "" && !validationErr && availability !== "taken";

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(name.toLowerCase());
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        data-testid="set-username-modal"
      >
        <header className="modal-head">
          <span
            className="modal-head-xp modal-head-xp--ghost"
            aria-hidden="true"
          >
            <XpLabel amount={0} />
          </span>
          <h2 className="modal-head-title">
            {currentUsername ? "Change username" : "Set a username"}
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            data-testid="set-username-close"
          >
            ×
          </button>
        </header>
        <p className="modal-lead">
          Your username shows up on the leaderboard and on apps you publish.
          Lowercase letters, digits, and hyphens. {USERNAME_MAX_LEN} characters max.
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="username-input">
            Username
          </label>
          <input
            id="username-input"
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value.trim())}
            placeholder={currentUsername ?? "your-handle"}
            maxLength={USERNAME_MAX_LEN}
            autoFocus
            data-testid="username-input"
          />
          <div className="form-hint" data-testid="username-hint">
            {validationErr
              ? describeValidationError(validationErr)
              : availability === "taken"
                ? "That name is taken."
                : availability === "checking"
                  ? "Checking availability..."
                  : availability === "free"
                    ? "Available."
                    : availability === "self"
                      ? "This is already your username."
                      : " "}
          </div>
        </div>

        <div className="modal-actions">
          <button
            className="btn btn-ghost"
            onClick={onClose}
            data-testid="set-username-cancel"
          >
            Cancel
          </button>
          <button
            className="btn btn-publish"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="set-username-submit"
          >
            {availability === "self" ? "Save" : currentUsername ? "Change" : "Claim"}
          </button>
        </div>
      </div>
    </div>
  );
}
