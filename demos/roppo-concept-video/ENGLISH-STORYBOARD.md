# Roppo — English walkthrough

177 seconds · 1920 × 1080 · 30 fps · English UI and captions · no voiceover.

The Chinese composition and its published 159-second MP4 remain unchanged. This English variant uses Slack and Linear throughout, including the integration settings, incoming task attribution, decision-layer example, issue lifecycle and final report.

## Story

| Time | Scene |
| --- | --- |
| 00:00–00:05 | Roppo opening |
| 00:05–00:12 | Personal assistant and organizational coordination |
| 00:12–00:18 | Local account sign-in |
| 00:18–00:26 | Connect a model |
| 00:26–00:34 | API, supported subscription, or local CLI |
| 00:34–00:42 | Configure Router and Workers |
| 00:42–00:50 | Per-role instructions and tools |
| 00:50–00:59 | Slack channels, Linear projects and MCP tools |
| 00:59–01:08 | Jev, self-hosted or external advisory model |
| 01:08–01:21 | Batch → check rules → assess intent → Router decides |
| 01:21–01:32 | Slack discussion; Roppo picks up the request without a mention |
| 01:32–01:41 | Linked Linear issue ENG-248; Todo → In Progress |
| 01:41–01:48 | Router receives the task in Roppo |
| 01:48–01:59 | Workers coordinate; live tool and task activity |
| 01:59–02:08 | Browser profile and human takeover |
| 02:08–02:16 | Files, code and verification evidence |
| 02:16–02:25 | Natural-language stop, scope update and continuation |
| 02:25–02:34 | Linear: In Progress → In Review; evidence attached |
| 02:34–02:43 | Slack: report, linked issue and human acknowledgment |
| 02:43–02:51 | Local deployment and open-source configuration |
| 02:51–02:57 | Closing |

## Edit and render

From `demos/roppo-concept-video`:

```sh
npm ci
npm run dev -- --port=3418
```

Open `http://localhost:3418/Roppo-English`. The four Slack/Linear scenes have their own editable compositions under **English-scenes**. Each complete scene is independently selectable in the main timeline. The original Chinese scenes remain under **Scenes**.

```sh
npx remotion render src/index.ts Roppo-English out/roppo-english-1080p.mp4 --codec=h264 --crf=16 --pixel-format=yuv420p
```

English scene source lives in `src/en/`; the variants intentionally have separate copy and integration scenes so editing the English story does not rewrite the approved Chinese version. Layout, cursor interpolation and camera motion share the existing design system. All animations derive from the Remotion frame.

## References and boundaries

- [Slack quick-start guide](https://slack.com/help/articles/360059928654-How-to-use-Slack--your-quick-start-guide): workspace rail, channel sidebar, channel header, message list and composer.
- [Linear issues](https://linear.app/docs/creating-issues): issue identifiers, titles, status, team and editable properties.
- [Linear–Slack integration](https://linear.app/docs/slack): linked issues and discussion context.

The interface replicas are authored React scenes informed by these product references. Acme, the people, ENG-248, comments, issue status changes, code and verification counts are staged. Roppo's proactive intervention and Worker execution are the concept being illustrated; they are not presented as built-in Slack or Linear behavior. No real Slack message, Linear issue or model request is sent during preview or rendering. This is not production connector acceptance.

The optional classifier provides advice. Router retains the final decision and verifies the approved scope. Batching and short context reduce repeated work; no measured token saving is invented. In Review means the fix awaits human review, not deployment.

## Validation

```sh
npm run lint
node scripts/check-english-frames.mjs /path/to/chromium
python scripts/verify-english.py
python scripts/check-english-playback.py
python scripts/verify-english-export.py /path/to/roppo-english-1080p.mp4
python scripts/play-english-export.py /path/to/roppo-english-1080p.mp4
```

The browser scripts expect Remotion Studio on port 3418 and a Python environment with Playwright and Chromium. Export verification uses the FFmpeg binaries bundled with Remotion on macOS arm64. It checks the expected 5,310 frames, 177-second duration, H.264/yuv420p format, every decoded frame, MP4 fast-start layout, and browser playback/seeking.
