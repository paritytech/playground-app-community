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

import { NavLink, useLocation } from "react-router-dom";
import { Gamepad2, Compass, Trophy, User, Info } from "lucide-react";

export default function LeftRail() {
  const location = useLocation();
  const path = location.pathname;
  const isPlayground = path === "/";
  const isApps = path === "/apps" || path.startsWith("/apps/");
  const isLeaderboard = path === "/leaderboard";
  const isProfile = path === "/profile" || path.startsWith("/profile/");
  const isAbout = path === "/about";

  return (
    <nav className="left-rail" aria-label="Primary">
      <NavLink
        to="/"
        end
        className={`nav-item${isPlayground ? " active" : ""}`}
        data-testid="nav-playground"
        aria-label="Playground"
        title="Playground"
      >
        <Gamepad2 size={20} aria-hidden="true" />
        <span className="nav-label">Playground</span>
      </NavLink>
      <NavLink
        to="/apps"
        className={`nav-item${isApps ? " active" : ""}`}
        data-testid="nav-apps"
        aria-label="Apps"
        title="Apps"
      >
        <Compass size={20} aria-hidden="true" />
        <span className="nav-label">Apps</span>
      </NavLink>
      <NavLink
        to="/leaderboard"
        className={`nav-item${isLeaderboard ? " active" : ""}`}
        data-testid="nav-leaderboard"
        aria-label="Leaderboard"
        title="Leaderboard"
      >
        <Trophy size={20} aria-hidden="true" />
        <span className="nav-label">Leaderboard</span>
      </NavLink>
      <NavLink
        to="/profile"
        className={`nav-item${isProfile ? " active" : ""}`}
        data-testid="nav-profile"
        aria-label="Profile"
        title="Profile"
      >
        <User size={20} aria-hidden="true" />
        <span className="nav-label">Profile</span>
      </NavLink>
      <NavLink
        to="/about"
        className={`nav-item${isAbout ? " active" : ""}`}
        data-testid="nav-about"
        aria-label="About"
        title="About"
      >
        <Info size={20} aria-hidden="true" />
        <span className="nav-label">About</span>
      </NavLink>
    </nav>
  );
}
