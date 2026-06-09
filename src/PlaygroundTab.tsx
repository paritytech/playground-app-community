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

import { Square } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import CliInstallInstructions from "./CliInstallInstructions";
import CodeSnippet from "./CodeSnippet";
import InstructionTabs from "./InstructionTabs";
import IslandPortal from "./IslandPortal";
import JourneySection from "./JourneySection";
import PlaygroundToc from "./PlaygroundToc";
import { QUEST_COLORS } from "./questPalette";
import { XP_VALUES } from "./xpValues";
import SiteFooter from "./SiteFooter";
import XpPrizesSection from "./XpPrizesSection";
import { handleExternalClick } from "./utils/externalNavigation";
import { CLI_COMMAND, NO_CODE_APP_DOMAIN, REVX_URL, TUTORIAL_DOMAIN } from "./config";

const TUTORIAL_SLUG = TUTORIAL_DOMAIN.replace(/\.dot$/, "");
const TUTORIAL_REVX_URL = `${REVX_URL}/editor?mod=${encodeURIComponent(TUTORIAL_DOMAIN)}`;
const AGENT_PROMPT = "Walk me through the tutorial in this repo.";

/**
 * Playground tab — the task / XP / prizes journey. The hero island sits at the
 * top, the XP & Prizes card is the first text, then each journey step, with a
 * sticky table of contents on the right. Deep links (the TOC and the
 * Leaderboard's "How XP & Prizes work" link) arrive as `?section=<id>` and are
 * scrolled into view on mount.
 */
interface PlaygroundTabProps {
  /** H160 of the connected account, or undefined when not signed in. */
  account?: string;
  /** Bumped on point-award events so the island XP total re-fetches live. */
  pointsRefresh: number;
}

export default function PlaygroundTab({ account, pointsRefresh }: PlaygroundTabProps) {
  const [searchParams] = useSearchParams();
  const section = searchParams.get("section");

  useEffect(() => {
    if (!section) return;
    // Defer so the hero island has laid out before we measure the target.
    const t = window.setTimeout(() => {
      document
        .getElementById(section)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [section]);

  return (
    <section
      className="tab tab-playground tab-playground-journey"
      data-testid="tab-playground"
    >
      <IslandPortal account={account} pointsRefresh={pointsRefresh} />

      <div className="playground-layout">
        <div className="tab-center playground-main">
          <XpPrizesSection />

          <h2 id="earn-xp" className="journey-group-title">Earn XP</h2>

          <JourneySection
            id="username"
            title="Set username"
            hue={QUEST_COLORS.character}
            rewards={[{ amount: XP_VALUES.username }]}
            lede="Claim your name in the Playground."
            description="This is how other builders will recognise you on apps, stars, mods, and the leaderboard."
            cta={{ label: "Go to profile", to: "/profile" }}
          />

          <JourneySection
            id="dot-site"
            title="Your site on .dot domain"
            hue={QUEST_COLORS.gates}
            rewards={[
              { amount: XP_VALUES.deploy, condition: "for your 1st deploy" },
            ]}
            lede="Put your first site on a .dot domain. Start from a static page, publish it, and make it part of the Playground."
          >
            <InstructionTabs
              cli={
                <>
                  <CliInstallInstructions defaultOpen />
                  <ol className="journey-steps">
                    <li>
                      Already have a live website? Decentralise it on a .dot
                      domain.
                      <CodeSnippet command={`${CLI_COMMAND} decentralize`} />
                    </li>
                  </ol>
                </>
              }
              noCode={
                <ol className="journey-steps">
                  <li>
                    Open{" "}
                    <a
                      className="journey-link"
                      href={`https://${NO_CODE_APP_DOMAIN}.li`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleExternalClick}
                    >
                      {NO_CODE_APP_DOMAIN}.li
                    </a>{" "}
                    in your browser.
                  </li>
                  <li>
                    Customize the page, then hit deploy to publish your site to a .dot
                    domain. No local setup needed.
                  </li>
                </ol>
              }
            />
          </JourneySection>

          <JourneySection
            id="tutorial"
            title="Game app tutorial"
            hue={QUEST_COLORS.underground}
            rewards={[
              { amount: XP_VALUES.deploy, condition: "for your 2nd deploy" },
            ]}
            lede="Build a game app one level at a time, in about thirty minutes."
          >
            <div className="journey-about">
              <ul className="ucard-checklist">
                <li><Square size={16} aria-hidden="true" /> Level 1: Set up</li>
                <li><Square size={16} aria-hidden="true" /> Level 2: Design game mechanics</li>
                <li><Square size={16} aria-hidden="true" /> Level 3: Add multiplayer</li>
                <li><Square size={16} aria-hidden="true" /> Level 4: Deploy your game</li>
              </ul>
              <p className="journey-section-desc">
                Along the way you learn how decentralised storage, unstoppable logic,
                and player-owned assets change what apps are made of.
              </p>
            </div>
            <InstructionTabs
              cli={
                <>
                  <CliInstallInstructions />
                  <ol className="journey-steps">
                    <li>Open a new, empty project directory.</li>
                    <li>
                      Pull the tutorial source code.
                      <CodeSnippet command={`${CLI_COMMAND} mod ${TUTORIAL_SLUG}`} />
                    </li>
                    <li>Confirm cloning the source code when prompted.</li>
                    <li>
                      Once cloning is done, start your coding agent in that
                      project directory.
                    </li>
                    <li>
                      Give the coding agent this prompt:
                      <CodeSnippet command={AGENT_PROMPT} variant="prompt" />
                    </li>
                    <li>Follow the agent's instructions.</li>
                    <li>Get your XP on deploying the results.</li>
                  </ol>
                </>
              }
              noCode={
                <ol className="journey-steps">
                  <li>
                    Open the tutorial in RevX.
                    <p className="journey-step-aside">
                      <a
                        className="journey-link"
                        href={TUTORIAL_REVX_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleExternalClick}
                      >
                        Vibe Code in RevX →
                      </a>
                    </p>
                  </li>
                  <li>
                    Give the RevX agent this prompt:
                    <CodeSnippet command={AGENT_PROMPT} variant="prompt" />
                  </li>
                  <li>Follow the agent's instructions.</li>
                  <li>Get your XP on deploying the results.</li>
                </ol>
              }
            />
          </JourneySection>

          <JourneySection
            id="mod"
            title="Mod apps"
            hue={QUEST_COLORS.lights}
            rewards={[
              { amount: XP_VALUES.modReceived, condition: "each time someone mods your app" },
            ]}
            lede="Start from something that already works. Pick an app, change the idea, style, or behaviour, then publish your own version."
            cta={{ label: "Explore apps", to: "/apps" }}
          >
            <InstructionTabs
              cli={
                <>
                  <p className="journey-shared-note">
                    Go to the Apps tab on the Playground site. Launch apps, try
                    them out, and look for ideas you want to change or build
                    from. On the app details page, you will see whether an app is
                    moddable.
                  </p>
                  <CliInstallInstructions />
                  <ol className="journey-steps">
                    <li>
                      Go to the app details page and check whether the app is
                      moddable.
                    </li>
                    <li>
                      Copy the mod command from the app details page. It follows
                      this pattern:
                      <CodeSnippet command={`${CLI_COMMAND} mod [url]`} />
                    </li>
                    <li>Run the command locally.</li>
                    <li>Modify the app.</li>
                    <li>
                      Deploy your version.
                      <CodeSnippet command={`${CLI_COMMAND} deploy`} />
                    </li>
                    <li>
                      When publishing, select:
                      <ul className="journey-substeps">
                        <li>publish to Playground</li>
                        <li>make it moddable</li>
                        <li>link the source</li>
                      </ul>
                      <span className="journey-note">
                        This gives others a starting point and helps you maximise
                        XP.
                      </span>
                    </li>
                  </ol>
                </>
              }
              noCode={
                <>
                  <p className="journey-shared-note">
                    Go to the Apps tab on the Playground site. Launch apps, try
                    them out, and look for ideas you want to change or build
                    from. On the app details page, you will see whether an app is
                    moddable.
                  </p>
                  <ol className="journey-steps">
                    <li>Click the Vibe Code in RevX button.</li>
                    <li>Talk to the agent to make changes.</li>
                    <li>Preview the app.</li>
                    <li>Hit deploy when ready.</li>
                  </ol>
                  <p className="journey-warning">
                    Apps deployed from RevX are not moddable yet. To make your app
                    moddable, use the Playground CLI flow.
                  </p>
                </>
              }
            />
          </JourneySection>

          <JourneySection
            id="stars"
            title="Give and receive stars"
            hue={QUEST_COLORS.star}
            rewards={[
              { amount: XP_VALUES.starReceived, condition: "each time someone stars your app" },
            ]}
            lede="Star apps you like to save them to your favourites and help surface the projects worth celebrating."
            description="Your stars help choose what gets noticed. Starring is one-way and free — the XP goes to the app's builder."
          />

          <JourneySection
            id="where-next"
            title="Where next"
            lede="See what others are building, find a starting point, or publish something new for others to remix."
            cta={{ label: "Go to leaderboard", to: "/leaderboard" }}
            plain
          >
            <ul className="journey-ideas">
              <li>See what other people have created.</li>
              <li>Explore apps and star the ones you like.</li>
              <li>Pick an idea and build from it.</li>
              <li>Make your own app moddable so others can start from it.</li>
            </ul>
          </JourneySection>
        </div>

        <aside className="tab-right-rail playground-toc-rail">
          <PlaygroundToc />
        </aside>
      </div>

      <SiteFooter />
    </section>
  );
}
