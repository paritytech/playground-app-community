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
import { Link } from "react-router-dom";
import XpLabel from "./XpLabel";

type Reward = { amount: number; upTo?: boolean; condition?: string };
type Cta = { label: string; to: string };

type Props = {
  /** Anchor target — the TOC and scroll-on-mount jump to this. */
  id: string;
  title: string;
  /** XP rewards; the `+N XP` sits in its label, the condition beside it. */
  rewards?: Reward[];
  /** Leading line; larger, primary-colour. Sits above the description. */
  lede?: ReactNode;
  description?: ReactNode;
  /** Instruction body (tabs, steps, guidance). */
  children?: ReactNode;
  cta?: Cta;
  /** Plain variant for "Where next" — no card chrome. */
  plain?: boolean;
  /** Quest colour for this step; tints the XP label, code commands, and links. */
  hue?: string;
};

/**
 * One step of the Playground journey: a titled, anchorable section with
 * optional XP rewards, a short description, instructions, and a CTA.
 */
export default function JourneySection({
  id,
  title,
  rewards,
  lede,
  description,
  children,
  cta,
  plain,
  hue,
}: Props) {
  return (
    <section
      id={id}
      className={`journey-section${plain ? " journey-section--plain" : ""}`}
      style={hue ? ({ "--journey-hue": hue } as CSSProperties) : undefined}
      aria-labelledby={`${id}-title`}
    >
      <div className="journey-section-head">
        <h2 id={`${id}-title`} className="journey-section-title">
          {title}
        </h2>
        {rewards && rewards.length > 0 && (
          <div className="journey-section-rewards">
            {rewards.map((r) => (
              <span key={r.condition ?? r.amount} className="journey-reward">
                <XpLabel amount={r.amount} upTo={r.upTo} />
                {r.condition && <span className="xp-note">{r.condition}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      {lede && <p className="xp-prizes-lede">{lede}</p>}
      {description && <p className="journey-section-desc">{description}</p>}
      {children}
      {cta && (
        <Link className="btn-primary journey-cta" to={cta.to}>
          {cta.label}
        </Link>
      )}
    </section>
  );
}
