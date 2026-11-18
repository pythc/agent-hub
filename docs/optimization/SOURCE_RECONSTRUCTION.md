# Source reconstruction inventory (O12)

This is **source-only recovery**, not a personal installation backup. It does not
load host configuration, start Runtime, package files, restore account/task state,
replay work, contact models, or inspect browser profiles. The existing private
`backup`/`restore` commands keep their separate credential-bearing semantics.

## Capture

From a trusted checkout, with Node and Git installed (no npm dependencies needed):

```sh
node deployment/source-recovery.mjs capture . refs/heads/YOUR_BRANCH > /private/source-inventory.json
```

The optional full branch ref explicitly requests a read-only HTTPS `origin`
lookup. A credential-free HTTPS URL is required. URL credentials, query strings,
fragments, URL rewrites and non-HTTPS origins are rejected before lookup.
TLS verification is required and HTTP redirects are disabled. Authentication may
still use the user's configured Git credential helper. Errors are fixed messages,
not credential-bearing Git stderr.

The inventory records immutable HEAD commit/tree, committed package-lock SHA-256,
package/Node identity, and whether tracked or untracked changes exist. It records
no local paths, dirty filenames, file contents, credentials or browser data.
Ignored files are excluded, not claimed absent. `remote_tip_verified` means only
that the requested remote branch advertised that exact commit at observation
time; it is not a retention guarantee. `local_only` means the tip did not match;
`not_checked` means no lookup was requested. `localChanges: true` explicitly means
some local work is not represented in the committed source snapshot. Never call
that complete backup coverage.

The generated `dist/chat` artifact is marked `rebuild_required`; it is not copied
from the old machine. External artifacts, worktrees, account data and credentials
are excluded and require their own separately authorized private recovery plan.

## Reconstruct and independently revalidate

Read the inventory as data and review/trust its repository and commit before any
checkout or package installation. Never execute arbitrary commands from an
untrusted inventory. Use these fixed steps in a new empty directory:

1. Clone the specified trusted remote into a fresh checkout. Do not reuse the
   old checkout, its node_modules, generated output, private state or reports.
2. Check out the inventory's exact commit detached. A branch moving is not a
   reason to substitute its new tip; a missing old object is a recovery failure.
3. Run the trusted verifier against the new checkout:

   ```sh
   node deployment/source-recovery.mjs verify /path/to/new-checkout /private/source-inventory.json
   ```

   It strictly validates the inventory, HEAD/tree/committed lock, index entries, hidden index flags and actual tracked file/link bytes. It avoids
   Git status/diff and disables fsmonitor/hooks so repository clean filters are
   never run. Inherited Git repository/config overrides are removed. It performs no network access,
   installs, hooks, host configuration loading or application startup. Partial
   clones are rejected and lazy object fetching is disabled; missing local
   objects fail rather than silently contacting a remote. Git configuration
   is still read, including credential-helper configuration for explicit lookup. The output explicitly
   leaves dependencies unchecked and runtime not started. Integrity checks are
   not authenticity or permission checks. Do not edit the checkout during
   verification; this is a bounded observation, not a filesystem snapshot.
   Inventory input must be a regular non-symlink UTF-8 file of at most 32 KiB.
4. From that new checkout, run `npm ci`, `npm run typecheck`,
   `npm run build:chat`, and `npm test`. These are separate explicit operations
   on trusted code. A successful inventory check alone is **not** a successful
   rebuild. Save commit, environment, command exit statuses, test failures and
   rebuilt artifact hashes outside the checkout. Do not reuse old test evidence.
5. Keep external-platform delivery and unknown effects unverified. Starting a
   personal host or restoring private state is a separate operation, not an
   automatic consequence of reconstructing source.

## Acceptance status

Focused automated coverage uses isolated temporary Git repositories and separate
clones: exact identities, dirty/staged/hidden changes, malformed inventory,
unsafe URLs, secret canaries and the dependency-free CLI. Actual remote rebuild
results must be bound to their tested SHA; they are not established by this
procedure or by the fixture-only tests. Real browser, external IM/ACP delivery
and private installation reconstruction remain outside this source-only check.
