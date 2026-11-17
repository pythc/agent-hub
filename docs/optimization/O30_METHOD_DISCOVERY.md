# O30: Tools, Worker templates, and exact-version methods

Tools perform atomic actions. Worker templates contain role guidance and backend requirements. Saved skills are reusable methods, pinned by ID and version. None is an authorization grant.

The existing saved-method workbench now supports title/objective and lifecycle filtering, plus a read-only full-version preview. It displays parameters, steps, criteria, original acceptance references, lifecycle, and a digest. A newer method version does not replace the previewed or scheduled version. Editing explicitly saves a new version; the existing execution path still requires a fresh request and rechecks the current scope and Workers.

The preview checks each declared step against currently permitted Workers/backends, managed plugin requirements, and selected tool connections (including inherited backend defaults). Disabled/missing connections have explanatory repair guidance. It does not initiate a connection, install a plugin, enable a Worker, change grants, infer requirements from free text, or claim provider/account verification. Configured dependencies are not proof that execution is authorized or will succeed. Template installation/creation retains the existing paused, empty-grant behavior.

The existing read endpoint retains current entry and private-context visibility checks. Refresh, scope switch, close and newer previews invalidate old responses. Text is rendered as text, not HTML. Filtering does not reset another form's fixed-version selection.

## Verification

- New method and UI regressions plus existing template suite: 27 passing tests, including real local HTTP/SQLite 401/403/read-only checks, private/disabled entry rejection, exact-version selection, dependency changes, paused-Worker execution recheck, and stale-response fencing.
- Independent review found and prompted fixes for cross-form selection reset and preview invalidation on refresh; the final 27-test snapshot passed independent review.
- Typecheck and chat build passed. Complete suite is compared against exact base `6ecdb975f85ae16368d0f745997378663a99b388` in this environment; final baseline: 2403 passed / 75 failed / 4 skipped / 1 EPIPE; implementation: 2418 passed / 76 failed / 4 skipped / 1 EPIPE. The additional failure was the unchanged opencode adapter integration exceeding its 5-second test timeout under concurrent full-suite load; both exact-base and implementation isolated reruns passed all 33 adapter tests, with no source or timeout changes. These runs are not represented as all-green.
- No model/provider/external call in the new acceptance tests. No real IM/ACP or browser visual/keyboard acceptance is claimed. Final remote CI and integration are separate delivery gates.

## O04 integration

After resource ceilings landed on the development branch, method preview now uses the same current Worker/backend admission policy as dispatch. Unsupported ceilings and configured options above a ceiling are shown as blocked without exposing connection details, mutating configuration, or starting work. The existing permission checks run first. Three added regression cases cover unsupported native limits, Worker excess and default-option excess, including recovery and zero-write/external-effect assertions. Independent integration review passed; final typechecks, chat build and 70 relevant tests passed. This does not replace exact-head remote CI or claim real-provider/browser acceptance.
