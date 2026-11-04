The files in src/vendor/dsh-core are copied without changes from
deepseek-ai/dsh-superagent-prototype, public main archive retrieved 2026-11-04.
The original MIT notice is in src/vendor/LICENSE.
tests/upstream/core-engine.spec.ts is copied from the same repository with only
its import path adjusted. It is a regression contract, not evidence that DSH
integration tests have been run on this host.
Upstream https://github.com/deepseek-ai/dsh-superagent-prototype

The upstream domain baseline was rechecked against commit
8c32a9dc5d72c033816c6a8110b37f40cf94fba4 on 2026-11-04; all 15 files match.
The WeCom adapter imports @wecom/aibot-node-sdk 1.0.7 from the WecomTeam
package, which declares MIT licensing. Its source is not vendored here; exact
versions and integrity hashes are retained in package-lock.json.
