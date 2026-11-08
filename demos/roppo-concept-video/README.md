# Roppo — Concept Demo

A **159-second, 1080p, 30 fps** editable product demonstration built with Remotion. It follows Roppo’s existing white/dark workspace, with authored mouse movement, click feedback, camera focus, typed messages and simulated team activity.

[Watch the 1080p MP4](../../docs/media/roppo-concept-1080p.mp4) · [Storyboard](STORYBOARD.md)

After starting Studio, open http://localhost:3417/Roppo-Concept.

## Open and edit

```sh
cd demos/roppo-concept-video
npm ci
npm run dev -- --port=3417
```

Open **Roppo-Concept**, press **Space** to play or pause, and use the timeline to move between shots. Select a scene to edit its title, caption and timing. The **Scenes** folder also provides standalone model, Feishu, team and browser shots.

- `src/Composition.tsx` — authored scene order, captions and timeline timings.
- `src/Scenes.tsx` — screen content, task state changes, mouse paths and camera keyframes.
- `src/motion.tsx` — deterministic cursor, click rings, typing and camera movement.
- `src/UI.tsx`, `src/video.css` — Roppo UI, shared video layout and typography.
- `src/ProductScenes.tsx`, `src/product-scenes.css` — personal/organization positioning, model access, per-role tools, app ecosystem, listening and local deployment.
- `src/DecisionScenes.tsx`, `src/decision-scenes.css` — optional Jev / local / external API decision-layer configuration and the animated batch → rules → advice → Router flow.
- `src/Feishu.tsx`, `src/feishu.css` — Feishu desktop replica based on the supplied screenshot: sidebar, pinned apps, conversation list, incoming/outgoing bubbles and compact composer.
- `STORYBOARD.md` — the complete narrative and capability boundaries.

Mouse coordinates use the interface’s **1440 × 810** plane. Cursor and UI share the same camera transform, so zooming preserves click alignment. All time-dependent visuals derive from the Remotion frame, including typing and task states. Seeking backward reproduces the same result.

The current version is a **Chinese-captioned preview without voiceover**. The current version is exported as [`docs/media/roppo-concept-1080p.mp4`](../../docs/media/roppo-concept-1080p.mp4) (1920 × 1080, H.264, 30 fps, 159 seconds). If scene durations are changed, review subsequent `from` positions and the total composition length in `src/Root.tsx`.

Direct Feishu previews: `http://localhost:3417/Feishu-Inbox` and `http://localhost:3417/Feishu-Delivery`. Screenshot references inform the layout and styling; personal conversations from the screenshot are not included in the movie.

## Story

Personal assistant and organization hub → local login → API / subscription / CLI → per-role models, prompts and tools → plugins and multiple chats → decision-layer configuration → batch/rule/advice/Router flow → automatic admission without an @mention → delegation → browser takeover → files and evidence → stop and continue → automatic report in the original chat → local deployment.

## What is staged

This is a **concept demonstration**, not a recording of a production run. UI references come from Roppo commit `9388cc1` and an isolated local fixture. The Feishu group, orders application, API endpoint, task, code changes, worker output and test counts are fictional demonstration data. The external-conversation view illustrates the proposed unified journey; it does not assert that all connectors currently expose that exact UI.

The preview never calls a model, logs in to an external application, sends a group message, modifies Roppo’s live configuration or deploys code. The code and report displayed inside the movie are illustrative content, not executed regression results. Roppo’s original local installation is separate from this video project.

## Capability and cost wording

- The personal **24-hour assistant** means an available, continuously running installation; it is not an uptime SLA or a claim that a powered-off computer keeps working.
- Token efficiency is explained through actual host strategies: batching, short candidate cards and evidence read on demand. Empty-inbox ticks do not call a model. No fixed per-message budget or savings percentage is claimed. The optional advisory classifier does not itself guarantee savings.
- Automatic group handling is shown **within a previously configured authorized scope**, using a message with a concrete implementation request. There is no @mention or second acceptance prompt. Ordinary conversation remains quiet; only Router speaks for the agent team.
- Slack and Linear illustrate extension through plugins/adapters/MCP. This video does not establish a shipped native adapter, account authorization, webhook delivery or production acceptance for either service.
- Subscription and CLI paths use supported provider accounts and allowed tools. Provider eligibility, quotas and metering still apply; additional providers/CLIs need adapters. Direct ChatGPT subscription access is experimental in the referenced checkout.
- Local-first describes the host workspace and state. Cloud model APIs and external apps still receive the data needed for their configured calls.

The chapter at **00:59–01:21** demonstrates the optional layer's advisory mode. Jev uses its native TypeSafe API; self-hosted models expose a compatible local API; external providers use a dedicated endpoint or an existing API connection. The three provider cards are alternatives, not three calls made for each batch. Batch identity/scope is preserved. Stage 2 visualizes source permission, listened scope and policy checks; semantic admission remains the Router's job. Stage 3 returns intent advice only; the `INTERVENE` label neither grants authority nor creates work. Router checks original evidence and authorization before delegating. Failed advice falls back to Router. No measured token count or classifier accuracy is fabricated.

Direct chapter preview: `http://localhost:3417/Decision-Layer-Walkthrough`. Configuration and process are also separately editable as `Decision-Layer-Settings` and `Proactive-Listening`.

The on-screen corner label was removed at the user's request. This remains an authored product concept preview, with staged activity and results; its purpose and boundaries are documented here rather than watermarked on every shot.

## Validation

```sh
npm run lint
npm run build
```

`check-frames.mjs` bundles the project and checks selected still frames with Remotion’s renderer. Pass the path of a local Chromium executable as its first argument. `verify-preview.py` uses Playwright against an already running Studio; it checks scene states, simulated cursor hit positions, editable scene properties and playback. Run it with a Python environment that has Playwright and Chromium installed.

```sh
node scripts/check-frames.mjs /path/to/chromium
python scripts/verify-preview.py
python scripts/check-playback.py
python scripts/verify-feishu.py
python scripts/verify-decision-scenes.py
```

The `scripts/capture-*.py` helpers are development evidence tools for the isolated Roppo fixture, not required for playing or editing the video. They do not use a real user session.

## Credits

Roppo mark and layout references come from the Roppo project. Feishu’s icon identifies an illustrative integration; no endorsement is implied. No third-party footage, stock music or external font downloads are used.

## Export

From this demo directory:

```sh
npx remotion render src/index.ts Roppo-Concept out/roppo-concept-1080p.mp4 --codec=h264 --crf=16 --pixel-format=yuv420p
```

## License

Original demo source is covered by the repository's [Apache-2.0 license](../../LICENSE). Remotion retains its [own license](../../docs/licenses/remotion-LICENSE.md); it is a separate video-authoring dependency and is not needed to run Roppo. Feishu branding is used only to identify the illustrated integration.
