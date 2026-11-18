# O32: retained attachment version downloads

Conversation attachments with a recorded SHA-256 now have an additional **Download recorded version** entry. The existing ordinary attachment download and preview are unchanged. Legacy attachments without recorded digests do not receive a pinned entry and are not silently backfilled.

`GET|HEAD /api/chat/conversations/:conversation/attachments/:upload/versions/:sha256` rechecks existing operator/session authorization, conversation ownership and cleanup state. The resolver then requires the stored digest to match the requested digest. It opens the retained file without following a leaf symlink, nonblocking, verifies a regular bounded file (at most the existing 25 MiB upload limit), reads at most the recorded length plus one byte from one file descriptor, checks size/change information and hashes the exact bytes returned. It never verifies one path and then streams another file. Both GET and HEAD perform the check; success is an attachment with no-store, nosniff and restrictive CSP.

Renaming the display filename, restarting or adding a newer upload with the same name does not change the old retained version. Missing, replaced, modified, cleanup-blocked or legacy-unknown versions return a generic unavailable response. Reusing an upload ID for different bytes cannot make an old digest link download those new bytes. This is **not** an archival retention policy: removal and history cleanup still remove access, and no missing historical data is reconstructed. The URL carries no authority and is not a public sharing link.

The read uses existing read-only scope/memory guards and makes no database changes. Frontend pinned paths are derived only from matching conversation attachment URLs and valid recorded digests, not arbitrary external URLs in metadata. Metadata alone never proves availability; the endpoint checks on every use.

## Verification and limits

Tests cover exact-byte identity, rename, restart, newer same-name uploads, invalid/unknown digests, ID reuse, cross-owner/conversation denial, leaf symlinks, deletion, cleanup and real HTTP GET/HEAD/auth/method/security headers. Frontend path derivation rejects malformed or external routes and legacy-unknown references. Shared version information distinguishes pinned entries from ordinary attachment links.

Exact-head CI, container acceptance, independent review and final Codex review receipts are recorded in the PR. Browser visual/mobile/keyboard/reduced-motion and real IM acceptance are deferred, not passed. No main merge, deployment, external delivery, new grants or retention changes. Workspace View historical resolution and the wider persistent cross-kind registry remain outside this slice.
