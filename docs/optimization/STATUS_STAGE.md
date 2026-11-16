# O07 status projection stage

Status: implementing; no O07 completion claim. Branch `feat/optimization-status-20261116` starts at `4d107cbc53fb3b3d50f326a3f447193689881ecb` and leaves PR #10 container changes on their own line.

File ownership: execution_trace implements backend projection/current-evidence read-only chain and focused tests; worker_templates owns trace TSX/CSS; connectors independently reviews; root owns local deployment/browser fixtures, integration and records. ACP work line separately investigates CI in `agent-hub-ci`; one team slot remains free. User-authorized CI-only policy work must not touch this feature stage’s runtime sandbox settings.

The additive four facets distinguish execution, effects, current independent acceptance and host-recorded delivery. Existing task/recovery states stay authoritative. No new effect ledger or automatic retry is introduced. Current acceptance must not trust a historical passed round after evidence/input/permission changes; status inspection must not register binary versions, refresh memory or produce deliveries.

Focused actual-browser command (pending implementation/build/review): `python3 tests/browser/run-execution-status.py .local/<fresh-status-dir>`. It starts the actual app and browser in one cloud namespace. Deterministic model and held/uncertain receipt fixtures are explicitly synthetic. This is not real IM, ACP or container verification. Acceptance includes current-to-stale artifact refresh, cancellation retaining unknown effects, reload, light/dark/narrow/keyboard/reduced-motion/Chinese. The runner stops its own app after checks.

No real provider calls, paid effects, public deployment, main merge or user Mac are permitted. Related Issues are being created independently by the parent; do not duplicate or close them based on this stage’s partial evidence.
