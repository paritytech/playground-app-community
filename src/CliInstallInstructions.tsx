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

import { ChevronDown } from "lucide-react";
import CodeSnippet from "./CodeSnippet";
import { CLI_COMMAND, INSTALL_CMD } from "./config";

type Props = {
  /**
   * Whether the disclosure starts expanded. The first CLI instruction opens it
   * by default so first-time setup is visible; later ones stay collapsed.
   */
  defaultOpen?: boolean;
};

/**
 * Reusable "install + init the CLI first" block shared by every Playground CLI
 * instruction tab, so the setup prerequisites are written once. Rendered as a
 * native <details> disclosure — collapsed by default, opened on the first tab.
 */
export default function CliInstallInstructions({ defaultOpen = false }: Props) {
  return (
    <details className="cli-install" open={defaultOpen}>
      <summary className="cli-install-toggle">
        <ChevronDown size={16} className="cli-install-chevron" aria-hidden="true" />
        First time? Install and set up the CLI
      </summary>
      <div className="cli-install-body">
        <p className="journey-step-note">
          Install the Playground CLI if you haven't already.
        </p>
        <CodeSnippet command={INSTALL_CMD} ariaLabel={`Copy ${CLI_COMMAND} install command`} />
        <p className="journey-step-note">
          Set up your toolchain, phone signing, and account if you haven't already.
        </p>
        <CodeSnippet command={`${CLI_COMMAND} init`} ariaLabel={`Copy ${CLI_COMMAND} init command`} />
      </div>
    </details>
  );
}
