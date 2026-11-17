# Model connection library

Implemented on `codex/model-connections-refactor-20261117`, starting from main `df91e1961d266f687db77191f21524a04d484f44`. This changes the actual configuration UI and host routes. It does not deploy or modify the user's active runtime.

## Behavior

- A searchable, filterable reserve library supplies the Router and Worker connection picker. Creating a connection retains all existing component assignments. The Router decision settings move into the Router's own configuration tab.
- Creation selects API / subscription / CLI first, then provider or tool. API model catalogs are optional; manual model IDs remain available. CLI arguments are optional advanced fields, entered one argument per line.
- Subscription aliases are internal. Only an unambiguous enabled local principal is inferred. Multiple identities require one explicit selection, and background-task consent is still mandatory. Actual login and model discovery use the existing subscription implementation.
- Tests distinguish model replies from CLI installation/sign-in checks. Last results survive refresh and are invalidated by configuration or credential changes. In-flight results from an older settings revision are rejected. No credentials or credential fingerprints enter the UI.
- API key replacement preserves connection IDs and component references. Failed restarts restore previous configuration and credentials. Live edits and deletions remain authoritative when creating another connection or restarting the host; obsolete managed definitions do not resurrect them.
- Used connections require replacing their references before deletion. The built-in executor remains; plugin deployment removal retains its controlled deployment path.

## Brand alignment

Official asset provenance is recorded in `src/ui/assets/README.md`. Images are bundled locally, without third-party browser image requests. Original colors and aspect ratios are preserved.

Rows, provider buttons and component pickers share centered frames. Optical scales compensate for official desktop-icon padding. Browser measurements put Codex's colored artwork at about 26.6px wide and DeepSeek's at 27.8px in list rows. Center offsets remain below 0.01px in the checked screens. These measurements supplement visual inspection in both themes and at 390px width.

## Verification

The reproducible fixture is `examples/connection-library-acceptance.ts`; the browser script is `tests/browser/model-connections.py`. Run against a fresh fixture directory. It uses a local HTTP provider, a synthetic account and an isolated CLI executable. No paid provider inference or live OAuth login is claimed.

Seven browser groups cover search/empty states, persisted testing, API failure recovery and creation, optional CLI arguments and invalidation, subscription identity/consent/model discovery, component picking/Router decision settings, deletion, light/dark themes and 390px layouts. No browser page errors, external browser requests or horizontal page overflow were observed.

Final screenshots, alignment measurements and results are in `.local/connection-library-delivery/`. Type checking and the production Chat build pass. The final full-suite run with two workers passes all 109 files: 1,632 tests passed and one skipped. The initial unrestricted run had three timing failures; those cases also passed in a separate 74-test rerun before the final full-suite pass. Logs are in `.local/model-connections-final-check.log`.

The design detector reports three existing typography advisories in unchanged decision-layer CSS, compared with four in the original model stylesheet. It reports no new advisories in the redesigned surfaces. No security scanner was invoked.
