# O18.1: existing credential references (read only)

O18.1 exposes the availability of existing explicit credential references without authenticating, starting a connection or creating a credential store. Full O18, unified account/expiry handles and fixed runtime-error adapters remain open. There is no new UI in this slice and no real platform/provider acceptance claim.

## Contract

`GET /api/credential-references` requires the current operator, accepts no query (including no workspace selector), rejects other methods with 405, and returns `cache-control: no-store`. Query rejection is `credential_references_query_invalid`; projection failure is a fixed 503 `credential_references_unavailable`. Exceptions and provider responses are never returned.

The response has `schema: 1`, `observedAt` (host milliseconds), `settingsRevision`, `scope: "host"`, and `connections`. Each connection has only `kind` (`source`, `tool`, `backend`), existing configured `id`, `state`, `references`, and `verification: "not_checked"`. Each reference has a zero-based `slot`, `purpose` (`authentication` or `process_environment`), and `state`. Slots are local to the current response/configuration, not credential handles and confer no authority.

- `present`: the existing adapter's local reference condition is satisfied. It is not evidence of valid authentication, access, expiry, reachability or capacity.
- `missing`: an explicit, recognizable reference fails that local condition.
- `unknown`: an implicit authentication mechanism or insufficient/unrecognized metadata cannot be checked statically.
- `not_declared`: no applicable explicit reference is declared in recognized wiring. It never means authentication is unnecessary or the connection works.

A missing reference takes precedence over unknown, then unknown over present. An empty known reference list yields `not_declared`. A source with no setup/package credential metadata stays unknown; no platform-specific fallback is invented. Absent optional source pointers are omitted, leaving required-field validation with the existing plugin. Invalid present references/pointers remain unknown. Plugin-backed tools delegate to their source and remain unknown here. Every native Codex backend includes an unknown authentication slot; implicit `codex` is included for existing pre-registry conversations. Subscription backends include an unknown authentication slot without reading or refreshing account files.

Only static SourceRegistry definitions, existing configuration, current revision and declared environment references are read. No new source, SDK, Store, Vault, settings owner or backend is constructed. No catalog, probe, validation hook, model, process, OAuth refresh, file I/O or network request is triggered. Capture the Runtime getter once for each synchronous snapshot; revision is provenance, not a cache key. Environment changes are reflected on the next read even without a revision change.

## Preserve existing conditions

| Reference wiring | Existing local condition retained |
| --- | --- |
| Source credential metadata, MCP stdio environment, MCP HTTP header references | Nonempty environment string; whitespace counts as present |
| API key reference | Nonempty after trimming |
| API header references | Nonempty string; whitespace counts as present |
| Packaged backend and native CLI explicit environment | Defined environment value; empty string counts as present |

Purpose indicates the declared wiring, not proof that a field is a bearer token. Disabled instances are included without being enabled. Static inline headers, arbitrary plugin config, unrelated/inherited environment, OAuth/native account identities and vault items are not enumerated. No environment/header names, values, lengths, digests, paths, command arguments, raw errors, email/subject or account aliases appear in the DTO. Existing configuration IDs are the only linkage. This endpoint does not grant access or infer server-side workspace selection; consumers must use the established workspace transport.

## Verification

`tests/credential-references.spec.ts` covers adapter-specific absent/empty/whitespace/present conditions; applicable and unknown metadata; implicit authentication; sentinel redaction; independent detached snapshots; same-revision environment changes; one Runtime capture across a changing getter; every host/observer table and total_changes remaining stable with running records; no model/source/catalog/tool/network/process invocation; protected real HTTP GET, method/query rejection, fixed 503 and recovery. Fixtures are local and synthetic.

Run:

```sh
npx vitest run tests/credential-references.spec.ts tests/resource-usage.spec.ts tests/connector-management.spec.ts
npx tsc --noEmit
```

Author verification on this slice: 22 new tests passed; together with resource-usage and connector-management, 90/90 focused tests passed. Host `tsc --noEmit` and `git diff --check` passed. These are local synthetic/API checks, not live authentication or independent final acceptance.

No visible UI changed. A later UI slice must use existing connection lists and transport, ordinary labels (for example “Credentials configured; not verified”), 14px text, no raw environment names by default, and actual light/dark/narrow/keyboard/reduced-motion acceptance. Real authentication, IM receipt/permission and provider calls require separate authorization and remain unverified.

## Migration and rollback

No persistent/configuration/secret format changes, new records, grants, expiry metadata or handles are introduced. No historical error is rewritten. Rollback removes the GET route/import and pure projection; clients must conservatively treat a missing endpoint as unavailable. Existing credential resolution, runtime errors, retries, uncertain receipts, native Codex, plugin sandbox and credential storage remain unchanged.

This is an original projection over Agent Hub's existing interfaces. It adds no dependency or external implementation code.
