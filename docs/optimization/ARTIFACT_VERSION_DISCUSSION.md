# Discuss a fixed artifact version

Open **Discuss this version** from a task file's fixed version, a sent
conversation attachment with a recorded digest, or a retained Workspace View
package. Comments and proposed changes are private to the current account and
the server-resolved source. An optional page or line range is a locator only:
the implementation does not copy a selection, source content, or view runtime
state into a note. A proposed change is feedback, not a file edit. Any separate
editing workflow must create its own artifact version; this feature does not
invoke one, publish, send an external reply, or call a model.

The operator API re-reads the exact source and rechecks its existing permissions
on each read and append. It uses the same fixed bytes or package verification and
conversation ownership as the existing file/version paths; the identifiers in the
URL and the snapshot marker do not confer access. The server derives the snapshot
marker from the resolved version and source ownership. Operation IDs are scoped
to the account and version; repeating the same request is safe. A note about one
version is not copied to another. When access is no longer available, prior notes
are not returned. A revoked workspace selection or a failed refresh hides the
cached discussion instead of showing it alongside an error.

Supported sources are retained goal files, sent versioned local Chat attachments,
and fixed Workspace View packages still available through the existing
metadata-only resolver. Drafts, legacy attachments without a digest, runtime
view state, unknown source kinds, and deleted or unavailable sources are not
supported. A version/account can have at most 100 notes, each at most 4,000
characters. Local history cleanup blocks discussions linked to the removed
conversation, source trigger, attachment, goal or task. Notes are intentionally
not injected into the Router's prompt or the ordinary Chat messages.

Handoff checks:
- Save notes on two independently retained versions, refresh, and confirm each
  shows only its own notes. Verify page and line locators round-trip as numbers.
- Repeat an append with the same operation ID after a lost response; confirm one
  note. Change that request with the same ID; confirm rejection.
- Remove the artifact, revoke the originating Chat/goal authority, or disable
  the View; reload and try to append. Neither the notes nor the original
  version should become available through this feature.
- Save a proposed change and verify that the original version/digest stays the
  same and no model call, chat delivery, execution, or publication is initiated.
