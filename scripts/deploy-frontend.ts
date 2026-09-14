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

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolveEnvironment } from "../src/networkEnvironment";

export function frontendDeployPlan(network: string | undefined, domain: string | undefined) {
  const environment = resolveEnvironment(network);
  const label = domain?.toLowerCase().replace(/\.(dot|paseo)$/, "");
  if (!label || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
    throw new Error("APP_DOTNS_DOMAIN must be a valid bare label or label.dot");
  }
  return {
    environment,
    domain: `${label}.${environment === "paseo" ? "paseo" : "dot"}`,
    build: ["run", "build:frontend"],
    deploy: ["exec", "bulletin-deploy", "./dist", `${label}.${environment === "paseo" ? "paseo" : "dot"}`, "--env",
      environment === "devnet" ? "PCF-devnet" : "paseo-next-v2",
      "--config", "bulletin-deploy.config.ts"],
  };
}

export function frontendDeployEnvironment(plan: ReturnType<typeof frontendDeployPlan>, inherited: NodeJS.ProcessEnv) {
  if (!inherited.MNEMONIC?.trim()) throw new Error("Set MNEMONIC explicitly before deployment");
  for (const key of ["DOTNS_RPC", "DOTNS_KEY_URI"]) {
    if (inherited[key]) throw new Error(`Unset ${key}; it overrides the selected deployment network or signer`);
  }
  return { ...inherited, VITE_ENVIRONMENT: plan.environment, APP_DEPLOY_ENV: plan.environment, APP_DOTNS_DOMAIN: plan.domain };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [network, ...flags] = process.argv.slice(2);
  if (flags.some(flag => flag !== "--dry-run")) throw new Error("Unsupported deployment argument");
  const plan = frontendDeployPlan(network, process.env.APP_DOTNS_DOMAIN);
  if (flags.includes("--dry-run")) {
    // Deliberately excludes inherited environment and credentials, and runs no commands.
    console.log(JSON.stringify(plan, null, 2));
  } else {
    const env = frontendDeployEnvironment(plan, process.env);
    execFileSync("pnpm", plan.build, { env, stdio: "inherit" });
    execFileSync("pnpm", plan.deploy, { env, stdio: "inherit" });
  }
}
