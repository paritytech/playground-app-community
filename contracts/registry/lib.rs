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

#![no_main]
#![no_std]

extern crate pvm_contract as pvm_contract_sdk;

use alloc::string::String;
use common::{revert, ContextId, EntityId};
use core::ops::Bound;
use parity_scale_codec::{Decode, Encode};
use pvm::storage::{Mapping, OrderedIndex};
use pvm::{Address, caller};
use pvm_contract as pvm;

cdm::import!("@mock/reputation");

/// keccak256(this) must equal the context_id used by register-context.ts —
/// changing one without the other silently orphans reputation history.
const PLAYGROUND_CONTEXT_LABEL: &[u8] = b"playground.dot";

/// Visibility levels for apps.
pub const VISIBILITY_PRIVATE: u8 = 0;
pub const VISIBILITY_PUBLIC: u8 = 1;
pub const MAX_VISIBILITY: u8 = 1; // bump when adding levels

/// Final XP amounts per issue #286. Numbers must match `src/xpValues.ts` on
/// the frontend; see that file for the award semantics and rationale.
pub const DEPLOY_XP: u128 = 100;
pub const MOD_RECEIVED_XP: u128 = 50;
pub const STAR_RECEIVED_XP: u128 = 10;
pub const USERNAME_BONUS_XP: u128 = 25;

/// Maximum `owner_app_count` slot that pays the deploy reward. 3rd+ = 0.
pub const DEPLOY_REWARD_COUNT: u32 = 2;

#[derive(Default, Clone, Encode, Decode)]
pub struct AppInfo {
    pub owner: Address,
    pub visibility: u8,
    /// The `env::caller()` that submitted the first `publish` for this
    /// domain. Stored alongside `owner` so dev-mode iteration works: the
    /// CLI can publish with the user's H160 as `owner` (so the app shows
    /// in MyApps), then re-deploy many times signed by Alice without
    /// running into `Unauthorized` on subsequent updates. See
    /// `is_authorized` below for the auth-side use.
    pub publisher: Address,
}

/// One mod-lineage edge, stored SCALE-encoded in the append-only `lineage_at`
/// list. `child` was published as a mod of `source`. Recorded once per child
/// (see `publish`; also `import_lineage` for backfill).
#[derive(Default, Clone, Encode, Decode)]
pub struct LineageEdge {
    pub child: String,
    pub source: String,
}

#[derive(pvm::SolAbi)]
pub struct AppEntry {
    pub index: u32,
    pub domain: String,
    pub metadata_uri: String,
    pub owner: Address,
    pub visibility: u8,
    pub publisher: Address,
}

#[derive(pvm::SolAbi)]
pub struct AppImport {
    pub domain: String,
    pub owner: Address,
    pub publisher: Address,
    pub visibility: u8,
    pub metadata_uri: String,
    /// Whether the source app was moddable on first publish — drives the
    /// launch-point award (2, or 3 if true) when the migration script
    /// replays this entry. The off-chain script reads this from the
    /// Bulletin metadata's `repository` field.
    pub is_moddable: bool,
}

#[derive(pvm::SolAbi)]
pub struct AppsPage {
    pub total: u32,
    pub scanned: u32,
    pub entries: Vec<AppEntry>,
}

/// ABI-encoded return row for `get_lineage` (storage uses SCALE; this is the
/// external read shape). `child` was published as a mod of `source`.
#[derive(pvm::SolAbi)]
pub struct LineageEntry {
    pub child: String,
    pub source: String,
}

/// Migration replay row for `import_lineage`.
#[derive(pvm::SolAbi)]
pub struct LineageImport {
    pub child: String,
    pub source: String,
}

/// Migration replay row for `import_points` — authoritative leaderboard total.
#[derive(pvm::SolAbi)]
pub struct PointImport {
    pub account: Address,
    pub total: u128,
}

/// Migration replay row for `import_social_counts` — per-domain star/mod counters.
#[derive(pvm::SolAbi)]
pub struct SocialImport {
    pub domain: String,
    pub star_count: u32,
    pub mod_count: u32,
}

/// Migration replay row for `import_usernames` — display name per account.
#[derive(pvm::SolAbi)]
pub struct UsernameImport {
    pub account: Address,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Events — topic[0] is keccak256 of the event name, data is the domain bytes
//
// NOTE: this encoding is NOT compatible with standard Ethereum tooling.
// Solidity convention is `topic[0] = keccak256("Published(string)")` (full
// signature with parameter types) and ABI-encoded data. We use the bare event
// name and raw UTF-8 bytes for the domain because consumers are limited to
// this codebase's frontend listener. If we ever need viem/ethers/Etherscan
// compatibility, switch to: keccak256("EventName(types...)") for topic[0]
// and SolAbi-encode the payload.
// ---------------------------------------------------------------------------

fn event_topic(name: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    pvm::api::hash_keccak_256(name, &mut out);
    out
}

fn emit_event(name: &[u8], domain: &String) {
    let topic = event_topic(name);
    pvm::api::deposit_event(&[topic], domain.as_bytes());
}

/// Emit an event whose data is SCALE-encoded from a typed payload. Used for
/// the points/mod/star events whose payloads carry more than just a domain.
/// Topic[0] is keccak256(event_name); data is the SCALE encoding of `payload`.
fn emit_typed_event<E: Encode>(name: &[u8], payload: &E) {
    let topic = event_topic(name);
    pvm::api::deposit_event(&[topic], &payload.encode());
}

// ---------------------------------------------------------------------------
// Event payload types — SCALE-encoded into deposit_event data
// ---------------------------------------------------------------------------

/// Used by DeployPointAwarded / PlaygroundPublishPointAwarded / ModdablePointAwarded.
#[derive(Encode, Decode)]
pub struct PointAwardEvent {
    pub recipient: Address,
    pub domain: String,
}

/// Used by ModPointAwarded.
#[derive(Encode, Decode)]
pub struct ModPointEvent {
    pub recipient: Address,
    pub source_domain: String,
    pub modder: Address,
    pub mod_domain: String,
}

/// Used by StarPointAwarded. (There is no StarPointRefunded event: star XP
/// is one-way per #286/#287 — `unstar` removes the star but never refunds,
/// and a re-star after an unstar awards nothing, see `star_awarded`.)
#[derive(Encode, Decode)]
pub struct StarPointEvent {
    pub recipient: Address,
    pub domain: String,
    pub voter: Address,
}

/// Used by UsernameBonusAwarded. The `username` payload is the freshly
/// claimed name (matches the SCALE "first String after Address" decode
/// pattern the frontend dispatcher uses to route refresh signals).
#[derive(Encode, Decode)]
pub struct UsernameBonusEvent {
    pub recipient: Address,
    pub username: String,
}

// ---------------------------------------------------------------------------
// Points helpers
// ---------------------------------------------------------------------------

/// Return shape for `get_top_builders`. SolAbi for ABI-encoded reads.
#[derive(pvm::SolAbi)]
pub struct TopBuilderEntry {
    pub account: Address,
    pub score: u128,
}

/// Per-account points broken down by source. `total` matches the leaderboard
/// score; `star_points` and `mod_points` are derived from per-domain counts
/// (`star_count`, `mod_count`) summed over the account's owned domains;
/// `launch_points` is the residual `total - star_points - mod_points`. No
/// per-bucket storage — the breakdown is computed on every read so the
/// contract holds a single source of truth.
#[derive(pvm::SolAbi)]
pub struct PointBreakdown {
    pub launch_points: u128,
    pub mod_points: u128,
    pub star_points: u128,
    pub total: u128,
}

/// Award `delta` points to `account`. Updates the running total and moves the
/// `points_index` entry from the old score to the new one so the leaderboard
/// stays sorted. Saturating on overflow.
///
/// `points_index` is keyed on `u128::MAX - score` so an ascending range scan
/// returns highest-scoring accounts first. Removal uses
/// `remove_by_nonce(&key, nonce)` with the insertion nonce persisted in
/// `points_nonce` — O(log n) regardless of how many accounts are tied at the
/// same score. The previous value-based `remove(&K, &V)` walked every tied
/// duplicate (O(D * log n) in the tie size D) and out-gassed on-chain once a
/// few hundred accounts shared a score. If the nonce mapping is missing for a
/// live entry (pre-nonce data, e.g. lazy backfill), we fall back to the old
/// value-based removal.
fn award_points(account: Address, delta: u128) {
    if delta == 0 {
        return;
    }
    let cur = Storage::account_points().get(&account).unwrap_or(0);
    let new_score = cur.saturating_add(delta);
    if cur > 0 {
        if let Some(nonce) = Storage::points_nonce().get(&account) {
            Storage::points_index().remove_by_nonce(&(u128::MAX - cur), nonce);
        } else {
            // Defensive fallback: entry predates nonce bookkeeping.
            Storage::points_index().remove(&(u128::MAX - cur), &account);
        }
    }
    let nonce = Storage::points_index().insert(&(u128::MAX - new_score), &account);
    Storage::points_nonce().insert(&account, &nonce);
    Storage::account_points().insert(&account, &new_score);
}

/// Migration-only: SET `account`'s points to an absolute `total`, reconciling
/// `points_index`. Unlike `award_points` (which adds a delta), this overwrites
/// — correcting any launch-point seed left by `import_one`. Evicts at 0.
fn set_points(account: Address, total: u128) {
    let cur = Storage::account_points().get(&account).unwrap_or(0);
    if cur == total {
        return;
    }
    if cur > 0 {
        if let Some(nonce) = Storage::points_nonce().get(&account) {
            Storage::points_index().remove_by_nonce(&(u128::MAX - cur), nonce);
        } else {
            // Defensive fallback: entry predates nonce bookkeeping.
            Storage::points_index().remove(&(u128::MAX - cur), &account);
        }
    }
    if total > 0 {
        let nonce = Storage::points_index().insert(&(u128::MAX - total), &account);
        Storage::points_nonce().insert(&account, &nonce);
        Storage::account_points().insert(&account, &total);
    } else {
        Storage::account_points().remove(&account);
        Storage::points_nonce().remove(&account);
    }
}

/// Award gated on the blacklist. Returns `true` when the award actually
/// landed so callers can gate event emission on it — dev signers and any
/// `--suri` keys the team adds with `set_blacklisted` silently no-op,
/// keeping them off the leaderboard AND out of the event log.
fn try_award(account: Address, delta: u128) -> bool {
    if Storage::blacklisted().get(&account).unwrap_or(false) {
        return false;
    }
    award_points(account, delta);
    true
}

// ---------------------------------------------------------------------------
// Social-index helpers. `star_index` / `mod_index` store
// (count_key, domain_idx) — the domain's slot in `domain_at`, which is
// stable for the lifetime of the contract (see `unpublish`).
// ---------------------------------------------------------------------------

/// Set `domain`'s `star_count` to `new_count`, moving its `star_index`
/// entry from the old bucket to the new one. `domain_idx` is the domain's
/// permanent slot from `index_of`.
fn set_star_count(domain: &String, domain_idx: u32, new_count: u32) {
    let cur = Storage::star_count().get(domain).unwrap_or(0);
    if cur == new_count {
        return;
    }
    if cur > 0 {
        if let Some(nonce) = Storage::star_nonce().get(&domain_idx) {
            Storage::star_index().remove_by_nonce(&(u32::MAX - cur), nonce);
        } else {
            // Defensive fallback: entry predates nonce bookkeeping (or the
            // count was lazily backfilled by `import_social_counts` without
            // an index entry — a silent no-op either way).
            Storage::star_index().remove(&(u32::MAX - cur), &domain_idx);
        }
    }
    Storage::star_count().insert(domain, &new_count);
    if new_count > 0 {
        let nonce = Storage::star_index().insert(&(u32::MAX - new_count), &domain_idx);
        Storage::star_nonce().insert(&domain_idx, &nonce);
    } else {
        Storage::star_nonce().remove(&domain_idx);
    }
}

/// Resolve a `domain_at` slot to an `AppEntry`, applying the same
/// public-or-own-private visibility filter as `get_apps`. Returns `None`
/// when the slot is currently unpublished or invisible to `caller_addr`.
fn try_build_entry(idx: u32, caller_addr: Address) -> Option<AppEntry> {
    let domain = Storage::domain_at().get(&idx)?;
    let metadata_uri = Storage::metadata_uri().get(&domain)?;
    let info = Storage::info().get(&domain)?;
    if info.visibility < VISIBILITY_PUBLIC && info.owner != caller_addr {
        return None;
    }
    Some(AppEntry {
        index: idx,
        domain,
        metadata_uri,
        owner: info.owner,
        visibility: info.visibility,
        publisher: info.publisher,
    })
}

/// Build an `AppsPage` from a slice of `(neg_count, domain_idx)` index
/// entries returned by `star_index.range` / `mod_index.range`. `scanned`
/// reflects index consumption (not filtered entry count) so callers can
/// advance pagination correctly when the page is short due to filtering.
fn index_page_to_apps(raw: Vec<(u32, u32)>, total: u32) -> AppsPage {
    let scanned = raw.len() as u32;
    let caller_addr = caller();
    let mut entries: Vec<AppEntry> = Vec::with_capacity(raw.len());
    for (_neg_count, idx) in raw {
        if let Some(entry) = try_build_entry(idx, caller_addr) {
            entries.push(entry);
        }
    }
    AppsPage { total, scanned, entries }
}

/// Set `domain`'s `mod_count` to `new_count`, moving its `mod_index`
/// entry. Same shape as `set_star_count`.
fn set_mod_count(domain: &String, domain_idx: u32, new_count: u32) {
    let cur = Storage::mod_count().get(domain).unwrap_or(0);
    if cur == new_count {
        return;
    }
    if cur > 0 {
        if let Some(nonce) = Storage::mod_nonce().get(&domain_idx) {
            Storage::mod_index().remove_by_nonce(&(u32::MAX - cur), nonce);
        } else {
            // Defensive fallback: see `set_star_count`.
            Storage::mod_index().remove(&(u32::MAX - cur), &domain_idx);
        }
    }
    Storage::mod_count().insert(domain, &new_count);
    if new_count > 0 {
        let nonce = Storage::mod_index().insert(&(u32::MAX - new_count), &domain_idx);
        Storage::mod_nonce().insert(&domain_idx, &nonce);
    } else {
        Storage::mod_nonce().remove(&domain_idx);
    }
}

/// Convert a domain string to a 32-byte EntityId via keccak256 hash.
fn domain_to_entity(domain: &str) -> EntityId {
    let mut out: EntityId = [0u8; 32];
    pvm::api::hash_keccak_256(domain.as_bytes(), &mut out);
    out
}

// ---------------------------------------------------------------------------
// Username validation
// ---------------------------------------------------------------------------

/// Minimum and maximum byte-length of a stored username. ASCII-only so byte
/// length equals visible length. Floor of 3 keeps single-char names off the
/// leaderboard; ceiling of 30 stays well under the SolAbi dynamic-string
/// 32-byte head boundary and matches GitHub's practical handle ceiling.
const USERNAME_MIN_LEN: usize = 3;
const USERNAME_MAX_LEN: usize = 30;

/// Validate `name` against the username charset / length rules. Reverts on
/// failure with a tag that identifies which rule fired — the frontend maps
/// these to inline copy ("username too short", etc.).
///
/// Rules:
///   - length in [USERNAME_MIN_LEN, USERNAME_MAX_LEN]
///   - charset: ASCII a-z (lowercase), digits 0-9, ASCII hyphen '-'
///   - no leading or trailing hyphen
///   - no consecutive hyphens (mirrors DNS label form, avoids `--`
///     look-alikes)
///
/// Names are stored verbatim, but `set_username` lowercases the input before
/// calling this — so an upstream `Alice` becomes `alice` and passes through
/// the a-z check. This function is the source of truth for what a valid
/// stored username looks like.
fn validate_username(name: &str) {
    let bytes = name.as_bytes();
    if bytes.len() < USERNAME_MIN_LEN {
        revert(b"UsernameTooShort");
    }
    if bytes.len() > USERNAME_MAX_LEN {
        revert(b"UsernameTooLong");
    }
    if bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' {
        revert(b"UsernameInvalidEdge");
    }
    let mut prev_dash = false;
    for &b in bytes {
        let ok = (b'a'..=b'z').contains(&b)
            || (b'0'..=b'9').contains(&b)
            || b == b'-';
        if !ok {
            revert(b"UsernameInvalidChar");
        }
        if b == b'-' && prev_dash {
            revert(b"UsernameDoubleDash");
        }
        prev_dash = b == b'-';
    }
}

/// Lowercase an ASCII string in place. Username storage is verbatim-as-typed,
/// but validation + the uniqueness key live in lowercase, so we normalize on
/// every write path. A `name` containing non-ASCII bytes would fail charset
/// validation regardless, so a byte-wise add-0x20 is safe.
fn lowercase_ascii(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for &b in name.as_bytes() {
        let lower = if (b'A'..=b'Z').contains(&b) { b + 32 } else { b };
        out.push(lower as char);
    }
    out
}

/// Returns true if caller is the domain owner, the sudo admin, or an admin.
///
/// Owner-only by design. `unpublish` / `set_visibility` and any future
/// destructive call site gate on this so a dev publisher (e.g. Alice from
/// the CLI's dev-mode flow) CANNOT permanently delete a user-owned app or
/// flip its visibility. The publisher branch lives separately in
/// `is_authorized_to_republish` and is only consumed by `publish`.
fn is_authorized(domain: &String) -> bool {
    let caller = caller();
    if let Some(info) = Storage::info().get(domain) {
        if info.owner == caller {
            return true;
        }
    }
    is_sudo_or_admin(&caller)
}

/// Like `is_authorized`, but also accepts the original publisher. Used
/// exclusively by `publish` for re-deploys, so a dev signer (Alice) can
/// keep iterating on an app whose ownership was assigned to the user's
/// H160 via the `owner` parameter of the first `publish`. Re-publish
/// preserves the stored owner + publisher, so the only side effect
/// available to a publisher is updating `metadata_uri` and `visibility`
/// — they cannot rewrite ownership or unpublish.
///
/// Note: this is asymmetric across signer modes. An app first published
/// in phone mode (caller = user H160, publisher = user H160) CANNOT be
/// re-published from dev mode (caller = Alice, publisher = user H160) —
/// Alice is neither owner nor publisher of that record, so the
/// `Unauthorized` revert fires. The phone-first lock-in is intentional:
/// once a user "owns" an app from their phone, a shared dev key
/// shouldn't be able to touch it. To iterate on a phone-published app
/// in dev mode, the user must unpublish from phone mode first.
fn is_authorized_to_republish(domain: &String) -> bool {
    let caller = caller();
    if let Some(info) = Storage::info().get(domain) {
        if info.owner == caller || info.publisher == caller {
            return true;
        }
    }
    is_sudo_or_admin(&caller)
}

/// Returns true if the address is the sudo account or in the admins list.
fn is_sudo_or_admin(addr: &Address) -> bool {
    is_sudo(addr) || Storage::admins().get(addr.as_fixed_bytes()).unwrap_or(false)
}

fn is_sudo(addr: &Address) -> bool {
    Storage::sudo().get().map_or(false, |s| s == *addr)
}

fn require_sudo() {
    if !is_sudo(&caller()) {
        revert(b"Unauthorized");
    }
}

fn require_unfrozen() {
    if Storage::frozen().get().unwrap_or(false) {
        revert(b"Frozen");
    }
}

/// Single-entry replay used by both `import_app` and `import_apps`. The
/// sudo gate is asserted by the caller. Idempotent per domain: no-op when
/// the domain already exists; reverts on invalid visibility so callers
/// catch bad input early rather than silently dropping rows.
///
/// Awards `DEPLOY_XP` to the imported owner when the owner's `owner_app_count`
/// is within `DEPLOY_REWARD_COUNT` (first two imports per owner pay the
/// launch reward, the rest pay 0 — matching what a fresh `publish()` would
/// have produced). The `is_moddable` argument is preserved on the ABI for
/// callers but no longer changes the award (#286 dropped the moddable bonus).
/// Sudo should call `import_points` after the bulk import to overwrite totals
/// when exact pre-migration scores are needed.
fn import_one(
    domain: &String,
    owner: Address,
    publisher: Address,
    visibility: u8,
    metadata_uri: &String,
    is_moddable: bool,
) {
    let _ = is_moddable;
    if visibility > MAX_VISIBILITY {
        revert(b"InvalidVisibility");
    }
    if Storage::info().contains(domain) {
        return;
    }
    let owner_bytes = *owner.as_fixed_bytes();
    let owner_count = append_app_indices(domain, &owner_bytes);
    Storage::info().insert(domain, &AppInfo { owner, visibility, publisher });
    Storage::metadata_uri().insert(domain, metadata_uri);

    // Mirror publish(): only award when the migrated app lands on the
    // playground (visibility == PUBLIC) and the owner is still within
    // their first DEPLOY_REWARD_COUNT slots. Goes through `try_award` so a
    // known dev-signer H160 (e.g. carried over from a prior registry's
    // owner field) still respects the blacklist on replay. On successful
    // award we set `launch_awarded` so a subsequent re-publish of the same
    // domain in the new registry cannot re-earn.
    if visibility >= VISIBILITY_PUBLIC
        && owner_count <= DEPLOY_REWARD_COUNT
        && try_award(owner, DEPLOY_XP)
    {
        Storage::launch_awarded().insert(domain, &true);
    }
}

/// Append a new app to the global and per-owner indexes. Returns the owner's
/// new app count (post-increment) so callers can gate award logic without a
/// second storage read. Assumes the domain is not already registered.
fn append_app_indices(domain: &String, owner_bytes: &[u8; 20]) -> u32 {
    let count = Storage::app_count().get().unwrap_or(0);
    Storage::domain_at().insert(&count, domain);
    Storage::index_of().insert(domain, &count);
    Storage::app_count().set(&(count + 1));
    append_owner_app_index(domain, owner_bytes)
}

/// Append a domain to a specific owner's index. Used both during fresh
/// publish and during cross-owner republish where the global `domain_at`
/// slot is reused (preserving the domain's stable identifier) but the new
/// owner needs its own MyApps entry. Also records the permanent
/// `owner_list_member` marker so the re-claim branch in `publish` never
/// appends the same domain to the same owner's list twice.
/// Returns the new `owner_app_count` (post-increment) so callers can gate
/// award logic on slot number without a second storage read.
fn append_owner_app_index(domain: &String, owner_bytes: &[u8; 20]) -> u32 {
    let owner_count = Storage::owner_app_count().get(owner_bytes).unwrap_or(0);
    Storage::owner_domain_at().insert(&(*owner_bytes, owner_count), domain);
    Storage::owner_index_of().insert(domain, &owner_count);
    Storage::owner_list_member().insert(&(*owner_bytes, domain.clone()), &true);
    let new_count = owner_count + 1;
    Storage::owner_app_count().insert(owner_bytes, &new_count);
    new_count
}

/// Add a domain to the pinned list. Assumes the domain is not already pinned.
fn add_to_pinned(domain: &String) {
    let count = Storage::pinned_count().get().unwrap_or(0);
    Storage::pinned_at().insert(&count, domain);
    Storage::pinned_index_of().insert(domain, &count);
    Storage::pinned_count().set(&(count + 1));
}

/// Remove a domain from the pinned index, shifting subsequent entries down.
/// Emits `Unpinned` when the domain was actually pinned. No-op if not pinned.
fn remove_from_pinned(domain: &String) {
    let idx = match Storage::pinned_index_of().get(domain) {
        Some(i) => i,
        None => return,
    };
    let count = Storage::pinned_count().get().unwrap_or(0);
    // Shift entries down to fill the gap
    for i in idx..(count - 1) {
        if let Some(next_domain) = Storage::pinned_at().get(&(i + 1)) {
            Storage::pinned_at().insert(&i, &next_domain);
            Storage::pinned_index_of().insert(&next_domain, &i);
        }
    }
    Storage::pinned_at().remove(&(count - 1));
    Storage::pinned_index_of().remove(domain);
    Storage::pinned_count().set(&(count - 1));
    emit_event(b"Unpinned", domain);
}

#[pvm::storage]
struct Storage {
    // --- Context ---
    context_id: ContextId,

    // --- Global index (Recents / All) ---
    app_count: u32,
    domain_at: Mapping<u32, String>,

    // --- Per-owner index (My Apps) ---
    /// `owner -> lifetime slot count` for `owner_domain_at`. Never
    /// decremented: per-owner lists are append-only (tombstones included),
    /// and the deploy-reward gate in `publish` relies on the lifetime
    /// count so unpublishing can't reset the first-two-deploys cap.
    owner_app_count: Mapping<[u8; 20], u32>,
    /// `(owner, slot) -> domain`. Append-only per owner; entries are NEVER
    /// removed or compacted. When a domain is unpublished and later
    /// re-claimed by a DIFFERENT owner, the previous owner's entry is left
    /// in place as a TOMBSTONE and the domain is appended to the new
    /// owner's list (see the re-claim branch in `publish`). Attribution
    /// therefore follows the current `info.owner`, never bare list
    /// membership: `get_owner_domain_at` hides slots whose domain is
    /// currently owned by someone else, and `get_point_breakdown` only
    /// counts domains whose `info.owner` matches the queried account.
    owner_domain_at: Mapping<([u8; 20], u32), String>,
    /// `(owner, domain) -> true` once `domain` has EVER been appended to
    /// `owner`'s list above. Permanent (never cleared) — the membership
    /// test for the cross-owner re-claim branch in `publish`, which must
    /// not append a duplicate when an owner re-claims a domain already in
    /// their (possibly tombstoned) list. `owner_index_of` cannot answer
    /// this: it is keyed by domain only, so the slot it stores is
    /// meaningless without knowing whose list it indexes.
    owner_list_member: Mapping<([u8; 20], String), bool>,

    // --- Reverse index (domain → slot) ---
    index_of: Mapping<String, u32>,
    /// `domain -> slot in the CURRENT owner's per-owner list` (repointed by
    /// `append_owner_app_index` on a cross-owner re-claim). Keyed by domain
    /// only — recovering WHOSE list the slot indexes requires the current
    /// `info.owner`. Survives `unpublish`. Currently write-mostly: the
    /// publish re-claim branch tests membership via `owner_list_member`
    /// instead, precisely because this map can't distinguish owners.
    owner_index_of: Mapping<String, u32>,

    // --- Domain data ---
    metadata_uri: Mapping<String, String>,
    info: Mapping<String, AppInfo>,

    // --- Admin ---
    sudo: Address,
    admins: Mapping<[u8; 20], bool>,

    // --- Pinned apps ---
    pinned_count: u32,
    pinned_at: Mapping<u32, String>,
    pinned_index_of: Mapping<String, u32>,

    // --- Migration ---
    frozen: bool,

    // --- System contracts ---
    reputation: Address,

    // --- Points + leaderboard ---
    /// Single running total per scoring account. Eviction on score == 0.
    /// Per-bucket breakdown (launch / mod / star) is derived in
    /// `get_point_breakdown` from the per-domain counters below.
    account_points: Mapping<Address, u128>,
    /// B-tree sorted by `u128::MAX - score` so `range(0, N)` returns the
    /// top N in descending-score order. Value is the account; duplicates
    /// allowed (ties broken internally by insertion nonce).
    ///
    /// T=3, not T=4. With K=u128 + V=Address (20-byte H160) + 8-byte nonce,
    /// a T=4 internal node packs 7 entries plus 8 child links and busts
    /// the 416-byte `MAX_STORAGE_VALUE_BYTES` cap — verified empirically
    /// (`OrderedIndexNodeTooLarge` reverts at ~31 inserted rows). T=3
    /// packs at most 5 entries + 6 children and survives 240+ rows.
    points_index: OrderedIndex<u128, Address, 3>,
    /// `account -> insertion nonce` of its live `points_index` entry.
    /// Written on every insert, consumed by `remove_by_nonce` so entry
    /// removal stays O(log n) regardless of score ties. Removed when the
    /// account is evicted from the leaderboard (`set_points` to 0).
    points_nonce: Mapping<Address, u64>,
    // --- Mod tracking (no persisted modded_from link) ---
    /// `domain -> # of unique modders who have published a mod of it`.
    mod_count: Mapping<String, u32>,
    /// `(modder, source_domain) -> already credited?`. Per-modder dedupe
    /// so the same account modding the same source twice can't double-
    /// credit the source's owner.
    mod_credited: Mapping<(Address, String), bool>,
    /// Domains sorted by `u32::MAX - mod_count`, value is the domain's
    /// stable slot in `domain_at`. Fixed-size (u32, u32) entries keep the
    /// `OrderedIndex` B-tree nodes bounded; reads dereference each
    /// `domain_idx` back to its current domain via `domain_at`.
    mod_index: OrderedIndex<u32, u32, 4>,
    /// `domain slot -> insertion nonce` of its live `mod_index` entry.
    /// See `points_nonce` for the rationale.
    mod_nonce: Mapping<u32, u64>,

    // --- Stars ---
    /// `domain -> cumulative star count`. Decremented on unstar.
    star_count: Mapping<String, u32>,
    /// `(voter, domain) -> currently starred?`. Toggle state for the
    /// star/unstar pair; absent or false both mean "not currently starred".
    star_given: Mapping<(Address, String), bool>,
    /// `(voter, domain) -> star XP already paid?`. PERMANENT award dedupe,
    /// same pattern as `launch_awarded` / `username_bonus_awarded` /
    /// `mod_credited`: set the first time this voter's star pays the
    /// domain owner and NEVER cleared — not in `unstar`, not in
    /// `unpublish`. Star XP is one-way (no refund on unstar), so gating
    /// the award on the removable `star_given` toggle alone would let a
    /// star → unstar → star loop re-mint STAR_RECEIVED_XP forever.
    star_awarded: Mapping<(Address, String), bool>,
    /// Domains sorted by `u32::MAX - star_count`, value is the domain's
    /// permanent slot in `domain_at`. See `mod_index` for the rationale.
    star_index: OrderedIndex<u32, u32, 4>,
    /// `domain slot -> insertion nonce` of its live `star_index` entry.
    /// See `points_nonce` for the rationale.
    star_nonce: Mapping<u32, u64>,

    // --- Points blacklist ---
    /// Addresses that can never earn points. Populated by sudo with the
    /// well-known dev signers (bulletin-deploy DEFAULT_MNEMONIC bare-root,
    /// Substrate //Alice) and any custom `--suri` mnemonics the team uses
    /// for testing. When a recipient is in this set, `award_points` is a
    /// no-op and the matching events are NOT emitted — so the leaderboard
    /// won't surface a dev key, and the frontend won't refresh chasing a
    /// non-change.
    blacklisted: Mapping<Address, bool>,

    /// Set to true the FIRST time launch points are awarded for a domain,
    /// and never cleared. Survives `unpublish()` (which removes `info` but
    /// must not refund the original launch reward). Subsequent publishes of
    /// the same domain (even after unpublish, even by a different owner)
    /// skip the launch + mod-credit award path entirely — without this
    /// marker, a user could publish → +3 → unpublish → publish → +3 again
    /// and farm the leaderboard with one domain.
    launch_awarded: Mapping<String, bool>,

    // --- Usernames ---
    /// Optional display name claimed by an account. Empty / absent ⇒ no name
    /// set; clients fall back to the H160. Set / changed via `set_username`,
    /// cleared via `clear_username`. Validated on write (see
    /// `validate_username`). Stored in the lowercased / normalized form
    /// returned by `lowercase_ascii` — uniqueness is case-insensitive, so
    /// `Alice` and `alice` are the same name on chain and clients see
    /// `alice` from `get_username`. Future revision: add a separate field
    /// for the display-cased version if the UX wants to echo the chosen
    /// casing.
    usernames: Mapping<Address, String>,
    /// Reverse index for uniqueness. `name -> claimant` while the name is
    /// claimed; removed when the owner renames or clears, so a subsequent
    /// claimant can take the freed name. Keys are the same lowercase form
    /// as `usernames` values, so the two stay in lock-step.
    username_to_owner: Mapping<String, Address>,

    /// Set to true the FIRST time `set_username` successfully credits an
    /// account with `USERNAME_BONUS_XP` and never cleared. Renaming or
    /// clearing the username does NOT clear this flag — the bonus is once
    /// per account, ever. Survives a `clear_username` → `set_username`
    /// cycle so users can't farm the bonus by cycling names.
    username_bonus_awarded: Mapping<Address, bool>,

    // --- Mod lineage (constellation display) ---
    /// Number of recorded lineage edges. Index space for `lineage_at`.
    lineage_count: u32,
    /// Append-only list of mod edges, `index -> LineageEdge { child, source }`.
    /// Written once per child; never mutated or removed.
    lineage_at: Mapping<u32, LineageEdge>,
    /// `child domain -> already recorded?`. Guards a duplicate edge across
    /// re-entry (publish→unpublish→publish) and `import_lineage` re-runs.
    lineage_recorded: Mapping<String, bool>,
}

// Compile-time shape checks: a full B-tree node for each index must fit the
// 416-byte storage-value cap, otherwise inserts revert at runtime with
// `OrderedIndexNodeTooLarge`. Key/value sizes are max encoded bytes:
// u128 = 16, Address (H160) = 20, u32 = 4.
const _: () = assert!(OrderedIndex::<u128, Address, 3>::fits_storage_limit(16, 20));
const _: () = assert!(OrderedIndex::<u32, u32, 4>::fits_storage_limit(4, 4));

#[pvm::contract(cdm = "@w3s/playground-registry")]
mod playground_registry {
    use super::*;

    /// Operator registration on @polkadot/contexts is an off-chain step
    /// (scripts/register-context.ts) — migration only needs the EOA owner
    /// to add/remove operators, so this constructor stays inert wrt the
    /// namespace's ownership.
    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        let mut context_id: ContextId = [0u8; 32];
        pvm::api::hash_keccak_256(PLAYGROUND_CONTEXT_LABEL, &mut context_id);

        Storage::context_id().set(&context_id);
        Storage::reputation().set(&reputation::Reputation::cdm_lookup().address());
        Storage::sudo().set(&caller());

        Ok(())
    }

    /// Publish or update an app entry.
    ///
    /// `owner` is the H160 recorded as the app owner and used as the key
    /// for the per-owner index (MyApps). When `None`, defaults to the
    /// caller. Callers pass `Some(user_h160)` from dev-mode CLI flows
    /// where the actual signer is a shared dev key but the app should
    /// show under the user's MyApps in the playground frontend.
    ///
    /// `owner` only takes effect on the FIRST publish for a domain. On
    /// re-publish the stored `owner` and `publisher` are preserved (the
    /// only mutable fields are `visibility` and `metadata_uri`).
    ///
    /// `modded_from` records the source app for the mod-credit award. Not
    /// persisted on-chain — used transiently to look up the source's owner,
    /// dedupe via `mod_credited`, and credit +1 point. Pass `Some(parent)`
    /// when the calling CLI/UI knows this publish is a mod (e.g. `dot mod`
    /// captured the source in `dot.json`); pass `None` otherwise.
    ///
    /// `is_moddable` declares this app as open to being modded. Unlocks the
    /// +1 moddable point on first publish. Callers set this from the
    /// metadata's `repository` field (public GitHub URL => moddable).
    ///
    /// `is_dev_signer` is set true by the CLI when `dot deploy` is run
    /// against a dev/`--suri` signer (Alice, bulletin-deploy's bare-root,
    /// or any custom test mnemonic). When true, ALL point awards in this
    /// call (launch + mod credit) are suppressed so dev keys never land
    /// on the leaderboard. Phone-mode publishes from real users always
    /// pass false. The sudo-managed `blacklisted` map is a second line
    /// of defense for callers that lie or bypass the flag.
    ///
    /// Points (only when visibility=PUBLIC and `!is_dev_signer`):
    ///   DEPLOY_XP to the owner, only when the domain has NEVER been
    ///   published before (a domain that ever existed — even since
    ///   unpublished — never re-awards) and only for the owner's first
    ///   DEPLOY_REWARD_COUNT such deploys (3rd+ = 0); plus MOD_RECEIVED_XP
    ///   to the `modded_from` source's owner if the source exists, is not
    ///   self-owned, and this (caller, source) pair hasn't been credited
    ///   before.
    /// Re-publishes award nothing — prevents republish-loop farming.
    #[pvm::method]
    pub fn publish(
        domain: String,
        metadata_uri: String,
        visibility: u8,
        owner: Option<Address>,
        // `Option<String>` was originally used here, but the on-chain SolAbi
        // decoder (`pvm_contract::abi::Option<T> for T: IS_DYNAMIC`) declares
        // a 64-byte head while viem (the TS SDK encoder) writes only a
        // 32-byte offset slot for a dynamic tuple — shifting every later
        // param by 32 bytes and silently corrupting `is_moddable` /
        // `is_dev_signer`. Plain `String` with `""` as the "no source"
        // sentinel sidesteps the bug entirely.
        modded_from: String,
        is_moddable: bool,
        is_dev_signer: bool,
    ) {
        require_unfrozen();
        if visibility > MAX_VISIBILITY {
            revert(b"InvalidVisibility");
        }
        if metadata_uri.is_empty() {
            revert(b"EmptyMetadataUri");
        }
        if !modded_from.is_empty() && modded_from == domain {
            revert(b"InvalidModdedFrom");
        }
        let caller = caller();

        // Captured BEFORE the match so the post-write award branch knows
        // whether this is a first publish (the only time points are awarded).
        let is_new_app = !Storage::info().contains(&domain);

        // Captured BEFORE any slot allocation below: true iff this domain has
        // NEVER been published, by anyone. `unpublish` clears `info` but
        // preserves `index_of`, so a freed-and-re-claimed domain is NOT
        // truly fresh — the launch-award gate below requires this flag, so a
        // domain that ever existed never re-earns launch XP.
        let truly_fresh = !Storage::index_of().contains(&domain);

        // Owner's `owner_app_count` AFTER this publish's index append, captured
        // in the new-app branch so the deploy-reward gate below doesn't need
        // a second storage read. Stays 0 on republish and on re-claims that
        // don't append; the award gate also requires `truly_fresh`, so the
        // value only matters for genuinely fresh domains (where it is always
        // >= 1, the post-increment slot number).
        let mut new_owner_app_count: u32 = 0;

        match Storage::info().get(&domain) {
            Some(existing) => {
                if !is_authorized_to_republish(&domain) {
                    revert(b"Unauthorized");
                }
                // If changing to private, auto-unpin
                if visibility == VISIBILITY_PRIVATE {
                    remove_from_pinned(&domain);
                }
                // Preserve owner + publisher: ownership is immutable after
                // first publish to block hostile rewrites.
                Storage::info().insert(&domain, &AppInfo {
                    owner: existing.owner,
                    visibility,
                    publisher: existing.publisher,
                });
            }
            None => {
                let effective_owner = owner.unwrap_or(caller);
                let owner_bytes = *effective_owner.as_fixed_bytes();
                if truly_fresh {
                    new_owner_app_count = append_app_indices(&domain, &owner_bytes);
                } else {
                    // Re-claim of a previously-published domain. The global
                    // `domain_at` slot stays put (preserves social-index
                    // entries), but MyApps attribution must follow the NEW
                    // owner. Membership is tested via the permanent
                    // `owner_list_member` map — NOT via `owner_index_of`,
                    // which is keyed by domain only and survives
                    // `unpublish`: its presence says nothing about WHOSE
                    // list holds the slot, so the old
                    // `!owner_index_of().contains()` guard was dead code and
                    // a cross-owner re-claim left the domain attributed to
                    // the previous owner. (Comparing
                    // `owner_domain_at((new_owner, slot))` instead would
                    // mis-answer after an X → Y → X re-claim ping-pong and
                    // duplicate the domain in X's list — the membership map
                    // is exact.) The previous owner's `owner_domain_at`
                    // entry is left behind as a tombstone; readers filter by
                    // the current `info.owner` (see the field docs). No
                    // launch XP is at stake either way: the award gate below
                    // requires `truly_fresh`.
                    let already_in_owner_list = Storage::owner_list_member()
                        .get(&(owner_bytes, domain.clone()))
                        .unwrap_or(false);
                    if !already_in_owner_list {
                        new_owner_app_count = append_owner_app_index(&domain, &owner_bytes);
                    }
                }
                Storage::info().insert(&domain, &AppInfo {
                    owner: effective_owner,
                    visibility,
                    publisher: caller,
                });
            }
        }

        Storage::metadata_uri().insert(&domain, &metadata_uri);
        emit_event(b"Published", &domain);

        if !is_new_app {
            return;
        }

        // --- Mod lineage (constellation display) ---
        // Record the source→child edge exactly once for any genuinely-new app
        // that declares a non-empty `modded_from` whose source exists. This is
        // INDEPENDENT of the XP award / dedupe / dev-signer gating below, so the
        // visual family tree is complete (includes dev-mode + cross-owner mods).
        // Re-publishes never reach here (is_new_app returned early above);
        // `lineage_recorded` guards any future re-entry. No new user-signed tx:
        // this runs inside the existing publish call.
        if !modded_from.is_empty()
            && Storage::info().contains(&modded_from)
            && !Storage::lineage_recorded().get(&domain).unwrap_or(false)
        {
            let idx = Storage::lineage_count().get().unwrap_or(0);
            Storage::lineage_at().insert(&idx, &LineageEdge {
                child: domain.clone(),
                source: modded_from.clone(),
            });
            Storage::lineage_count().set(&(idx.saturating_add(1)));
            Storage::lineage_recorded().insert(&domain, &true);
        }

        // Block reward re-issuance for any domain that has previously
        // received a launch award — prevents publish → unpublish → publish
        // farming. `launch_awarded` is set on the first successful award
        // and persists through unpublish, so a stale-but-rewarded domain
        // stays locked out forever, even after a new owner re-claims it.
        if Storage::launch_awarded().get(&domain).unwrap_or(false) {
            return;
        }

        // First publish of a new domain — award the deploy-class points to
        // the recorded owner (so dev-mode publishes credit the user, not the
        // shared dev signer). `info.owner` was set above.
        let owner_addr = match Storage::info().get(&domain) {
            Some(i) => i.owner,
            None => return,
        };

        // Launch award rule (#286 / #288): launch XP is paid ONLY for
        // never-before-published domains (`truly_fresh`), and only for the
        // owner's first DEPLOY_REWARD_COUNT public, non-dev-signer deploys
        // (3rd+ = 0). A domain that ever existed — even one unpublished and
        // re-claimed — never re-awards. `truly_fresh` is load-bearing: a
        // re-claimed domain skips the index-append branches, leaving
        // `new_owner_app_count` at 0, which would otherwise satisfy the
        // `<= DEPLOY_REWARD_COUNT` slot check regardless of how many apps
        // the owner already launched (the unpublish → republish cap
        // bypass). The moddable bonus is gone; `is_moddable` stays on the
        // ABI for callers but no longer changes the award amount.
        let _ = is_moddable;
        if truly_fresh
            && visibility >= VISIBILITY_PUBLIC
            && !is_dev_signer
            && new_owner_app_count <= DEPLOY_REWARD_COUNT
            && try_award(owner_addr, DEPLOY_XP)
        {
            Storage::launch_awarded().insert(&domain, &true);
            emit_typed_event(b"DeployPointAwarded", &PointAwardEvent {
                recipient: owner_addr,
                domain: domain.clone(),
            });
        }

        // Mod credit. The self-mod guard compares OWNERS (so dev-mode
        // publishes — where the same real user signs as Alice but records
        // herself as owner_addr — still block self-modding).
        //
        // Dedupe, however, keys on CALLER, not owner_addr. owner_addr is a
        // soft hint the caller passes in `owner`; trusting it for dedupe
        // would let a single signer publish N mods of the same source with
        // N different throwaway H160s as `owner` and collect N credits for
        // what is really one (signer, source) pair.
        //
        // Scope of the guarantee (per src/xpValues.ts): exactly one
        // MOD_RECEIVED_XP credit per unique (caller, source_domain) pair —
        // that is the spec'd award unit, nothing more. It does NOT bound a
        // recipient's total mod XP: source domains are free to mint, so an
        // owner can stand up many sources (or modders can spread mods
        // across them) and each fresh pair pays again. That economy-level
        // exposure is accepted in xpValues.ts; the only Sybil bound on
        // callers is PoP account scarcity at the mobile layer.
        //
        // Dev-signer publishes do not award the mod credit either —
        // gating the inner `try_award` on is_dev_signer keeps the dev
        // out of the event stream while the social tracking
        // (mod_count, mod_credited) is recorded unconditionally.
        if !modded_from.is_empty() {
            let src = modded_from;
            if let Some(src_info) = Storage::info().get(&src) {
                if src_info.owner != owner_addr {
                    let dedupe_key = (caller, src.clone());
                    let already = Storage::mod_credited().get(&dedupe_key).unwrap_or(false);
                    if !already {
                        Storage::mod_credited().insert(&dedupe_key, &true);
                        let cur = Storage::mod_count().get(&src).unwrap_or(0);
                        let src_idx = match Storage::index_of().get(&src) {
                            Some(i) => i,
                            None => revert(b"DomainNotIndexed"),
                        };
                        set_mod_count(&src, src_idx, cur.saturating_add(1));
                        // Social tracking (mod_count, mod_credited) records
                        // unconditionally so dev modders still count as
                        // "unique modders". Award + event gated by
                        // !is_dev_signer and the blacklist.
                        if !is_dev_signer && try_award(src_info.owner, MOD_RECEIVED_XP) {
                            emit_typed_event(b"ModPointAwarded", &ModPointEvent {
                                recipient: src_info.owner,
                                source_domain: src,
                                modder: owner_addr,
                                mod_domain: domain,
                            });
                        }
                    }
                }
            }
        }
    }

    /// Remove an app from the registry. Caller must be domain owner or sudo.
    #[pvm::method]
    pub fn unpublish(domain: String) {
        require_unfrozen();
        if !is_authorized(&domain) {
            revert(b"Unauthorized");
        }
        // Mark as unpublished by clearing only `info` + `metadata_uri` +
        // pin status. `domain_at`, `index_of`, `owner_domain_at`,
        // `owner_index_of`, `owner_list_member`, `star_count`, and
        // `mod_count` are preserved so social-index entries holding `idx`
        // remain valid through any future republish (see the `None` branch
        // in `publish`). The permanent award markers (`launch_awarded`,
        // `star_awarded`, `mod_credited`) are also intentionally preserved:
        // unpublish never refunds XP, so clearing them would re-arm the
        // corresponding one-shot awards.
        Storage::metadata_uri().remove(&domain);
        Storage::info().remove(&domain);
        remove_from_pinned(&domain);
        emit_event(b"Unpublished", &domain);
    }

    /// Rate an app. Rating uses the full u8 range (frontend maps 1-5 stars via factor of 51).
    #[pvm::method]
    pub fn rate_app(domain: String, rating: u8, comment_uri: String) {
        require_unfrozen();
        if !Storage::info().contains(&domain) {
            revert(b"AppNotFound");
        }

        let context_id = match Storage::context_id().get() {
            Some(id) => id,
            None => revert(b"ContextIdNotSet"),
        };
        let rep = match Storage::reputation().get() {
            Some(addr) => reputation::Reputation::from_address(addr),
            None => revert(b"ReputationNotInitialized"),
        };

        let entity = domain_to_entity(&domain);
        if let Err(_) = rep.submit_review(context_id, caller(), entity, rating, comment_uri) {
            revert(b"SubmitReviewFailed");
        }
        emit_event(b"Rated", &domain);
    }

    /// Remove a review. Caller must be the reviewer or sudo.
    #[pvm::method]
    pub fn remove_rating(domain: String, reviewer: Address) {
        require_unfrozen();
        if !Storage::info().contains(&domain) {
            revert(b"AppNotFound");
        }

        let c = caller();
        let is_reviewer = c == reviewer;
        if !is_reviewer && !is_sudo_or_admin(&c) {
            revert(b"Unauthorized");
        }

        let context_id = match Storage::context_id().get() {
            Some(id) => id,
            None => revert(b"ContextIdNotSet"),
        };
        let rep = match Storage::reputation().get() {
            Some(addr) => reputation::Reputation::from_address(addr),
            None => revert(b"ReputationNotInitialized"),
        };

        let entity = domain_to_entity(&domain);
        if let Err(_) = rep.delete_review(context_id, reviewer, entity) {
            revert(b"DeleteReviewFailed");
        }
        emit_event(b"RatingRemoved", &domain);
    }

    // --- Stars (toggle; XP is one-way: first star per (voter, domain)
    //     pays STAR_RECEIVED_XP once, ever — no refund, no re-award) ---

    /// Star an app. The FIRST star from a given voter on a given domain
    /// awards STAR_RECEIVED_XP to the app's owner — once, ever, tracked
    /// by the permanent `star_awarded` marker. Re-starring after an
    /// unstar still toggles `star_given` and the counts but awards
    /// nothing (star XP is one-way; `unstar` does not refund). Caller
    /// cannot star their own app (`SelfStarForbidden`) and cannot star
    /// the same app twice without unstarring (`AlreadyStarred`). The
    /// dedupe is on the caller's H160, so upstream PoP-gated account
    /// scarcity is the Sybil bound.
    #[pvm::method]
    pub fn star(domain: String) {
        require_unfrozen();
        let info = match Storage::info().get(&domain) {
            Some(i) => i,
            None => revert(b"AppNotFound"),
        };
        let voter = caller();
        if voter == info.owner {
            revert(b"SelfStarForbidden");
        }
        let key = (voter, domain.clone());
        let already = Storage::star_given().get(&key).unwrap_or(false);
        if already {
            revert(b"AlreadyStarred");
        }
        Storage::star_given().insert(&key, &true);
        let cur = Storage::star_count().get(&domain).unwrap_or(0);
        // index_of must be populated — domain is in `info`, so it had to
        // go through `publish` which assigned a slot.
        let idx = match Storage::index_of().get(&domain) {
            Some(i) => i,
            None => revert(b"DomainNotIndexed"),
        };
        set_star_count(&domain, idx, cur.saturating_add(1));
        // Permanent award dedupe (mirrors `launch_awarded` /
        // `username_bonus_awarded`): pay the owner only the FIRST time this
        // voter stars this domain. Star XP is one-way (#286: no refund on
        // unstar), so gating the award on the removable `star_given` toggle
        // alone would let star → unstar → star re-mint STAR_RECEIVED_XP
        // forever. The marker is set BEFORE the award call (so even a
        // blacklisted voter's star permanently consumes the one-shot) and
        // is never cleared — not in `unstar`, not in `unpublish`. Same
        // (voter, domain) key construction as `star_given` above.
        let already_awarded = Storage::star_awarded().get(&key).unwrap_or(false);
        if !already_awarded {
            Storage::star_awarded().insert(&key, &true);
            // Social tracking above always lands; point award + event gated
            // by the blacklist.
            if try_award(info.owner, STAR_RECEIVED_XP) {
                emit_typed_event(b"StarPointAwarded", &StarPointEvent {
                    recipient: info.owner,
                    domain,
                    voter,
                });
            }
        }
    }

    /// Remove a star previously given by the caller. Decrements `star_count`
    /// and clears the `(voter, domain)` dedupe entry. XP is NOT refunded
    /// (#287 / #286: star is one-way — the owner's score only goes up).
    /// Reverts if the caller had not starred the app.
    #[pvm::method]
    pub fn unstar(domain: String) {
        require_unfrozen();
        // `info` is still needed for the AppNotFound revert (parallels star()).
        if !Storage::info().contains(&domain) {
            revert(b"AppNotFound");
        }
        let voter = caller();
        let key = (voter, domain.clone());
        let already = Storage::star_given().get(&key).unwrap_or(false);
        if !already {
            revert(b"NotStarred");
        }
        Storage::star_given().remove(&key);
        let cur = Storage::star_count().get(&domain).unwrap_or(0);
        let idx = match Storage::index_of().get(&domain) {
            Some(i) => i,
            None => revert(b"DomainNotIndexed"),
        };
        set_star_count(&domain, idx, cur.saturating_sub(1));
        // No XP refund and no event: star XP is one-way (#286/#287). The
        // permanent `star_awarded` marker is intentionally NOT cleared here,
        // so a later re-star toggles `star_given`/counts but pays nothing.
        // The `voter` binding stays because `caller()` still drives the
        // dedupe key above.
        let _ = voter;
    }

    // --- Context ---

    #[pvm::method]
    pub fn get_context_id() -> ContextId {
        Storage::context_id().get().unwrap_or([0u8; 32])
    }

    // --- Global queries ---

    #[pvm::method]
    pub fn get_app_count() -> u32 {
        Storage::app_count().get().unwrap_or(0)
    }

    #[pvm::method]
    pub fn get_domain_at(index: u32) -> Option<String> {
        Storage::domain_at().get(&index)
    }

    // --- Per-owner queries ---

    #[pvm::method]
    pub fn get_owner_app_count(owner: Address) -> u32 {
        Storage::owner_app_count().get(owner.as_fixed_bytes()).unwrap_or(0)
    }

    /// Raw slot read for an owner's MyApps list. Per-owner lists are
    /// append-only with tombstones: a slot whose domain has since been
    /// re-claimed by a DIFFERENT owner is hidden here (returns `None`) so
    /// pagination and attribution always follow the current `info.owner` —
    /// both frontends stamp the queried address as the entry's owner, so
    /// leaking a tombstone would show someone else's app under this owner.
    /// Slots whose domain is merely unpublished (no `info`) are still
    /// returned, matching prior behavior; callers already skip those via
    /// the missing `metadata_uri`.
    #[pvm::method]
    pub fn get_owner_domain_at(owner: Address, index: u32) -> Option<String> {
        let domain = Storage::owner_domain_at().get(&(*owner.as_fixed_bytes(), index))?;
        if let Some(info) = Storage::info().get(&domain) {
            if info.owner != owner {
                // Tombstone: re-claimed by another owner after unpublish.
                return None;
            }
        }
        Some(domain)
    }

    // --- Admin management ---

    #[pvm::method]
    pub fn get_sudo() -> Address {
        Storage::sudo().get().unwrap_or_default()
    }

    /// Add an address to the admins list. Sudo only.
    #[pvm::method]
    pub fn add_admin(admin: Address) {
        require_unfrozen();
        require_sudo();
        Storage::admins().insert(admin.as_fixed_bytes(), &true);
    }

    /// Remove an address from the admins list. Sudo only.
    #[pvm::method]
    pub fn remove_admin(admin: Address) {
        require_unfrozen();
        require_sudo();
        Storage::admins().remove(admin.as_fixed_bytes());
    }

    /// Check if an address is an admin.
    #[pvm::method]
    pub fn is_admin(addr: Address) -> bool {
        Storage::admins().get(addr.as_fixed_bytes()).unwrap_or(false)
    }

    // --- Points blacklist (defense-in-depth for the publish `is_dev_signer`
    //     flag — catches callers that lie or bypass the CLI) ---

    /// Add or remove one or more addresses from the points-blacklist. Sudo
    /// only. Blacklisted recipients silently no-op out of `award_points` —
    /// existing points are NOT cleared, only future awards are blocked.
    /// Pass a single-element vector for one-off changes; pass the full set
    /// when bootstrapping the list with known dev-signer H160s.
    #[pvm::method]
    pub fn set_blacklisted(accounts: Vec<Address>, value: bool) {
        require_unfrozen();
        require_sudo();
        for account in accounts {
            if value {
                Storage::blacklisted().insert(&account, &true);
            } else {
                Storage::blacklisted().remove(&account);
            }
        }
    }

    /// Public read: is this address blocked from earning points?
    #[pvm::method]
    pub fn is_blacklisted(account: Address) -> bool {
        Storage::blacklisted().get(&account).unwrap_or(false)
    }

    // --- Visibility ---

    /// Change the visibility of an app without re-uploading metadata.
    #[pvm::method]
    pub fn set_visibility(domain: String, visibility: u8) {
        require_unfrozen();
        if visibility > MAX_VISIBILITY {
            revert(b"InvalidVisibility");
        }
        if !is_authorized(&domain) {
            revert(b"Unauthorized");
        }
        let mut info = match Storage::info().get(&domain) {
            Some(i) => i,
            None => revert(b"AppNotFound"),
        };
        if visibility == VISIBILITY_PRIVATE {
            remove_from_pinned(&domain);
        }
        info.visibility = visibility;
        Storage::info().insert(&domain, &info);
        emit_event(b"VisibilityChanged", &domain);
    }

    /// Get the visibility of an app.
    #[pvm::method]
    pub fn get_visibility(domain: String) -> u8 {
        Storage::info()
            .get(&domain)
            .map(|i| i.visibility)
            .unwrap_or(VISIBILITY_PRIVATE)
    }

    // --- Pin management ---

    /// Pin an app to the top of the list. Admin or sudo only. App must be public.
    #[pvm::method]
    pub fn pin(domain: String) {
        require_unfrozen();
        if !is_sudo_or_admin(&caller()) {
            revert(b"Unauthorized");
        }
        let info = match Storage::info().get(&domain) {
            Some(i) => i,
            None => revert(b"AppNotFound"),
        };
        if info.visibility < VISIBILITY_PUBLIC {
            revert(b"CannotPinPrivateApp");
        }
        if Storage::pinned_index_of().contains(&domain) {
            revert(b"AlreadyPinned");
        }
        add_to_pinned(&domain);
        emit_event(b"Pinned", &domain);
    }

    /// Unpin an app. Admin or sudo only.
    #[pvm::method]
    pub fn unpin(domain: String) {
        require_unfrozen();
        if !is_sudo_or_admin(&caller()) {
            revert(b"Unauthorized");
        }
        if !Storage::pinned_index_of().contains(&domain) {
            revert(b"NotPinned");
        }
        remove_from_pinned(&domain);
        emit_event(b"Unpinned", &domain);
    }

    /// Check if an app is pinned.
    #[pvm::method]
    pub fn is_pinned(domain: String) -> bool {
        Storage::pinned_index_of().contains(&domain)
    }

    /// Return all pinned app entries (only public ones).
    #[pvm::method]
    pub fn get_pinned_apps() -> Vec<AppEntry> {
        let count = Storage::pinned_count().get().unwrap_or(0);
        let mut entries: Vec<AppEntry> = Vec::new();
        for i in 0..count {
            if let Some(domain) = Storage::pinned_at().get(&i) {
                if let Some(metadata_uri) = Storage::metadata_uri().get(&domain) {
                    let info = Storage::info().get(&domain);
                    let visibility = info.as_ref().map(|i| i.visibility).unwrap_or(VISIBILITY_PRIVATE);
                    if visibility < VISIBILITY_PUBLIC { continue; }
                    let owner = info.as_ref().map(|i| i.owner).unwrap_or_default();
                    let publisher = info.as_ref().map(|i| i.publisher).unwrap_or_default();
                    let idx = Storage::index_of().get(&domain).unwrap_or(0);
                    entries.push(AppEntry { index: idx, domain, metadata_uri, owner, visibility, publisher });
                }
            }
        }
        entries
    }

    // --- Paginated query ---

    /// Return a page of app entries starting at offset `start` (in reverse/newest-first order).
    /// Returns up to `count` entries. Includes public apps and the caller's own private apps.
    #[pvm::method]
    pub fn get_apps(start: u32, count: u32) -> AppsPage {
        let total = Storage::app_count().get().unwrap_or(0);
        let mut entries: Vec<AppEntry> = Vec::new();
        let mut scanned = 0u32;

        if total > 0 && start < total {
            let mut idx = total - 1 - start;
            loop {
                if entries.len() as u32 >= count || start + scanned >= total {
                    break;
                }
                if let Some(domain) = Storage::domain_at().get(&idx) {
                    if let Some(metadata_uri) = Storage::metadata_uri().get(&domain) {
                        let info = Storage::info().get(&domain);
                        let owner = info.as_ref().map(|i| i.owner).unwrap_or_default();
                        let publisher = info.as_ref().map(|i| i.publisher).unwrap_or_default();
                        let visibility = info.as_ref().map(|i| i.visibility).unwrap_or(VISIBILITY_PRIVATE);
                        // Read-side visibility check is owner-only: a private
                        // app is visible to its claimed owner, never to the
                        // (possibly shared) publisher account. Otherwise any
                        // reader using a dev-key origin (e.g. the CLI's
                        // read-only registry client which queries as Alice)
                        // would see every dev-mode private app published in
                        // the registry. Write-side auth in `is_authorized`
                        // is a separate concern.
                        if visibility >= VISIBILITY_PUBLIC || owner == caller() {
                            entries.push(AppEntry { index: idx, domain, metadata_uri, owner, visibility, publisher });
                        }
                    }
                }
                scanned += 1;
                if idx == 0 { break; }
                idx -= 1;
            }
        }

        AppsPage { total, scanned, entries }
    }

    /// Return a page of app entries ordered by `star_count` DESCENDING.
    /// `start` is an offset into `star_index`; `count` is the page size.
    /// `total` is `star_index.len()` — an upper bound on visible entries
    /// since the page filters out entries whose domain is currently
    /// unpublished (info absent) or private to a non-caller. `scanned` is
    /// the number of index entries the call consumed (= `count` when the
    /// index isn't exhausted); the caller advances pagination by
    /// `scanned`, not `entries.len()`.
    #[pvm::method]
    pub fn get_top_starred(start: u32, count: u32) -> AppsPage {
        let raw = Storage::star_index().range(
            Bound::Unbounded,
            Bound::Unbounded,
            start as u64,
            count as u64,
        );
        let total = Storage::star_index().len() as u32;
        index_page_to_apps(raw, total)
    }

    /// Return a page of app entries ordered by `mod_count` DESCENDING.
    /// Same shape and pagination semantics as `get_top_starred`.
    #[pvm::method]
    pub fn get_top_modded(start: u32, count: u32) -> AppsPage {
        let raw = Storage::mod_index().range(
            Bound::Unbounded,
            Bound::Unbounded,
            start as u64,
            count as u64,
        );
        let total = Storage::mod_index().len() as u32;
        index_page_to_apps(raw, total)
    }

    // --- Mod-lineage queries (constellation display) ---

    /// Total number of recorded mod-lineage edges.
    #[pvm::method]
    pub fn get_lineage_count() -> u32 {
        Storage::lineage_count().get().unwrap_or(0)
    }

    /// Page of mod-lineage edges from `start`, up to `count`, oldest-first.
    /// Each `{ child, source }`: `child` was published as a mod of `source`.
    #[pvm::method]
    pub fn get_lineage(start: u32, count: u32) -> Vec<LineageEntry> {
        let total = Storage::lineage_count().get().unwrap_or(0);
        let mut entries: Vec<LineageEntry> = Vec::new();
        if count == 0 || start >= total {
            return entries;
        }
        let mut idx = start;
        while idx < total && (entries.len() as u32) < count {
            if let Some(edge) = Storage::lineage_at().get(&idx) {
                entries.push(LineageEntry { child: edge.child, source: edge.source });
            }
            idx = idx.saturating_add(1);
        }
        entries
    }

    // --- Domain data queries ---

    #[pvm::method]
    pub fn get_metadata_uri(domain: String) -> Option<String> {
        Storage::metadata_uri().get(&domain)
    }

    #[pvm::method]
    pub fn get_owner(domain: String) -> Address {
        Storage::info()
            .get(&domain)
            .map(|i| i.owner)
            .unwrap_or_default()
    }

    // --- Points + leaderboard queries ---

    /// Cumulative XP for `account`. Returns 0 for unknown / zero-score
    /// accounts (the `account_points` slot is evicted on score == 0).
    #[pvm::method]
    pub fn get_points(account: Address) -> u128 {
        Storage::account_points().get(&account).unwrap_or(0)
    }

    /// Read up to `count` leaderboard entries starting at `start`, ordered
    /// by score DESCENDING. One contract call returns a pre-sorted page;
    /// the frontend renders without a client-side sort.
    ///
    /// Backing store: an OrderedIndex keyed on `u128::MAX - score`, so the
    /// natural ascending iteration yields highest scores first.
    #[pvm::method]
    pub fn get_top_builders(start: u32, count: u32) -> Vec<TopBuilderEntry> {
        let entries = Storage::points_index().range(
            Bound::Unbounded,
            Bound::Unbounded,
            start as u64,
            count as u64,
        );
        entries
            .into_iter()
            .map(|(neg_score, account)| TopBuilderEntry {
                account,
                score: u128::MAX - neg_score,
            })
            .collect()
    }

    /// Total number of unique-modder credits recorded against `domain`.
    /// Increments only when a fresh `(modder, source_domain)` pair publishes
    /// a mod for the first time — re-mods by the same modder do not re-count.
    #[pvm::method]
    pub fn get_mod_count(domain: String) -> u32 {
        Storage::mod_count().get(&domain).unwrap_or(0)
    }

    /// Cumulative star count for `domain`. Decremented on `unstar`. Never
    /// negative (saturating_sub).
    #[pvm::method]
    pub fn get_star_count(domain: String) -> u32 {
        Storage::star_count().get(&domain).unwrap_or(0)
    }

    /// Whether `voter` currently has an active star on `domain`. Used by
    /// the frontend to toggle the star button between star/unstar.
    #[pvm::method]
    pub fn has_starred(voter: Address, domain: String) -> bool {
        Storage::star_given().get(&(voter, domain)).unwrap_or(false)
    }

    /// Per-account points broken down by source. Single round-trip read so
    /// the profile UI doesn't fan out into per-app queries. Derived: only
    /// the total is stored; star and mod components are summed from the
    /// per-domain `star_count`/`mod_count` over the domains the account
    /// CURRENTLY owns (published, `info.owner == account` — tombstoned and
    /// unpublished list slots are skipped, see `owner_domain_at`).
    ///
    /// Cost: O(N_owned_apps) — bounded by `owner_app_count[account]`. For
    /// a typical user (≤ a dozen apps) this is a handful of mapping reads.
    #[pvm::method]
    pub fn get_point_breakdown(account: Address) -> PointBreakdown {
        let total = Storage::account_points().get(&account).unwrap_or(0);
        let owner_bytes = account.as_fixed_bytes();
        let owned = Storage::owner_app_count().get(owner_bytes).unwrap_or(0);
        let mut star_points: u128 = 0;
        let mut mod_points: u128 = 0;
        for i in 0..owned {
            if let Some(domain) = Storage::owner_domain_at().get(&(*owner_bytes, i)) {
                // Attribution follows the CURRENT `info.owner`: skip
                // tombstone slots (domain re-claimed by a different owner
                // after unpublish — its star/mod counts belong to the new
                // owner's breakdown now) and unpublished domains (no owner
                // at all; counting them under every list that ever held
                // them would double-attribute after a re-claim ping-pong).
                match Storage::info().get(&domain) {
                    Some(info) if info.owner == account => {}
                    _ => continue,
                }
                star_points = star_points
                    .saturating_add(Storage::star_count().get(&domain).unwrap_or(0) as u128);
                mod_points = mod_points
                    .saturating_add(Storage::mod_count().get(&domain).unwrap_or(0) as u128);
            }
        }
        // `launch_points` was once the residual (total - star_points -
        // mod_points). Under #286 the buckets are counts, not XP, so the
        // residual is meaningless. Kept in the struct for ABI stability;
        // frontends should read `get_owner_app_count` for the deploy count.
        PointBreakdown {
            launch_points: 0,
            mod_points,
            star_points,
            total,
        }
    }

    // --- Migration ---

    /// Toggle the freeze flag. Sudo only. Bypasses the freeze guard so an admin
    /// can re-open if needed.
    #[pvm::method]
    pub fn set_frozen(value: bool) {
        require_sudo();
        Storage::frozen().set(&value);
    }

    /// Returns whether writes are currently halted.
    #[pvm::method]
    pub fn is_frozen() -> bool {
        Storage::frozen().get().unwrap_or(false)
    }

    /// Re-resolve the reputation reference from the CDM. Sudo only. Use this
    /// after reputation has been redeployed and its CDM entry updated.
    #[pvm::method]
    pub fn refresh_reputation_reference() {
        require_sudo();
        Storage::reputation().set(&reputation::Reputation::cdm_lookup().address());
    }

    /// Replay an app entry from a prior registry deployment. Sudo only.
    /// Idempotent: no-op if `domain` is already in `info`.
    ///
    /// `publisher` is the recorded `env::caller()` of the original first
    /// publish. For migrations from a pre-publisher registry where that
    /// caller wasn't stored, the off-chain replay script should pass the
    /// stored `owner` as `publisher` — that yields a consistent post-
    /// migration state where the owner can still republish (it's both
    /// owner and publisher), which is the closest faithful approximation.
    #[pvm::method]
    pub fn import_app(
        domain: String,
        owner: Address,
        publisher: Address,
        visibility: u8,
        metadata_uri: String,
        is_moddable: bool,
    ) {
        require_sudo();
        import_one(&domain, owner, publisher, visibility, &metadata_uri, is_moddable);
    }

    /// Batched `import_app`. Per-entry semantics unchanged; off-chain callers
    /// must chunk to fit per-tx block-weight limits.
    #[pvm::method]
    pub fn import_apps(apps: Vec<AppImport>) {
        require_sudo();
        for app in apps {
            import_one(
                &app.domain,
                app.owner,
                app.publisher,
                app.visibility,
                &app.metadata_uri,
                app.is_moddable,
            );
        }
    }

    /// Replay a pinned entry from a prior registry deployment. Sudo only.
    /// Idempotent: no-op if `domain` is already pinned. Requires the app to
    /// have been imported first and to be public.
    #[pvm::method]
    pub fn import_pinned(domain: String) {
        require_sudo();
        let info = match Storage::info().get(&domain) {
            Some(i) => i,
            None => revert(b"AppNotFound"),
        };
        if info.visibility < VISIBILITY_PUBLIC {
            revert(b"CannotPinPrivateApp");
        }
        if Storage::pinned_index_of().contains(&domain) {
            return;
        }
        add_to_pinned(&domain);
    }

    /// Replay mod-lineage edges (backfill / prior deployment). Sudo only.
    /// Idempotent via `lineage_recorded` (one edge per child). Skips empties.
    /// Does NOT require `source` to exist — trusted sudo backfill data.
    #[pvm::method]
    pub fn import_lineage(entries: Vec<LineageImport>) {
        require_sudo();
        for e in entries {
            if e.child.is_empty() || e.source.is_empty() {
                continue;
            }
            if Storage::lineage_recorded().get(&e.child).unwrap_or(false) {
                continue;
            }
            let idx = Storage::lineage_count().get().unwrap_or(0);
            Storage::lineage_at().insert(&idx, &LineageEdge {
                child: e.child.clone(),
                source: e.source,
            });
            Storage::lineage_count().set(&(idx.saturating_add(1)));
            Storage::lineage_recorded().insert(&e.child, &true);
        }
    }

    /// Replay authoritative leaderboard scores. Sudo only. SETS each total
    /// (overwriting any `import_apps` launch seed), so MUST run AFTER all
    /// `import_apps`. Idempotent.
    #[pvm::method]
    pub fn import_points(entries: Vec<PointImport>) {
        require_sudo();
        for e in entries {
            set_points(e.account, e.total);
        }
    }

    /// Replay per-domain star/mod counters. Sudo only. SETS the counters
    /// (overwrite, idempotent). Skips unknown domains. Does NOT touch
    /// account_points (use `import_points`) and does NOT repopulate the
    /// star_given / mod_credited dedupe maps (they reset — see runbook).
    #[pvm::method]
    pub fn import_social_counts(entries: Vec<SocialImport>) {
        require_sudo();
        for e in entries {
            if Storage::info().contains(&e.domain) {
                // Lazy backfill: write the raw Mapping counts only, do
                // NOT touch star_index / mod_index (and therefore no
                // `*_nonce` entry either). The next live `star` /
                // mod-credit goes through `set_*_count`, which reads the
                // imported count, finds no stored nonce, and takes the
                // value-based `remove(MAX-cur, domain_idx)` fallback
                // — a silent no-op because that bucket was never written —
                // and then inserts the domain at the new bucket. Net
                // effect: a single live op promotes the imported domain
                // into the sorted set without double-counting, and the
                // migration tx itself stays light (no OrderedIndex churn
                // for hundreds of domains).
                Storage::star_count().insert(&e.domain, &e.star_count);
                Storage::mod_count().insert(&e.domain, &e.mod_count);
            }
        }
    }

    /// Replay display usernames. Sudo only. Inserts into both `usernames` and
    /// `username_to_owner` verbatim (names already normalized/validated at the
    /// source). Skips empties and names already taken on the new contract.
    /// Idempotent (per-account: an account that already has a name is skipped).
    #[pvm::method]
    pub fn import_usernames(entries: Vec<UsernameImport>) {
        require_sudo();
        for e in entries {
            if e.name.is_empty() {
                continue;
            }
            // Don't overwrite a name already set for this account (prior run or
            // a live set_username), and don't clobber a name already taken by
            // someone else. Either case keeps the two maps in lock-step.
            if Storage::usernames().contains(&e.account)
                || Storage::username_to_owner().contains(&e.name)
            {
                continue;
            }
            Storage::usernames().insert(&e.account, &e.name);
            Storage::username_to_owner().insert(&e.name, &e.account);
        }
    }

    // --- Usernames ---

    /// Claim (or re-claim) a display username for `caller`. Lowercased and
    /// validated on the way in; uniqueness enforced via `username_to_owner`.
    /// Renaming frees the caller's previous name so a later claimant can
    /// take it. Reverts with one of:
    ///   - UsernameTooShort / UsernameTooLong
    ///   - UsernameInvalidChar / UsernameInvalidEdge / UsernameDoubleDash
    ///   - UsernameTaken (another account holds this name)
    ///   - Frozen (writes halted by sudo)
    ///
    /// Self-no-op: setting the same name you already hold is permitted and
    /// idempotent. The frontend uses best-block reads to optimistically
    /// refresh after this returns; finalization isn't required for UX.
    #[pvm::method]
    pub fn set_username(name: String) {
        require_unfrozen();
        let normalized = lowercase_ascii(&name);
        validate_username(&normalized);
        let me = caller();

        // Free any name the caller previously held (skip if it's the same
        // string — saves a storage write on the no-op case).
        if let Some(prev) = Storage::usernames().get(&me) {
            if prev == normalized {
                // Idempotent re-claim. Still re-emit so subscribers can
                // refresh on duplicate clicks if needed.
                emit_event(b"UsernameSet", &normalized);
                return;
            }
            Storage::username_to_owner().remove(&prev);
        }

        // Uniqueness: the name must be free OR already held by me (covered
        // above and short-circuited). Held-by-someone-else ⇒ revert.
        if let Some(holder) = Storage::username_to_owner().get(&normalized) {
            if holder != me {
                revert(b"UsernameTaken");
            }
        }

        Storage::usernames().insert(&me, &normalized);
        Storage::username_to_owner().insert(&normalized, &me);
        emit_event(b"UsernameSet", &normalized);

        // One-time username bonus (#286 / #289). Flag is set BEFORE try_award
        // so even a blacklisted caller can't re-enter and farm by retrying:
        // try_award is a no-op for blacklisted, but the flag still locks them
        // out of the bonus on any later un-blacklisting. Reaching this line
        // means the rename succeeded, so this is also the right moment for
        // the first-time award — the rename + bonus settle atomically.
        if !Storage::username_bonus_awarded().get(&me).unwrap_or(false) {
            Storage::username_bonus_awarded().insert(&me, &true);
            if try_award(me, USERNAME_BONUS_XP) {
                emit_typed_event(b"UsernameBonusAwarded", &UsernameBonusEvent {
                    recipient: me,
                    username: normalized,
                });
            }
        }
    }

    /// Release the caller's username so someone else can claim it. No-op
    /// when the caller has no name set.
    #[pvm::method]
    pub fn clear_username() {
        require_unfrozen();
        let me = caller();
        if let Some(prev) = Storage::usernames().get(&me) {
            Storage::username_to_owner().remove(&prev);
            Storage::usernames().remove(&me);
            emit_event(b"UsernameCleared", &prev);
        }
    }

    /// Read the display username for `account`. Returns `""` when no name
    /// is set — same sentinel pattern as `modded_from` (avoids the SolAbi
    /// `Option<String>` head-size gotcha).
    #[pvm::method]
    pub fn get_username(account: Address) -> String {
        Storage::usernames().get(&account).unwrap_or_default()
    }

    /// Batch read for the leaderboard. Returns one entry per input account,
    /// in the same order. Each output is the name or `""` (no name set).
    /// One round-trip read per address — bounded by the input length.
    #[pvm::method]
    pub fn get_usernames(accounts: Vec<Address>) -> Vec<String> {
        accounts
            .into_iter()
            .map(|acct| Storage::usernames().get(&acct).unwrap_or_default())
            .collect()
    }

    /// Reverse lookup: who currently holds `name`? Returns the zero address
    /// when the name is unclaimed. Input is lowercased before the lookup so
    /// the UI can pass whatever casing the user typed.
    #[pvm::method]
    pub fn get_username_owner(name: String) -> Address {
        let normalized = lowercase_ascii(&name);
        Storage::username_to_owner()
            .get(&normalized)
            .unwrap_or(Address::default())
    }

    /// Convenience predicate for the "set username" form — the frontend
    /// can show a live-validated availability tick without parsing revert
    /// reasons. Returns true when `name` passes validation AND the lowercase
    /// form is either unclaimed or held by `prospective_caller`. Reverts on
    /// invalid charset / length the same way `set_username` would.
    #[pvm::method]
    pub fn is_username_available(name: String, prospective_caller: Address) -> bool {
        let normalized = lowercase_ascii(&name);
        validate_username(&normalized);
        match Storage::username_to_owner().get(&normalized) {
            None => true,
            Some(holder) => holder == prospective_caller,
        }
    }

    #[pvm::fallback]
    pub fn fallback() -> Result<(), Error> {
        revert(b"Unknown");
    }

}
