# Contributing to Roppo

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for helping build Roppo. Small fixes, clear bug reports, documentation, translations, and reproducible compatibility checks all help. Follow the [code of conduct](CODE_OF_CONDUCT.md).

## Find a place to start

- Use [Discussions](https://github.com/pythc/agent-hub/discussions) for questions, workflow examples, and early design ideas.
- Use [Issues](https://github.com/pythc/agent-hub/issues/new/choose) for reproducible bugs and concrete feature proposals. Check existing issues first.
- Look for `good first issue` or `help wanted`. Ask in the issue before beginning a large change so work is not duplicated.
- Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

English and Chinese are both welcome. Keep `README.md` and `README.zh-CN.md` aligned when changing product behavior or setup instructions.

## Set up a development checkout

Use Node.js 22.19+ and Git. API-backed development does not require Codex.

```sh
git clone https://github.com/pythc/agent-hub.git
cd agent-hub
npm ci
npm run check
```

For your own local deployment, run `./start.sh setup /path/to/private-directory`. Keep development state separate from an instance you depend on.

| Directory | Responsibility |
| --- | --- |
| `src/` | Host, task runtime, adapters, account and browser services |
| `web/chat/` | React conversation workspace using assistant-ui |
| `src/ui/` | Shared navigation, configuration and account pages |
| `src/vendor/dsh-core/` | Fixed upstream domain core; preserve provenance |
| `tests/` | Regression contracts and isolated browser checks |
| `examples/` | Configuration examples, fixtures and opt-in live checks |
| `docs/` | Usage, architecture, provenance and historical acceptance |

## Validate the behavior you change

`npm run check` type-checks both host and frontend, builds chat assets, and runs Vitest. A focused run is useful while editing:

```sh
npm test -- tests/chat.spec.ts tests/resource-state.spec.ts
```

For browser work, start an isolated fixture in one terminal:

```sh
npm run build:chat
npx tsx examples/chat-acceptance.ts fixture .local/contributor-chat
```

This fixture uses deterministic model replies, not a paid model. Its private `browser.json` contains test login material. Do not publish that file. For Python browser checks, install Playwright in a virtual environment, install Chromium, and read each script's arguments before running it. Store screenshots and reports under `.local/`; never use a real account recovery screen as public evidence.

Verify light and dark themes, a narrow viewport, keyboard focus, reduced motion, loading and failure states, and the browser console. UI animations must follow real runtime state. A fixture screenshot proves the interface, not live model or external-platform acceptance.

`native` examples and provider checks may invoke installed CLIs, spend model quota, or write to an external service. Run them only with your own test configuration and explicit intent. The normal regression suite must remain independent of personal credentials.

## Keep the runtime contracts intact

- Users converse with the Router. Worker results return through it; do not create a second competing conversation flow.
- Preserve source identity, assignment ownership, and revision checks. Context access is not permission to perform new actions.
- Keep backend identity stable for existing sessions. Do not silently switch credentials or reinterpret unsupported reasoning options.
- Preserve uncertain delivery states. Reconcile ambiguous external writes instead of blindly replaying them after a restart.
- Browser isolation includes assignment ownership and human-control leases. Separate local sessions do not isolate the website's server-side account data.
- Bind verification evidence to the actual artifact or commit being reviewed.
- Do not modify vendored domain-core files casually. An upstream update needs an explicit baseline, license review, manifest update, and regression evidence.

See [PARITY.md](docs/PARITY.md) for the distinction between the upstream core and Roppo extensions.

## Submit a pull request

Create a branch in your fork, make a focused change, and open a PR against `main`. Explain the problem, resulting behavior, validation, and remaining limits. Include screenshots for visible changes and a regression test for meaningful failure cases. For changes to persistent formats or recovery, explain compatibility, migration, rollback, and interrupted-operation behavior.

Before submitting:

```sh
npm run check
git diff --check
```

Review your diff. Exclude tokens, cookies, browser profiles, recovery codes, local paths, private model output, generated `dist/`, and `node_modules/`. Keep dependency licenses and notices intact. Do not add unrelated formatting churn.

Maintainers review scope, behavior, tests, documentation, and compatibility. A green test suite alone is not a promise of acceptance. Large architectural changes should begin with a discussion. There is no guaranteed review time.

By contributing, you agree that your original contributions are licensed under Apache-2.0. Only submit work you are authorized to contribute; third-party material must retain compatible licensing and attribution. No separate CLA is currently required.
