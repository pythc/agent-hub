# Zod 4 upgrade notes

Roppo pins Zod to **4.6.7**, including the constrained-collection fix for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Use the committed lockfile with `npm ci`; no Zod 3 compatibility import is used by Roppo's schemas.

## Preserved behavior

- Omitted object settings still receive their nested defaults. The schema uses Zod 4 input defaults (`prefault`) where Zod 3 parsed an empty default object.
- Sparse settings patches still update only supplied keys. Explicit empty objects keep their existing reset-to-default behavior; omitted keys do not materialize defaults.
- Prompt previews without a draft use saved instructions. Supplying a draft or an empty object affects only the preview and does not save settings.
- String-keyed provider parameters and tool arguments still allow arbitrary JSON values, subject to the existing reserved-key and downstream tool validation.
- MCP tools continue to advertise required arguments and pagination defaults, and use the same host APIs.

Synthetic fixtures captured with Zod 3.25.76 at commit `02202ad` cover minimal and configured deployments. The upgrade suite compares normalized values, serialized round trips, persisted settings, sparse saves, revision conflicts, transaction failure, restart, and database backup/restore. Existing Worker, model-adapter, account, and browser tests remain part of `npm run check`.

## Intentional validation changes

An oversized bounded array now returns a collection-size error without enumerating invalid elements. This applies, for example, to Worker profiles and incoming attachments. Invalid elements within the limit are still rejected. Unconstrained arrays do not acquire a limit from this patch.

Zod 4 rejects non-finite numbers and integers outside JavaScript's safe integer range. UUID validation is also stricter; Roppo-generated IDs use `randomUUID`. Error wording and Zod issue metadata can differ. Integrations should use HTTP status and documented application error codes rather than matching validator prose.

## Upgrade and rollback

This dependency change does not change the SQLite schema (version 5), managed-configuration format (version 1), or local-account format (version 1). It does not restart or migrate a running installation automatically.

Follow the [operations guide](OPERATIONS.md#before-an-upgrade): keep the same configuration and state directory, back up before changing code, and run only one host against that state. The tested backup/restore path preserves the fixture's settings; it is not a claim that arbitrary older code can read all newer state. Reverting to the previous dependency restores the vulnerable validator, so prefer the patched revision.

References: [Zod migration guide](https://zod.dev/v4/changelog), [upstream collection fix](https://github.com/colinhacks/zod/pull/6652).
