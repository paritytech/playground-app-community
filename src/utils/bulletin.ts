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

import { useEffect, useState } from "react";
import { CloudStorageClient, createLazySigner } from "@parity/product-sdk-cloud-storage";
import { CHAIN } from "../config.ts";
import { signerManager } from "./contracts.ts";

// Lazy signer wraps the SignerManager so the bulletin client can be built
// before any account is selected. Account changes after sign-in are picked up
// automatically — each store call resolves the current signer.
//
// Promise-based singleton (rather than nullable + check) so concurrent first
// callers during page-load (every AppCard's useIconUrl + fetchMetadata) share
// one CloudStorageClient.create() instead of each spinning up their own.
let _bulletinClientPromise: Promise<CloudStorageClient> | null = null;

export function getBulletinClient(): Promise<CloudStorageClient> {
  if (!_bulletinClientPromise) {
    const signer = createLazySigner(() => {
      const acct = signerManager.getState().selectedAccount;
      return acct ? acct.getSigner() : null;
    });
    _bulletinClientPromise = CloudStorageClient.create({ environment: CHAIN, signer });
  }
  return _bulletinClientPromise!;
}

// Icon CIDs are content-addressed and immutable, so blob URLs can be cached
// for the session. Session-lifetime cache; the underlying bytes stay alive in
// the renderer until the page unloads (no `URL.revokeObjectURL` calls). Memory
// is roughly (unique-icons × icon-size); fine for V1 registry sizes. If the
// registry grows past a few hundred unique icons or sessions get pinned to
// venue displays for hours, swap this for a bounded LRU + revoke-on-eviction.
const _iconBlobCache = new Map<string, string>();
const _iconInFlight = new Map<string, Promise<string | null>>();

function fetchIconUrl(cid: string): Promise<string | null> {
  const cached = _iconBlobCache.get(cid);
  if (cached) return Promise.resolve(cached);
  const inFlight = _iconInFlight.get(cid);
  if (inFlight) return inFlight;
  const p = (async (): Promise<string | null> => {
    try {
      const client = await getBulletinClient();
      const bytes = await client.fetchBytes(cid);
      // Blob's typed BlobPart rejects Uint8Array<ArrayBufferLike> on lib.dom 2024+,
      // even though every concrete Uint8Array works at runtime.
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      _iconBlobCache.set(cid, url);
      return url;
    } catch {
      // fetchBytes throws CloudStorageHostUnavailableError outside a Polkadot
      // host (Desktop/Mobile). The grid degrades to placeholders.
      return null;
    }
  })().finally(() => _iconInFlight.delete(cid));
  _iconInFlight.set(cid, p);
  return p;
}

export function useIconUrl(cid: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    cid ? _iconBlobCache.get(cid) ?? null : null,
  );
  useEffect(() => {
    if (!cid) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    fetchIconUrl(cid).then(u => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [cid]);
  return url;
}
