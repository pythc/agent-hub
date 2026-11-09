# Workspace view plugins

Workspace views extend the operator UI. They are a separate category from [source plugins](PLUGINS.md), which transport application messages and resources. The first reference view is [Agent board](../plugins/agent-board/README.md).

Views use the existing collapsible navigation, account, theme and language controls. The generic route is `/configure#plugin/<id>`; no view-specific route or component is compiled into the host. Installing a view does not grant it a source connection or Worker tool.

## Package

`plugins pack`, `inspect` and `stage` dispatch by the manifest's `category`. A view source manifest contains:

```json
{
  "category": "workspace-view",
  "id": "my-view",
  "version": "1.0.0",
  "label": {"en": "My view", "zh-CN": "我的视图"},
  "capabilities": ["workspace.runtime.read"]
}
```

The packer adds `apiVersion: 1`, `entry: "view.js"` and `codeSha256`. It bundles browser code into one IIFE (up to 2 MB), retaining inline license comments. No host-side executable code or arbitrary server handler is installed. The normalized manifest digest pins both code and capabilities. This is an integrity binding, not a publisher signature.

`viewPlugins` accepts up to 16 unique IDs with a directory, reviewed digest and enabled flag. Packages are verified before catalog/bundle/data access. Invalid enabled packages appear unavailable and fail closed; disabled packages are never opened. Missing packages do not prevent the host from starting. Configuration staging writes a new complete file without replacing an existing file, and preserves source plugin references and all unrelated settings.

## Browser bridge

The host creates a `sandbox="allow-scripts"` iframe with an opaque origin and a CSP denying network requests, forms and external code/styles. It does not grant same-origin, top navigation, popups or downloads. The verified code is embedded in `srcdoc` with a nonce; script-closing markup is escaped. Inline stylesheet elements must use the nonce from `document.currentScript.nonce`, captured at bundle startup.

The child accepts `roppo:view:init` version 1 only from `window.parent`, then communicates through its transferred `MessagePort`. The host never processes arbitrary window messages as view commands. See [the browser-safe contract](../src/workspace-view-contract.ts).

Host messages:

- `environment`: `{dark, language}`.
- `snapshot`: the typed runtime projection.
- `connection`: `loading`, `live`, `stale` or `hidden`.

View commands:

- `refresh`: refresh the current read.
- `query`: optional source ID, task state, search text (100 characters) and nonnegative offset. Pages contain 25 tasks.
- `navigate`: one of `tasks`, `attention`, `team`, `models`, `conversation`, `browser`. These map to fixed existing host destinations; URLs and arbitrary task mutations are not accepted. The pinned enabled package is revalidated before navigation.

The host holds authentication and fetches `/api/workspace-views/<id>/runtime?digest=…`. Endpoints require operator identity, an enabled matching package and the read capability. The projection exposes bounded task summaries, configured agent identities, actual execution metadata, admission/batch observations, auxiliary usage and a user-filtered browser control summary. It deliberately excludes raw configuration, prompts, approval arguments, provider errors, native model history, URLs and credentials. Task titles and summaries are operator-visible user content; install only reviewed views authorized to display that content.

Polling is serialized, hidden-page aware, aborted on teardown and fenced against old query responses. Transport failure retains the last snapshot with a stale state. Authentication loss, disabled packages, changed digests and missing permissions remove the frame. The same checks apply after a controlled host configuration change. Deactivation is observed at the next read, not an instantaneous push revocation.

Source filters narrow presentation; they do not create a new organization access-control boundary. The host's authenticated operator remains the principal. This first version is a local reviewed-package interface, not a marketplace or an arbitrary untrusted-code execution guarantee.
