# Chat companion and centered conversation

The Chat header contains a small Roppo that opens Team activity. Messages, tool groups, file cards and the composer share an 800px maximum reading column. Desktop avatars occupy an independent left gutter; below a 680px conversation width they move into the speaker row. Opening the resource panel or expanding navigation remeasures the available chat lane. The composer compensates for reserved scrollbar gutters.

Existing font sizes are retained: desktop message and input 15px, model controls 12px; at the existing 700px viewport breakpoint, message 14px, input 16px and model controls 11px. The new companion uses 13px for its name and 12px for status. Input focus, attachment arrival, input height and send/stop icon transitions use short, restrained motion. Existing IME, draft, attachment, send/cancel and scroll-follow behavior is retained. Tool groups initially collapse.

## Real task status

`superagent_status` is offered to Chat-bound Router and Worker activations when their explicit tool selection permits it. It accepts a one-line public `label` of at most 48 characters and `phase: thinking | working | reviewing`. The same model activation generates this short description; there is no polling model or separate status-generation request. Existing task/tool events provide fallback text when a model does not report a label.

The status is retained on its execution call and projected through the existing Chat SSE stream. Duplicate updates do not rewrite it. Ended or aborted activations cannot update the label. Frontend selection filters by the current run and selected Worker; completed activities and older runs are ignored. A newer live tool operation supersedes an older model description.

Waiting, completion, cancellation, failure and connection status take priority over model wording. The model cannot set those lifecycle states through this tool. Nonterminal visual changes have a 1.4 second minimum display interval; a new run, participant switch or terminal state updates immediately. Completion celebrates only after an observed active run, rather than on every history load.

## Motion assets

The generated body layer and exact prompt live in `src/ui/assets/agents/roppo-body.webp` and `roppo-body.prompt.txt`. Separate layers provide breathing/blinking, thinking, typing, reviewing, waiting, completion, failure, stopped and disconnected poses. Thinking uses a head tilt and gaze shift, waiting raises the gaze and settles, and completion smiles with curved eyes and sways gently left and right. Failed execution shows two spiral eyes rotating slowly in opposite directions. Hands only accompany the laptop and review sheet. The fixed raster silhouette removes frame-to-frame shape drift.

Eye shapes crossfade over 220ms. A short additive Web Animations transition carries the currently displayed body pose into the next CSS motion, including when interrupted by another status change. Completion settles back to idle after its existing 2.4 second celebration window. CSS and native Web Animations handle motion without an animation library or production GIF.

The companion pauses on document visibility changes and removes motion when `prefers-reduced-motion` is set. Controls remain usable with keyboard and touch. Closing the resource panel restores focus to the button that opened it.

## Verification

Rebased onto main `37091a2`, retaining its Chat model picker, model-switch history and native backend updates.

- `npm run typecheck` passed, including Chat and plugin views.
- `npm run build:chat` passed.
- 110 tests passed across Chat, companion state, execution activity, Chat assets and delegation regression suites.
- `examples/chat-companion-acceptance.ts` is an isolated deterministic model fixture. `tests/browser/chat-companion.py` exercises the real HTTP/SSE and task lifecycle without external model calls.
- Browser checks covered 1440, 1024, 800, 700, 390 and 320px widths; exact content/composer alignment and original computed font sizes; IME, Shift+Enter, file upload/send, model status, working motion, completion, cancellation, failure, Worker waiting, reconnect, resource panel, focus return, scroll position and reduced motion. No page errors were observed.
- Additional browser checks covered the main model/reasoning picker and its draft/focus preservation, multi-line height limits, expanded navigation, dark-theme contrast, selected Worker isolation, draft preservation and a simulated visibility-change event.
- The expression update passed Chat typechecking, the production Chat build, 11 companion/assets tests and the HTTP/SSE browser suite again. Dedicated rendered-component checks verified smile/sway and counter-rotating spirals in both themes, 18 rapid pose changes, interrupted eye crossfades, pause/resume, reduced motion, completion settling and unmount cleanup; results are in `.local/companion-motion/checks.json` and `.local/companion-expression-evidence/`.
- Acceptance screenshots and machine-readable results are in `.local/companion-integrated-evidence/`; the standalone animation gallery and GIF are in `.local/companion-preview/`.

Run the fixture in one terminal, then the browser test using a Python environment with Playwright installed:

```sh
npx tsx examples/chat-companion-acceptance.ts .local/companion-check
python tests/browser/chat-companion.py .local/companion-check .local/companion-check-evidence
```

These checks verify the interface, status transport and lifecycle projection with a deterministic provider. They do not claim a live subscription/API provider acceptance run. No security scan was run.
