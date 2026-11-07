# Roppo roadmap

This is a direction for discussion, not a release schedule. Proposed work becomes committed scope through a specific issue and reviewed implementation. Suggest priorities in [Discussions](https://github.com/pythc/agent-hub/discussions).

## Available today

- Personal local account and persistent conversations.
- Hosted Router with independently configured Workers.
- API protocols, a native Codex adapter, and a ChatGPT subscription adapter with protocol coverage.
- Streaming replies, tool records, files, team activity, and an embedded browser.
- Persistent personal browser profiles, local password storage, assignment isolation, and human takeover.
- MCP clients, office and GitHub sources, and custom adapter interfaces.

Availability is not universal platform acceptance; see the [README boundaries](README.md#status-and-boundaries).

## Next priorities

- **First-run reliability:** clearer connection diagnostics and reproducible clean-machine setup.
- **Browser compatibility:** Linux and Windows acceptance, complex login flows, and more recovery coverage.
- **Adapter confidence:** live-account acceptance for direct subscription sign-in and documented provider compatibility.
- **Contribution experience:** English technical guides, isolated browser fixtures, and approachable regression cases.

## Exploring

- Additional provider-approved subscription and CLI adapters.
- Organization identity, roles, and workspace isolation with explicit permissions.
- Installation and upgrade packaging with complete state migration and rollback guidance.

These items are not implemented promises. In particular, switching a workspace label is not an organization access-control system.

## Ways to help

Reproduce a setup problem, improve a translation, validate a documented platform, or propose an adapter with protocol documentation and tests. Maintainers should label an issue `good first issue` only when its scope, expected result, and verification are clear.
