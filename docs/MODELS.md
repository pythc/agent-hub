# Model connections

Roppo separates the model connection from the agent that uses it. A connection defines the protocol, endpoint, authentication, and defaults. The Router and each Worker select a connection and can override the model, instructions, supported reasoning settings, and provider options.

## Choose a connection

| Kind | Current implementation | Acceptance boundary |
| --- | --- | --- |
| API | OpenAI Responses, Chat Completions, Anthropic Messages | Protocol tests use isolated HTTP servers; compatibility depends on the provider |
| Subscription | ChatGPT sign-in with an explicit owner and background authorization | Protocol regression coverage; live-account sign-in and inference still pending |
| CLI | Native Codex app-server | Native Codex has been exercised locally; other CLIs are not implemented |

In the interface, open **Model connections**, add the connection, then select it in **Agent team**. Use a model available to your own account. Saving a connection is not proof that authentication or a model call succeeded.

For built-in conversations, set the Router to hosted mode (`execution.router.mode: "host"`). In client mode, an external CLI conversation is the Router and uses that client's model settings. The older assessment mode is retained for compatibility.

## Parameters and existing sessions

Per-agent parameters merge with connection defaults. Nested objects merge; arrays replace; explicit `false` and `null` are preserved. Provider fields may be passed through, but the host owns conversation history, tool definitions, identity, and output schemas.

Reasoning is model-specific. `none` must not become `low`. Anthropic thinking options are not automatically translated from OpenAI reasoning options. Codex accepts the fields supported by its adapter rather than arbitrary API request bodies. Unsupported combinations produce explicit errors.

Existing conversations retain their backend identity and invocation settings. Changes apply to new sessions; changing an existing connection's identity can require a new conversation or an explicit task migration. A migration does not replay already completed external actions.

## Authentication

API keys belong in host-side credentials or configured environment variables, not in source-controlled JSON. CLI environment configuration maps child variable names to existing host variable names. A CLI may use subscription or API billing according to its own login.

The direct subscription adapter is a separate authentication path, not an API key conversion. It checks the configured source and owner, requires explicit background authorization, and does not silently fall back to paid API access. Provider eligibility, model availability, and billing remain provider-controlled. Roppo does not currently show a verified remaining subscription quota.

For full configuration examples, see [BACKENDS.md](BACKENDS.md) and [independent agent configuration](AGENT_CAPABILITIES_2026-11-06.md) (中文). Live provider tests must be run with your own authorized test account.
