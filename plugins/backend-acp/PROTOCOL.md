# ACP outbound protocol pin

This original adapter implements stable ACP wire protocol version **1** over newline-delimited JSON-RPC 2.0. It requests and accepts only integer `protocolVersion:1`; incompatible peers are disconnected. No draft-v2 fallback or automatic SDK upgrade is allowed. Adapter version is **0.1.0**, durable state version **1**.

The supported subset is initialize, explicitly selected agent-type authenticate, session/new, advertised session/load, session/prompt, session/update, session/request_permission, session/cancel and advertised session/close. Optional capabilities start unavailable. Client filesystem, terminal and host MCP servers are not exposed. No private wire extension is advertised.

Only agent_message_chunk text becomes public output. Thoughts, plans, tool payloads/titles, stderr, protocol error text and auth descriptors are discarded. Initialization reports authentication unknown and remoteVerified false. Unknown-session close error -32002 is idempotent success; close neither erases history nor undoes effects.

No ACP SDK or new dependency is included; Node builtins and the existing BackendPlugin contract implement transport, permission mediation and state. Any later SDK adoption requires an explicit version, license and immutable-package review. Original implementation and original deterministic fixtures use repository Apache-2.0 terms.

Official stable-v1 references, originally reviewed 2026-11-16:

- [Initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [Authentication](https://agentclientprotocol.com/protocol/v1/authentication)
- [Session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [Prompt turns and cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [Permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls)

Recovery note: this file's prose was reconstructed from the original local tool record after the workspace was lost. Historical test results are not fresh validation of restored code; rerun the focused tests and acceptance command.
