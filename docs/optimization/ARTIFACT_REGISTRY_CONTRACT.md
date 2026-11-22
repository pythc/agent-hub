# O32: source-partitioned registration candidates

This is a validated source-locator contract and a read-only catalog projection, not a new persistent registry. `artifactRegistrationSchema` fixes schema 1, source kind/ID, version, checksum, permission domain and the source's existing retention policy. Acceptance and publication remain `not_tracked`; a registration candidate never implies either outcome. It contains no bytes, paths, download URLs, credentials or grants.

- Task files: operator-workspace domain, original immutable goal artifact ID, integer version and checksum. The catalog constructs the candidate only after `GoalArtifacts.describe` authorizes the source.
- Workspace Views: operator-workspace domain, original View ID plus manifest digest and code checksum. The catalog constructs the candidate only after the current enabled package verifies. This is not historical execution authority.
- Attachments: conversation domain with an explicit conversation ID and original upload ID. The recorded display/reference ID must match the existing upload-ID/checksum derivation. Legacy uploads without a digest have no immutable candidate. The constructor does not authorize or query a conversation; callers must supply provenance from an already-authorized original record. It is never wired to a global catalog or new endpoint; the conversation draft integration is described below.

Every locator is local to the owning workspace runtime. A saved descriptor cannot select another runtime, establish conversation ownership, survive revocation as an authorization token, or recreate deleted data. Permission checks and cleanup remain at the original resolver on each actual use. A renamed display label does not change identity; a changed version does. The catalog's optional additive `registration` field supports older clients/servers and the frontend rejects mismatches against the independently validated reference. The locator constructor and catalog projection do not write to the database or run migrations.

Any durable evidence is integrated at original source write/cleanup boundaries and retain workspace/conversation partitions. It must not independently copy retained bytes or resurrect cleaned history. ResultEnvelope task/contract/input references and acceptance receipts remain separate, evidence-backed follow-ups; this candidate does not claim M8 or O32 complete.

Tests cover source partitioning, legacy behavior, malformed/future schema, forged attachment reference identity, forbidden authority/publication fields, label independence, version changes, catalog access filtering, response validation and no record writes. Existing catalog auth/lease/cleanup tests remain required. Real browser/IM acceptance remains deferred; 7/49 unchanged.

## Conversation draft integration

The upload response and existing authenticated conversation attachment-draft list now project the candidate from the original upload row's conversation ID, upload ID and recorded digest. This is an additive optional response field, reconstructed on read; it is independent of the internal committed-ready evidence described below. Legacy uploads omit it, and renamed drafts retain identity. Wrong owners/conversations, cleaned history and removed uploads remain governed by the existing conversation/cleanup checks. The operator artifact catalog still never includes attachments.

The shared attachment converter defaults to excluding the candidate. Sending via `resolve`, binding to a trigger, and Worker resource copies therefore retain their existing payload and persistence shape; sent-history registration is not introduced here. Candidates in upload/list responses are metadata, not evidence that current bytes are still intact: the existing pinned download separately rechecks checksum and access. No new routes, storage tables, permissions or retention are introduced. This integration depends on the source-partitioned candidate contract and does not complete the persistent registry.

## Managed Workspace View promotion evidence (bounded slice)

A managed marketplace View install now stores internal `viewPromotions` on its
own installed item, atomically with the existing marketplace and settings ref
transaction. The registration is constructed from the verified canonical mounted
package (manifest digest and code checksum), with the first install operation ID,
settings revision and promotion time. Downloaded/staged object bytes, plans,
catalog reads, manual configuration and rollback/enable operations do not create
or backfill promotion evidence. Transaction failure leaves no committed evidence.
The operation ID is correlation, not a terminal-success receipt: later cleanup or
operation-status persistence can fail after the settings transaction commits.
Repeated installation of a retained digest preserves its first recorded promotion.
Upgrades keep evidence only for retained selected/active/previous digests; uninstall
removes it with the owning installed item. Older installations remain valid without
this optional metadata. This is a local committed-install fact, not proof of
acceptance, publication, execution or availability of all historical bytes.

The internal field is excluded from marketplace snapshots. Catalog and version
resolvers, authorization, cleanup, permissions, selected/active/previous behavior
and historical visibility are unchanged. No new registry enumeration or access
route is added, and retained evidence cannot authorize a bundle. Source-plugin
activation and manual Views are outside this slice. This does not complete O32.

## Attachment ready-row evidence (bounded slice)

New uploads record internal `committedRegistration` in the original
conversation's asset row, in the same write that commits the ready state and
stream checksum. Streaming, failed or revoked uploads, and failed ready writes
leave no committed registration. The value is evidence of the ready-row write,
not proof that file bytes are still available or that a user sent or accepted
the upload. It does not authorize opening bytes.

The original source row keeps this evidence through send binding but only
the existing upload and draft-list response may project the public candidate.
No internal field is exposed in those responses, sent histories, Worker
copies, or the operator catalog. Reads do not backfill legacy rows even if
they already have a checksum. Removing a draft or cleaning its history
removes the evidence with its owning asset; no new persistence or retention
path is introduced. This does not complete O32.
