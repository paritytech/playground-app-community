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

import { describe, expect, it } from "vitest";
import { resolveEnvironment } from "./networkEnvironment";
import { frontendDeployPlan, frontendDeployEnvironment } from "../scripts/deploy-frontend";

describe("network selection and frontend deployment", () => {
  it("defaults to Paseo and accepts only canonical network names", () => {
    expect(resolveEnvironment(undefined)).toBe("paseo");
    expect(resolveEnvironment("")).toBe("paseo");
    expect(resolveEnvironment("paseo")).toBe("paseo");
    expect(resolveEnvironment("devnet")).toBe("devnet");
    for (const value of [" Devnet ", "DEVNET", " devnet", "summit", " "]) {
      expect(() => resolveEnvironment(value)).toThrow("Use exactly paseo or devnet");
    }
  });
  it.each([["paseo", "paseo-next-v2"], ["devnet", "PCF-devnet"]])("pairs %s builds with their deployment preset", (network, preset) => {
    const plan = frontendDeployPlan(network, "my-app.dot");
    expect(plan.environment).toBe(network);
    expect(plan.domain).toBe(network === "paseo" ? "my-app.paseo" : "my-app.dot");
    expect(plan.build).toEqual(["run", "build:frontend"]);
    expect(plan.deploy).toEqual(["exec", "bulletin-deploy", "./dist", plan.domain, "--env", preset, "--config", "bulletin-deploy.config.ts"]);
  });
  it("rejects missing or malformed domains before running any commands", () => {
    for (const domain of [undefined, "", "--flag", "../path", "a b", "other.example"]) {
      expect(() => frontendDeployPlan("devnet", domain)).toThrow("APP_DOTNS_DOMAIN");
    }
  });
  it("rejects alternate signer/RPC overrides and never includes their values in errors", () => {
    const plan = frontendDeployPlan("devnet", "my-app");
    expect(() => frontendDeployEnvironment(plan, {})).toThrow("Set MNEMONIC");
    for (const key of ["DOTNS_RPC", "DOTNS_KEY_URI"]) {
      expect(() => frontendDeployEnvironment(plan, { MNEMONIC: "fake-test-value", [key]: "private-value" })).toThrow(`Unset ${key};`);
    }
    expect(frontendDeployEnvironment(plan, { MNEMONIC: "fake-test-value", VITE_ENVIRONMENT: "paseo" })).toMatchObject({
      VITE_ENVIRONMENT: "devnet", APP_DEPLOY_ENV: "devnet", APP_DOTNS_DOMAIN: "my-app.dot",
    });
  });

});
