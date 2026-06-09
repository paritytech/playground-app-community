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

import { useId, useState, type ReactNode } from "react";
import { Code2 } from "lucide-react";

type Props = {
  /** Playground CLI instructions (always the default, always available). */
  cli: ReactNode;
  /** No-Code instructions. Omit to render the No Code tab as disabled. */
  noCode?: ReactNode;
};

/**
 * Two-mode instruction switcher: a code-icon "Playground CLI" tab and a
 * "No Code" tab. When `noCode` is omitted the No Code tab renders disabled
 * (a flow that isn't available yet) and can't be selected.
 */
export default function InstructionTabs({ cli, noCode }: Props) {
  const [active, setActive] = useState<"cli" | "no-code">("cli");
  const baseId = useId();
  const noCodeAvailable = noCode != null;
  const current = active === "no-code" && noCodeAvailable ? "no-code" : "cli";

  return (
    <div className="instr-tabs">
      <div className="instr-tablist" role="tablist" aria-label="Instructions">
        <button
          type="button"
          role="tab"
          id={`${baseId}-cli-tab`}
          aria-selected={current === "cli"}
          aria-controls={`${baseId}-cli-panel`}
          className={`instr-tab${current === "cli" ? " is-active" : ""}`}
          onClick={() => setActive("cli")}
        >
          <Code2 size={15} aria-hidden="true" />
          Playground CLI
        </button>
        <button
          type="button"
          role="tab"
          id={`${baseId}-nc-tab`}
          aria-selected={current === "no-code"}
          aria-controls={`${baseId}-nc-panel`}
          className={`instr-tab${current === "no-code" ? " is-active" : ""}`}
          onClick={() => noCodeAvailable && setActive("no-code")}
          disabled={!noCodeAvailable}
          title={noCodeAvailable ? undefined : "No Code flow coming soon"}
        >
          No Code
          {!noCodeAvailable && <span className="instr-tab-soon">soon</span>}
        </button>
      </div>

      <div className="instr-box">
        <div
          role="tabpanel"
          id={`${baseId}-cli-panel`}
          aria-labelledby={`${baseId}-cli-tab`}
          hidden={current !== "cli"}
          className="instr-panel"
        >
          {cli}
        </div>
        {noCodeAvailable && (
          <div
            role="tabpanel"
            id={`${baseId}-nc-panel`}
            aria-labelledby={`${baseId}-nc-tab`}
            hidden={current !== "no-code"}
            className="instr-panel"
          >
            {noCode}
          </div>
        )}
      </div>
    </div>
  );
}
