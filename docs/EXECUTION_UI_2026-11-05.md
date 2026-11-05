# Execution UI and live calls — 2026-11-05

Execution opens on **Calls**, using the user-owned Tool Access Map composition: a selected Router/Worker at the center, related software/Workers/tools around it, and rounded animated connections. **Configuration** retains the editable software → Router → Queue → independent Worker cards. The existing header and sidebar remain unchanged. English is the default; the existing Chinese preference is retained.

## Using the page

- In **Calls**, switch the Router/Worker tabs or click a related Worker to change the center. The tab indicator slides, content reveals and connections draw using the study's motion. Click a tool or call count to inspect status, duration and actual service/model; details can open the existing task view.
- **Preview animation** runs a separately labeled visual overlay without executing tasks, tools or model calls. It leaves actual records/counts untouched. **Stop preview** removes that overlay. Normal running flow uses only recorded operations. Calls uses the saved runtime Workers, even if Configuration has an unsaved count change.
- In **Configuration**, **New connection** opens the software catalogue; **New service** opens the model service form. Both use the existing host check/save APIs. Select the Router service/model independently, set **Count** to 1–10 and choose each Worker's service/model. **Save changes** applies settings to new conversations; **Discard** restores the saved execution settings.
- Configuration headings select their tool map. On narrower layouts that map scrolls into view; its owner button returns to the configuration card. A dot on the Configuration tab indicates an unsaved execution draft.
- **Edit instructions** opens Router/Workers tabs. Worker instructions are shared by all Workers; the label explicitly states that scope. Saving instructions preserves an unsaved execution configuration.
- Running edges have the motion supplied by the “复刻 X 链接中的 UI 动效” chat. Idle/returned calls do not continuously animate. Tool **Returned** means the function returned; a managed background job can continue after that response.

There is no replay action in this view. Inputs, outputs and detailed job results remain in the existing task resources. This avoids silently repeating side effects or copying command arguments and credentials into the graph.

## Runtime contract

`Runtime.runModel` records Router, Worker and subagent activations. `WorkerTools.call` records managed tool invocations, including the legacy worker bridge. Router resource calls use the same recorder. This is provider-neutral and preserves the existing Codex / Responses / Chat Completions / Anthropic execution paths.

`architecture.activity` in the operator-authenticated `/entry-workspace` projection contains bounded metadata: stable call ID, parent ID, role/tool, Worker association, originating entry, actual backend/model when reported, server timestamps and terminal state. Model retries remain part of the same activation; each actual host tool invocation has its own ID. Complete snapshots avoid browser-side event replay or out-of-order terminal-state rollback.

Only the latest 200 terminal records and currently running calls are retained. Running records are recovered as interrupted after restart. The existing database schema remains version 5; no task/history migration or replay is performed. Historical work from before the recorder was added is not reconstructed. Existing backups include the additional records, and older code ignores the additional record kind.

The browser polls once per second only while the execution view is mounted. Updates preserve form DOM and drafts. Disconnection retains the last known state and stops running flow with an unknown state; a 401 uses the existing reconnect flow. In-flight responses for an unmounted view are ignored. Reduced motion disables flow and entry movement. Animation, observer and scroll listeners are cleaned up when the view changes. Compact containers above 400 px retain the three-column graph and SVG motion; smaller containers use a card grid, with preview pulses instead of crossing wires.

## Acceptance

| Check | Result | Evidence/boundary |
| --- | --- | --- |
| TypeScript and complete suite | passed | 27 files, 350 tests |
| Existing form/API integration | passed | 11 DOM + real host API checks; three API formats use isolated loopback providers |
| Browser controls and persistence | passed | 1/10 Worker boundaries, individual model save/refresh, new service/connection, prompt saving and retained drafts |
| Independent cards and selection | passed | All ten Worker cards have 12 px corners; Worker 10 selects its own tool map |
| Ten-card scrolling | passed | Sticky tools remain in the viewport; measured top 88 px in the 1725 × 1103 desktop fixture |
| Native Codex backend | passed | Two actual Router/Worker tasks, four managed tool invocations, two delivered replies; read-only Seatbelt workspace, no file changes |
| Live browser state | passed | Actual running Worker flow observed; actual shell/wait records and durations inspected, including actual Codex model |
| Calls composition and preview | passed | Center/perimeter layout, retained animated actor tabs, preview toggling without host mutation; unrelated Router/subagent calls cannot impersonate the selected Worker's activation/model |
| Actual preview-pane motion | passed | 729 × 886 viewport, 465 px page / 431 px map; SVG remains displayed; running preview stroke offset observed changing from 0.0270588 to 0.474118 |
| Disconnect/reconnect | passed | Last known state retained; the same eight native call records remain after restart/re-authentication |
| Chinese/English and narrow layout | passed | 390 × 844; no horizontal overflow; tool details and history remain usable |
| Motion/accessibility | passed | Reduced-motion CSS, keyboard history selection, Escape close and focus return; no full accessibility audit claimed |
| Existing real host | passed | Saved configuration/revision, six verified entry types and ten native run identities preserved; idle restart with verified backups |
| Fresh office/client-message E2E | not_run | This round does not repeat desktop-client or office transport acceptance; native validation submitted through the isolated host API |
| Linux/device/cross-browser | not_run | No new Linux sandbox or physical-device acceptance in this UI change |

Native backend evidence is separate from a desktop-client message round trip. No new real Feishu/WeCom/API-provider acceptance is claimed. The isolated visual fixture uses inert office adapters and synthetic client inspection only to match the sample content; it is not evidence of those integrations working.

Screenshots are in [ui/acceptance/execution-2026-11-05](ui/acceptance/execution-2026-11-05). `real-call-map.jpg` and `real-motion-preview.gif` show Calls on the actual 729 px preview pane; `call-map-wide.jpg` / `motion-preview.gif` use an illustrative desktop fixture. `call-map-comparison.png` compares the original study, desktop implementation and actual compact deployment. `call-map-native-detail.jpg` shows real Shell call details on the new view: two Shell and two Job invocations, six records for Worker 1, eight records across the Router/Worker validation. `desktop.jpg` / `real-host.jpg` show Configuration. `native-running.jpg`, `call-detail.jpg` and `mobile-zh.jpg` show earlier native-backend checks of that configuration layout. Private tokens, state, native IDs and raw command output are excluded from Git.

The original real browser's ten-Worker draft was retained and restored without saving it. The host continues to use its saved two-Worker configuration until the operator explicitly saves a change.

## Component sources

- affectUI free MIT Button and Segmented Control: `src/vendor/affectui`.
- User-owned Tool Access Map motion and integration handoff: `src/vendor/tool-access-map`.
- Official Feishu/WeCom favicons, embedded locally: `src/ui/assets/README.md`.
- No React runtime, animation package or affectUI Pro source was added.
