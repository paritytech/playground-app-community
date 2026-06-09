# Playground Registry

On-chain registry of .dot apps for the Polkadot app store. Each app is identified by its `.dot` domain and maps to an IPFS metadata URI containing its store page information (description, icon, screenshots, etc.).

Ownership is claimed on first publish -- only the original publisher can update a listing.

## Storage

| Key | Value | Description |
|-----|-------|-------------|
| `app_count` | `u32` | Total number of registered apps |
| `domain_at[index]` | `String` | Maps sequential index to .dot domain (for paginated listing) |
| `metadata_uri[domain]` | `String` | IPFS CID pointing to app metadata on Bulletin |
| `info[domain]` | `AppInfo { owner }` | Ownership record for each domain |

## Methods

### `publish(domain, metadata_uri)`
Register a new app or update an existing listing. On first call for a domain, the caller becomes its owner. Subsequent calls must come from the same owner or the transaction reverts.

### `get_metadata_uri(domain) -> Option<String>`
Returns the IPFS metadata CID for a given .dot domain, or `None` if not registered.

### `get_domain_at(index) -> String`
Returns the .dot domain at the given index. Used for paginated enumeration (infinite scroll). Returns empty string if index is out of bounds.

### `get_app_count() -> u32`
Returns the total number of registered apps.

### `get_owner(domain) -> Address`
Returns the owner of a .dot domain listing, or zero address if not registered.
