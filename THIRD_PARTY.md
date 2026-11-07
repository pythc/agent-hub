# Third-party notices

Original Roppo code is distributed under Apache-2.0; this does not relicense
the following components. Package versions and integrity hashes are pinned in
`package-lock.json`. Preserve their notices when redistributing.

## DeepSeek domain core

The files in src/vendor/dsh-core are copied without changes from
deepseek-ai/dsh-superagent-prototype, public main archive retrieved 2026-11-04.
The original MIT notice is in src/vendor/LICENSE.
tests/upstream/core-engine.spec.ts is copied from the same repository with only
its import path adjusted. It is a regression contract, not evidence that DSH
integration tests have been run on this host.
Upstream https://github.com/deepseek-ai/dsh-superagent-prototype

The upstream domain baseline was rechecked against commit
8c32a9dc5d72c033816c6a8110b37f40cf94fba4 on 2026-11-04; all 15 files match.

## WeKnora adaptations

Selected search, text-splitting, memory and Wiki primitives were adapted from
[Tencent/WeKnora](https://github.com/Tencent/WeKnora), commit
`e3fb2335bf3f8cadd32142380c60b2677a27bf99`. The original MIT notice is in
[`src/vendor/weknora/LICENSE`](src/vendor/weknora/LICENSE); the source paths and
hashes are recorded in [`upstream.json`](src/vendor/weknora/upstream.json).
The retained Go files are reference snapshots and are not a bundled service.

## Dependencies and UI components

The WeCom adapter imports @wecom/aibot-node-sdk 1.0.7 from the WecomTeam
package, which declares MIT licensing. Its source is not vendored here; exact
versions and integrity hashes are retained in package-lock.json.

- The free Affect UI Button and Segmented Control components were adapted to
  native DOM. Their MIT notice is in [src/vendor/affectui/LICENSE](src/vendor/affectui/LICENSE).
  No paid Affect UI component source is included.
- Chat uses assistant-ui, React, Lucide, and Vite. Versions, attribution, and
  bundled notices are recorded in [docs/THIRD_PARTY_CHAT.md](docs/THIRD_PARTY_CHAT.md).
- Browser execution uses agent-browser (Apache-2.0) and ws (MIT). See
  [docs/THIRD_PARTY_BROWSER.md](docs/THIRD_PARTY_BROWSER.md).
- The MCP SDK and other installed dependencies retain the licenses shipped
  in their npm packages. This list is not a replacement for those notices.

The product screenshots in `docs/images/` were captured from Roppo using an
isolated local fixture. They are not screenshots copied from another product.
