# O32: retained goal-artifact references

`GET /goal-artifact-versions/:id` adds a schema-1, operator-only descriptor for an
existing retained binary goal artifact. It reuses the exact artifact ID, version,
hash, byte count and MIME metadata. The ID, not a mutable title or progress card,
selects the retained bytes at the existing `/goal-artifacts/:id` download route.
Only the basename is presented; internal workspace paths and raw goal context are
not part of the descriptor. Current goal/source ownership and private-context
restrictions are checked on every metadata read, just as on download. Guessing an
ID grants no authority. Missing and inaccessible versions have the same HTTP
response; POST is not supported.

Visibility is `operator_workspace`; retention is explicitly subject to history
cleanup, not a permanent-storage promise. Availability describes presence in the
local retained byte table, not independent content acceptance. `publication` is
`not_tracked`: neither presence nor download proves delivery, external publication
or acceptance. Missing bytes have no download path. Current authorization remains
necessary at download time even if an earlier descriptor showed availability.

This slice neither changes existing immutable storage nor adds publication,
rename, deletion, sharing, backup, or cross-machine access. It does not unify chat
attachments or Workspace Views into the registry and does not implement a new
results page. #43 remains open for those broader requirements. No real provider,
IM, browser visual/keyboard, or public deployment verification was performed.

Descriptor reads use scope and memory read-only guards. An unreconciled
revocation ledger or missing route fails closed without repairing state on GET.

## Fixed-version result page (second slice)

The task drawer now offers **Version details** next to each retained file. It
opens `/configure#artifact/<id>` (with explicit workspace selection preserved).
This page uses the existing workspace-bound transport and the descriptor above;
it does not enumerate files or grant a new capability. Requests are cancelled and
late responses ignored on navigation, refresh, workspace invalidation or unmount.
It presents the original name, exact version, hash, byte count, MIME type and
retention/publication caveats. A download selects the same immutable ID in the
current workspace and is reauthorized by the existing server download route.
Missing, removed and unauthorized metadata share the same unavailable state.
No artifact content is embedded or executed in the page.

This is a per-version result page, not a unified registry for chat attachments and
Workspace Views. It adds no rename/delete/share/publish controls. The broader
#43 issue remains open. Automated model and hook/transport tests cover malformed
references, workspace URL isolation, late replies and StrictMode replay; these
are not browser visual or keyboard acceptance. No real IM/provider calls or
public deployment were performed.

## Conversation attachment identity (third slice)

The browser-safe `artifact-reference.ts` contract now distinguishes goal-artifact
versions from conversation attachment versions. New ready uploads expose an
optional additive `reference` with a content-qualified ID derived from the upload ID and digest, version 1,
and a SHA-256 recorded over the original upload stream. Replacing a same-named
file creates another ID; the digest is evidence of the uploaded bytes, not a
promise of current filesystem availability, acceptance or delivery. Legacy
uploads retain their upload ID with `version: null` and `sha256: null`; metadata reads do not backfill or hash disk files.
Existing persisted messages without a reference remain supported.
A removed draft upload ID can be reused by a client; different bytes produce a
different content-qualified reference ID. Existing URLs still resolve uploads
under current authorization, not a pinned reference: this metadata does not add a
fixed-version download resolver for chat uploads.

Chat references retain conversation visibility and cleanup limitations. They are
not goal-artifact URLs or global registry entries: current conversation ownership,
ready-state and cleanup checks remain authoritative on each download/resolve.
No path, owner, credentials or conversation text is added to the reference. Failed
or revoked uploads discard partial records and never return a reference. No new
endpoint, download capability, sharing or automatic publication is introduced.

Workspace View packages and cross-kind enumeration are not integrated in this
slice. #43 remains open. No browser visual/keyboard, real provider/IM or public
deployment validation is claimed.

## Workspace View package identity (fourth slice)

The existing operator-only catalog and digest-pinned bundle response now expose
an additive `workspace-view` reference from the verified installed package.
`id` is the package ID, `version` the full manifest digest (not a mutable semantic
version label), and `sha256` the verified JavaScript bundle checksum. The manifest
digest includes that checksum. This identifies code, not the live runtime data
rendered by the view, and grants no runtime capability or download permission.
Unavailable/tampered packages expose no verified reference; disabled packages
remain absent. Existing clients may omit/ignore the optional metadata.

No new resolver, endpoint, historical-package execution, public link or iframe
permission is introduced. Existing bundle/runtime routes still require current
operator access and the currently enabled digest, with runtime capabilities
checked separately. Upgrading disables access through the old digest even if its
package bytes remain installed; rollback can restore it. Package removal can
invalidate references. Thus historical result opening, cross-kind result UI and
browser acceptance remain unfinished, and #43 stays open. No browser, real
provider/IM or public deployment validation is claimed for this slice.
