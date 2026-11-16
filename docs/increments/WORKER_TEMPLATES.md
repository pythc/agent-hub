# Worker template recipes

## Recovery status

Restored in `/workspace/scratch/f110c34c6b30/agent-hub-recovery` from this implementation thread's complete write commands, including the original-request retry and decoded-credential fixes previously committed as `936c677`. The old checkout and its commit objects are unavailable. This restoration is a new artifact; past tests are historical only. New verification is recorded below once executed. No assertion of byte-for-byte identity is made; the source URL validator additionally catches invalid URL construction safely.

## User behavior

The template library is available from the team workspace at `/configure#worker-templates`. A template is a versioned recipe, not a running Worker or a new conversation flow. Users review the exact instructions, declared capabilities, tool requirements, examples, acceptance criteria, source, license and SHA-256 before installing it. The original evidence-reviewer starter is offered for explicit review; loading the page does not install it.

Import accepts one UTF-8 JSON document of at most 128,000 bytes. The complete v1 manifest is an exact object with `apiVersion: 1`, `type: "worker-template"`, `id`, `version`, `label`, `description`, `instructions`, `requirements: {capabilities, tools}`, `examples: [{request, expected}]`, `acceptance`, `source: {name, url, license}` and `digest`. Digest is SHA-256 of the validated manifest with `digest` omitted, using the repository's recursive key-sorted JSON canonicalization (`stableDigest`); arrays retain their order. `sealWorkerTemplate` supports authoring an original recipe. The UI exports exactly this format as `<id>-<version>.worker.json`.

Creating a Worker invokes existing `WorkerManager.call({action: 'create', ...})`. The operator chooses a Worker ID, name and existing backend. The result has `state: 'paused'`, `tools: []` and `toolConnections: []`; it runs no model, schedules no assignment, and grants no tools, accounts, source scopes or MCP connections. Tool requirements are guidance for a later explicit configuration step. Existing settings revision checks, duplicate/retired Worker identity checks, policy enablement, backend policy and Worker limits still apply. Creation additionally checks declared capabilities and all managed admission prerequisites: managed, tools, resume, history and contextBudget. These are configuration checks, not live authentication/provider verification. Runtime admission remains authoritative.

Instructions are untrusted role guidance and never authority. Source URLs and valid digests identify reviewed content, not trustworthy publishers. The creation response separately exposes `requires: {operatorConfiguration, activation, tools, capabilities}` and `grants: []`. Source URLs require HTTPS without credentials, queries or fragments. Preview/installation never fetches them.

## Import safety and immutable versions

There is no archive extraction, local import path, filesystem traversal or executable loader. ZIP/tar data, archive entries, paths, symbolic links, scripts, environment mappings, credentials, history and memory fields are rejected by the strict schema. IDs cannot contain slash, backslash or traversal components. No import content supplies a disk destination. A lexical depth check precedes recursive JSON parsing; the parser rejects comments, trailing commas, duplicate object properties, depth beyond 12 and oversized documents. Bounded strings/arrays prevent unbounded prompt expansion. Recognizable private keys and common token forms are checked on decoded manifest content so Unicode escapes cannot hide them; errors never echo their content. Arbitrary prose can still contain sensitive material, so this heuristic is not proof of secret absence.

Library identity is `(id, version)` and its digest stays immutable even after removal. Different content must use a new version; newer versions add independent entries. Existing Worker prompts/sessions are never rewritten. Removal tombstones the recipe, retaining history, commands and Worker provenance; it does not delete or retire Workers or tasks.

## Persistence, concurrency and recovery

Existing SQLite `records` and `audit` are used; no competing task/execution state is introduced:

- `worker-template` stores immutable manifests and removal tombstones.
- `worker-template-library/current` is a library revision independent of settings revision.
- `worker-template-command` stores install/remove receipts and fingerprints.
- `worker-template-create` stores pinned creation intent and result.
- `worker-template-origin/<workerId>` pins version, digest, requirements and acceptance criteria.

Install/remove use `Store.atomic`, compare library revision and require a stable request ID; changed content under the same request ID fails. Creation passes the original settings revision and stable command identity to Worker management. A crash between Worker creation and provenance persistence is reconciled by retrying the original command receipt, without creating another Worker. Removing a template does not erase an already-started creation. Configuration conflicts require renewed review. No operation performs an external call.

The interface retains the exact original request across ambiguous errors and inventory refreshes. Pending creation IDs and display fields (never recipe instructions or credential fields) are retained in session storage so browser reload can offer completion of the original request. Definitive revision/validation failures clear the retry intent. Errors never falsely claim an ambiguous operation was unapplied. The UI supports keyboard focus, narrow layouts, theme variables and reduced motion. React text rendering never executes imported HTML/Markdown.

## Server integration contract

Instantiate `new WorkerTemplates(() => runtime)` so runtime replacement is respected. Routes require existing operator authentication and same-origin checks. Return static `WorkerTemplateError.code` with its status; never echo input content.

| Route | Method | Service / body |
| --- | --- | --- |
| `/api/worker-templates` | GET | `snapshot()` |
| `/api/worker-templates/preview` | POST | `preview({manifest})`; raw JSON text or object |
| `/api/worker-templates/install` | POST | `install({manifest,digest,revision,requestId})` |
| `/api/worker-templates/export` | POST | `export({id,version})` |
| `/api/worker-templates/remove` | POST | `remove({id,version,revision,requestId})` |
| `/api/worker-templates/create` | POST | `await create({id,version,digest,revision,settingsRevision,requestId,workerId,label,backend,model?})` |

No route accepts a filesystem import path. `revision` and `settingsRevision` refer to different state authorities.

## References and original design

Reference baseline: TencentCloud/Octop `bf134dbd379036ce7545c7df1a1da7e381ece9ff`, inspected earlier in this implementation thread:

- [Expert library README](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/src/octop/infra/agents/experts/library/README.md) documents a blank install-tree template and market-distributed expert templates. It informed discoverability and recipe/instance separation.
- [Agent delegation behavior](https://github.com/TencentCloud/Octop/blob/bf134dbd379036ce7545c7df1a1da7e381ece9ff/docs/agent-delegation.md) describes background work and avoiding duplicate queue state. This implementation continues using Roppo's own Worker manager and durable authority.

Original choices are data-only JSON, immutable canonical digests, paused creation with empty grants, independent library revision, and recovery through existing command receipts. No Octop code, prompts, tests or translated product text was copied. No dependency was added; this module uses no ACP SDK.

## Migration and rollback

No schema migration or `user_version` change. Older versions ignore additive records; created Workers use the existing profile schema. Before rollback, stop the local host and back up private state using normal deployment procedures. Restore the previous code revision, install its locked dependencies and rebuild chat assets. Created Workers remain ordinary paused Workers with pinned prompts/tools/backend. Remove them explicitly through existing Worker management if desired. Retain records for forward recovery; do not purge task, outbox or audit history to revert this UI.

## Verification of restored artifact

Fresh verification on source commit `7837b45337d75efe0d24c50edad6eb7cb6e6d13b` in the recovered cloud checkout (2026-11-16):

- `npx vitest run tests/worker-templates.spec.ts tests/worker-pool.spec.ts tests/worker-backends.spec.ts`: 3 files / 18 tests passed, exit 0, duration 2.73 seconds; started at 05:01:24 UTC. This includes all 11 restored template cases plus existing Worker scheduling and backend compatibility tests.
- `npx tsc --ignoreConfig --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --allowImportingTsExtensions --skipLibCheck --types node src/worker-templates.ts tests/worker-templates.spec.ts`: passed, exit 0.
- `npx tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution Bundler --jsx react-jsx --strict --noUncheckedIndexedAccess --allowImportingTsExtensions --skipLibCheck --types node,vite/client web/chat/worker-templates.tsx`: passed, exit 0.
- `git diff --check` for owned template files: passed.

Historical pre-reset results are not substituted for these fresh checks. Browser evidence and final integrated checks belong to the integration owner's acceptance report; deterministic tests do not prove live providers or external IM services.
