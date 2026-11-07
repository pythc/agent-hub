# Pluggable decision layer

Roppo can ask a small model to classify unmentioned group messages and task follow-ups before the persistent host Router handles them. This is an optional host extension, not a claim that DeepSeek SuperAgent uses Jev or a separate classifier.

Open **Workspace settings → Model connections → Decision layer**. Select an existing API connection, Jev, or a dedicated API endpoint. Test the draft, then save. API keys are read from the named environment variable in the Roppo process; the form does not save a plaintext key. Updating the parent shell does not change an already running process's environment.

| Mode | Behavior |
| --- | --- |
| Off (default) | No auxiliary requests. Existing Router behavior remains intact. |
| Record only (`shadow`) | The classifier runs concurrently. Its result is recorded but never shown to Router. |
| Advise Router (`advisory`) | Router receives bounded, validated labels when available, then independently evaluates original evidence and authorization. |

This version never drops messages, creates tasks, resumes tasks or stops tasks based solely on auxiliary output. It adds a classifier call and does **not** guarantee lower token usage. Candidate batching remains in Router; explicit requests and Worker result turns bypass the classifier. This integration applies to the persistent **host Router**, not the legacy assessment or client modes.

## Providers

- **Jev / TypeSafe:** native [`POST /v1/systemone`](https://docs.typesafe.ai/api/system-one), with `state` and one typed [Choice question](https://docs.typesafe.ai/primitives/choice) per message. Jev is not treated as an OpenAI-compatible model. Its distribution and entropy-based confidence are retained separately; neither is an authorization threshold.
- **OpenAI Chat Completions**, **OpenAI Responses**, **Anthropic Messages:** one stateless request, strict host-side output validation, no tools or session history. Choose `prompt`, `json-object` or `json-schema` according to provider support. Configure provider-specific thinking through advanced parameters, or generic reasoning effort on OpenAI protocols. Unsupported options fail visibly and fall back to Router; they are not silently stripped.
- **Local services:** use their compatible HTTP API, for example llama.cpp, Ollama or vLLM. Plain HTTP is allowed only on loopback; remote deployments use HTTPS. Whether a specific model supports structured output and thinking options must be tested against that service.
- Existing API connections can be referenced by ID. Agent CLI and subscription connections are excluded: these have different identity and session semantics.

Configuration examples (merge the `decision` field into the existing configuration):

```json
{
  "decision": {
    "mode": "shadow",
    "provider": {
      "kind": "jev",
      "baseUrl": "https://api.typesafe.ai/v1",
      "model": "jev-latest",
      "apiKeyEnv": "TYPESAFE_API_KEY"
    },
    "timeoutMs": 3000
  }
}
```

```json
{
  "decision": {
    "mode": "advisory",
    "provider": {
      "kind": "openai-chat",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "local-judge",
      "outputFormat": "json-schema",
      "chatTokenField": "max_tokens"
    },
    "parameters": {
      "temperature": 0,
      "chat_template_kwargs": {"enable_thinking": false}
    },
    "timeoutMs": 3000,
    "maxOutputTokens": 512,
    "maxConcurrent": 2
  }
}
```

For a shared connection, use `"provider": {"kind": "backend", "id": "my-api"}`. Connection model/protocol/headers/parameters are reused; agent role prompts, tools, subscription authorization and role defaults are not inherited. Decision `parameters` override connection parameters without changing the connection. Set thinking options only if supported by the selected provider. Jev accepts typed questions, not generative sampling parameters.

## Boundaries and diagnostics

Labels are `STOP`, `CONTINUE`, `IGNORE`, `INTERVENE`, and `REVIEW`. They describe intent, not permission. Input includes same-discussion messages and task summaries, including ownership flags where available; a remote provider receives that data when enabled. There is no arbitrary history fetch or tool access. Long inputs are bounded and marked truncated; an oversized batch falls back to Router without a call.

Settings revision, cancellation and context are checked again after the response. Stale results never become advice. Failed, incomplete, oversized, duplicate-ID or foreign-ID responses are unavailable, never an implicit `IGNORE`. Requests have a configurable deadline (100–10,000 ms), concurrency bound and 64 KiB response limit, without automatic retries. A slow advisory call can add up to its deadline before Router begins; use record-only mode to avoid this wait.

Authenticated endpoints:

- `POST /settings`: revision-checked `decision` configuration, same persistence/history contract as other settings.
- `POST /decision/probe`: `{ "config": <decision config>, "text": "sample message" }`; tests a draft without saving or changing tasks. Referenced backends resolve against **saved** connections. Each test can incur provider charges.
- `GET /decision/calls`: latest 100 records, including mode, provider, model, status/code, latency, labels and reported token usage. Unknown usage stays unknown. Raw messages, provider response bodies and credential values are not copied into these records. Historical records remain in the local database.

Typical failure codes: `missing_credentials`, `timeout`, `http_401`, `http_429`, `invalid_output`, `incomplete_output`, `input_too_large`, `response_too_large`, `context_changed`, `capacity`. Connection errors are sanitized. A successful probe establishes protocol connectivity, not classification accuracy.

## Upgrade, rollback and verification

Existing configurations gain an off-by-default field; no source, account, model, browser or task settings are rewritten by this feature. Disable the layer to immediately return to the original path. Pending results are invalidated by the settings revision. Before downgrading to a binary that predates this field, remove `decision` from any manually edited config file; old strict config parsers reject unknown top-level keys. Back up state before any binary downgrade.

Run `npm run typecheck`, `npm test`, and the isolated browser harness `examples/decision-acceptance.ts` + `tests/browser/decision.py`. The harness creates a temporary account/state and a loopback protocol fixture. Passing a local API base URL to the example exercises an actual local model instead. Keep these results distinct from hosted-provider validation and production deployment.
