# Roppo CLI

Run `roppo` from any directory to continue your personal conversation with the Router. `roppo -c` and `roppo -p "prompt"` use that same personal Chat by default. The current directory is used for attachments and terminal preferences; it does not create a project conversation. Page Up and Page Down scroll history. Paging back at the beginning loads earlier messages. Terminal and web sessions use the same account, messages, tasks and files. Workers run on the host and continue after the terminal exits.

## Install and connect

Use Node.js 22.19 or newer. The interactive screen uses OpenTUI and the Bun runtime installed with this project; no global Bun or Node upgrade is needed. The host and print commands stay on Node. From the checkout, run:

```sh
npm ci
npm link
roppo --version
```

On macOS Terminal, if the dotted companion has two horizontal gaps, install the
included font/profile with `npm run setup:terminal-font`, open
`~/.roppo/terminal/Roppo.terminal`, and run `roppo` in that window. This profile
uses Roppo Mono to keep dot spacing consistent across text rows. Existing
Terminal profiles retain their fonts. See [font setup](../assets/terminal/README.md).

For a new installation, run `roppo`. The terminal starts the local service when needed, asks you to create a local account, and walks through a model connection, connection check and save. Passwords and API keys are hidden. Save the displayed account recovery code privately. `roppo init` reruns this setup without entering the conversation. API setup supports OpenAI, Anthropic and compatible Chat Completions/Responses/Messages endpoints. ChatGPT OAuth uses the existing provider sign-in link in your browser; account selection, background-use consent and model selection stay in the terminal. Existing local Codex connections can be reused. A fresh setup creates one initial Worker and enables personal memory. Existing Workers retain their settings. For an existing instance, run `roppo login`. To select a specific local instance, run `roppo login --host http://127.0.0.1:4337`. Match the code printed in the terminal with the browser and click **Connect terminal**. The CLI remembers the selected host. `roppo logout` revokes this terminal credential.

The CLI can read a launcher connection file through `ROPPO_CONNECTION_FILE`. It uses the URL in that file. `--host` and `ROPPO_HOST` take precedence. Credentials are stored per host in private files under `~/.roppo/terminal`. Set `ROPPO_CLI_HOME` to use a separate terminal profile and `ROPPO_HOME` to select the personal service directory (default `~/.agent-hub`). The automatically started service writes logs under that directory’s `logs/terminal-service.log` and continues after the terminal exits; OS login startup remains a separate host setting.

The CLI interface uses English. Replies follow the host’s existing language policy.

## Your personal conversation

```sh
roppo
roppo -c
roppo -p "Help me plan tomorrow"
```

The main transcript shows your messages and public Router replies. Internal Worker conversations and task logs stay out of the default view. Delivered files appear as file notices and remain available through `/files`. The welcome screen does not ask you to select a project or manage Workers.

Type `/` to browse commands and `@` to browse local files and directories. As you type a slash command, suggestions narrow by command-name prefix: `/e` shows `/effort` and `/exit`, and `/ex` shows only `/exit`. Backspace expands the list again; command descriptions do not affect these suggestions. File names with spaces are quoted on insertion. Ctrl+P opens a searchable command palette. Slash commands are ordered by command name; Commands, settings and resource menus (Workers, models, plugins, skills, MCP and files) are ordered by displayed name A–Z, ignoring case and using natural numeric order. New entries inherit this shared rule. Conversation search retains message order; queued drafts retain their execution order. Use the mouse wheel or trackpad to browse, drag the scrollbar, and click an item to choose it. Arrow keys select, Enter confirms, and Esc closes a menu while preserving the draft and cursor. Shift+Enter (where supported), Alt+Enter or Ctrl+J inserts a newline. Bracketed paste stays in the draft until Enter, including pasted slash commands.

While Router is processing, `/input` selects **Queue** (the default) or **Steer**, saved as the terminal's `inputMode` preference. Click the mode label below the draft, or press Tab when no completion menu is open, to switch. Enter submits in the selected mode. When Router is idle and the queue is empty, Enter sends normally in either mode.

Queue keeps unsent messages and attachment paths in a local draft list above the composer. Router receives one draft at a time after its current turn finishes; independent background Workers do not block this. Use `/queue` or click a queued row to edit its text, delete it, move it up/down, or choose **Steer now**. Editing pauses delivery of that item until you confirm or cancel. In the queued-message editor, Enter saves, Shift+Enter inserts a newline where supported, and Esc cancels. Apple Terminal sends Shift+Enter as ordinary Enter, so its hint shows Ctrl+J for newline. You can also click **Insert newline** at the cursor. Alt+Enter and Ctrl+J remain newline alternatives for terminals that do not distinguish Shift+Enter. The queue supports mouse scrolling and pause/resume. Drafts survive CLI restarts under the CLI profile's `queues/` directory, scoped to host and conversation, and restore paused. They are not web messages until sent; the CLI must be open to drain them. Interrupted runs and send failures pause the queue. Clearing the shared conversation also prevents older queued context from being sent automatically.

Steer submits the message immediately. During an eligible live Router tool turn, the host applies it as an explicit task update without asking another model to classify it, and fences obsolete proposed actions. If the current turn cannot accept updates (including attachment inputs, planning turns, or disabled interjections), the message follows the host's normal next-turn path and the CLI says so. Already-running tools finish their receipt; steering does not forcibly terminate them. Queue retries reuse the message identity and uploaded attachment IDs to avoid duplicate messages after a lost acknowledgement.

Each fresh interactive launch plays a two-second full-screen pixel tide from left to right, then a 1.4-second top-center peek and wave. Typing, clicking, or opening a menu skips it; typed characters remain in the draft. `/animation` toggles the companion; disabling the companion or choosing reduced motion skips startup. Host updates, resizing and re-enabling the animation do not replay it.

The header shows `roppo`. Click `Open web ↗` at the bottom left to open this same conversation in your browser, or `Commands · ctrl+p` at the bottom right to search commands. The space between them has no click action. Browser and CLI use the same local service and account: Router/Worker models, reasoning settings, permissions, memory, schedules and conversation messages are shared. Saved model changes in the web settings also refresh an idle CLI; terminal appearance preferences remain local.

The top-center companion reuses the web’s activity states and recreates its R-shaped character as terminal dots: greeting, breathing, blinking, thinking, typing, reading and task handoffs. It occupies four character rows plus one caption row, outside the transcript. `/animation` immediately hides or restores it and saves the choice. The existing reduced-motion setting shows a static character; terminals shorter than 19 rows temporarily hide it to preserve the input area.

The screen uses OpenTUI's alternate screen, native text input, Markdown and scroll container. Empty conversations show a centered wordmark and compact filled input with no scrollable filler. Existing conversations open directly. Messages scroll above the fixed composer. Internal Workers stay out of the transcript; `/tasks` opens execution details on demand.

An eight-cell activity strip runs during real work and disappears on completion or when a response is needed. Replies update from host events without an artificial typing delay. Reading older messages pauses automatic following; Ctrl+End returns to the latest reply. `/settings` offers animation and theme controls. Esc or Ctrl+C interrupts the current run when no menu is open. Idle Ctrl+C clears a draft, or exits from an empty input. Ctrl+D on an empty prompt and `/exit` leave the host running.

Ctrl+Y and `/approvals` review pending permissions, Router choices, structured questions and file deliveries. `/files` previews delivered text and saves files to a chosen path without overwriting existing files. `/memory` reviews, edits or forgets personal memories. `/schedules` reads, pauses and resumes scheduled actions; describe new reminders and timing changes in the same chat. `/tools` searches capabilities, and `/open` opens this conversation in the browser.

`/history` searches this conversation; `/resume` and `/new` are no longer interactive navigation commands. `roppo -r` remains a script/project compatibility option. The default navigation has one continuous personal conversation and no project or Worker session tabs. `ROPPO_LEGACY_TUI=1 roppo` temporarily selects the previous renderer for troubleshooting; it uses the same host and conversation.

## Attachments

Click **+ Attach**, press **Ctrl+O**, or type `/attach` to open the system file chooser on macOS or Windows. Browse any accessible directory and select multiple files at once. The picker starts in the current directory, then remembers the last selected folder for this CLI session. Cancelling preserves your text and existing attachments. Other platforms use the in-terminal browser; `/attach --browse` opens that browser explicitly, with A–Z sorting, mouse scrolling and keyboard selection. `/attach "path/to/file.pdf"` adds a file directly. Selecting a file from `@` suggestions also adds it to the attachment draft.

Selected files appear above the input with their names and sizes. Click a file’s `×` to remove it, or open `/attach --browse` → **Remove attachment…**. Add multiple files, then press Enter to send them with your text; an attachment-only message is also supported. Files upload when you send. Failed sends retain the text and attachments for retry. Ctrl+C clears an unsent draft and its attachments.

Limits match the web workspace: up to 32 files, each at most 100 MiB. Images, PDFs, documents and other regular files use the existing conversation upload API. Sent attachments are visible in the same web conversation. The unsent local file selection belongs to this terminal window. `--file` and manually typed `@"path"` references remain supported.

## Settings and session controls

Type a slash command to open a searchable picker. Arrow keys move, Enter selects, and Esc returns to your draft. The following commands work against the running host:

| Command | Behavior and scope |
| --- | --- |
| `/attach [path \| --browse]` | Open the system file chooser, attach a path directly, or use the terminal browser |
| `/settings`, `/config` | Terminal preference picker; `/config key=value [user\|project\|local]` saves a value |
| `/theme` | System, dark, light or monochrome screen colors |
| `/connect` | Add an API/OAuth connection, test it, then use it for Router or save it to the connection library |
| `/workers` | Add, duplicate, pause, enable or remove Workers; removal is confirmed and active tasks must finish first |
| `/plugins`, `/skills`, `/mcp` | Separate existing capability lists, details and a draft request for Router to manage an item |
| `/animation` | Toggle the small top-center companion; on by default, preference saved between launches |
| `/compact` | Compact older context now, toggle automatic compaction, or change its threshold |
| `/model` | Choose Router or Worker, then a specific Worker if needed, a connection and model |
| `/effort` | Choose Router or Worker, then click or drag a stepped reasoning slider; ←/→ also adjusts, Enter confirms, Esc cancels, and Default (D) selects the model default for confirmation |
| `/plan` | Choose Plan (clarify requirements, then produce a detailed plan) or Act (normal conversation) |
| `/permissions` | Select `ask` or `full` for the **shared account**; existing source sandbox limits still apply |
| `/status` | Connection, shared conversation, model, permissions and loaded preference files |
| `/context` | Recorded input-token/context measurements; unavailable measurements are shown as unavailable |
| `/clear` | Confirm clearing messages and working context; keep long-term memory and scheduled actions |
| `/rename` | Choose a Worker, then edit its display name |
| `/diff` | Choose a Worker, then one of its tasks to inspect Git changes |
| `/files` | Preview and save delivered files |
| `/memory` | Review, edit and forget shared personal memory |
| `/schedules` | Read, pause and resume scheduled actions |
| `/history` | Search this conversation and load older messages |
| `/input` | Choose Queue or Steer for input submitted while Router is processing |
| `/queue` | Manage local pending messages: edit, delete, reorder, steer now, pause/resume |
| `/approvals` | Review and answer pending permission requests without entering task IDs |

Click the model name below the draft to open `/model`, or the adjacent reasoning level to open `/effort`. The reasoning slider includes only levels supported by the selected model, ordered from lowest to highest intensity. Dragging previews a change; Confirm or Enter saves it. Default (D), followed by confirmation, removes the explicit override. Models without adjustable levels show an explanation instead of a slider.

Each reasoning level has its own bright color. A pixel curtain sweeps left to right across the entire slider, including the unselected portion, then clears to reveal the track. The selected marker remains visible throughout. Click the track or its level labels, or drag across the pixel area to adjust. Short terminals reduce the animation height; `motion=reduced` keeps a static track, and the monochrome theme uses neutral shades. Closing the picker stops its animation.

Model and effort changes apply to the selected Router or Worker and are shared with the web. Router turns already accepted retain their captured model binding. Worker renaming changes its display name and preserves its identity and tasks. Permission changes affect the account's web and terminal sessions. The permission picker spells out this scope; full access requires a confirmation in the new interface. Terminal credentials use narrow settings endpoints and cannot submit arbitrary host configuration patches.

Plan mode asks focused questions about the goal, constraints, scope and acceptance criteria before writing a detailed plan. It uses a separate text-only Router turn with tools and Worker dispatch disabled. It can use conversation text; it does not inspect attachment contents or the workspace. The mode label appears above the input. Use `/plan` to return to Act, then send an explicit execution instruction. Switching modes does not launch work or stop existing tasks and reminders. The mode is shared with this conversation's web and print clients.

Clearing stays in the same personal conversation. The confirmation defaults to Cancel; messages that arrive while it is open require reviewing and confirming again. Finish or stop active requests first. Clearing deletes visible messages and starts fresh working context, preserving long-term memory, reminders, files and task audit records. It is not a secure purge of execution archives. This also clears the shared web transcript.

`/diff` shows recorded project changes or an available managed Git worktree. Ordinary non-Git tasks may have no comparison baseline; use `/files` for their deliverables. Shared workspaces can contain changes from several cooperating Workers. `/history` and Ctrl+K search loaded conversation messages, with an option to load earlier messages.

For initial configuration gaps and the corresponding web settings, see [CLI settings inventory](CLI_SETTINGS_GAPS.md).

Terminal preferences load from these sources, from lowest to highest priority:

1. Built-in defaults.
2. `~/.roppo/terminal/settings.json` (or `$ROPPO_CLI_HOME/settings.json`).
3. `.roppo/settings.json` in the selected `--cwd` directory, or launch directory.
4. `.roppo/settings.local.json` in that directory.
5. `--settings '{"theme":"mono"}'` or `--settings path/to/settings.json`.
6. Dedicated launch flags such as `--theme`, `--verbose` and `--timeout`.

Supported keys are `theme` (`black-blue`, `black-red`, `mono`, `white-blue`, `white-red`, `system`, `dark`, `light`), `verbose` (boolean), `motion` (`full` or `reduced`), `outputFormat` (`text`, `json`, `stream-json`) and `timeout` (seconds, greater than zero and at most 86400). Unknown keys and invalid JSON produce an error with the source path. `--help` and `--version` work independently of these settings files. Project preferences cannot grant permissions, change the host or inject credentials. Add `.roppo/settings.local.json` to your project's `.gitignore` when using local preferences.

```sh
roppo --theme dark --verbose
roppo --settings '{"theme":"mono"}'
# Inside a session:
/config verbose=true
/config theme=light local
```

A `/config` edit takes effect immediately in the current session, and saves to `user` scope unless another scope is specified. On the next launch, normal file/flag precedence applies again.

| Shortcut | Action |
| --- | --- |
| Ctrl+P | Search commands |
| F2 | Choose model |
| Ctrl+K | Search this conversation |
| Ctrl+Y | Review pending requests |
| Ctrl+C / Esc | Close menu or interrupt work |
| Ctrl+D | Exit from an empty prompt |
| Shift+Enter / Alt+Enter / Ctrl+J | New line |
| Page Up / Page Down | Scroll history; Page Up at the beginning loads older messages |
| Ctrl+End | Return to the latest reply |
| Ctrl+Shift+C | Copy selected text |
| Mouse wheel | Scroll messages or document previews |

The interface restores terminal modes on exit. Keep mouse reporting enabled in your terminal for in-app scrolling and selection. Apple Terminal may send Enter and Shift+Enter identically; Alt+Enter or Ctrl+J works there without changing terminal settings.

## Context compaction

`/compact` opens **Compact now**, **Automatic compaction**, and **Trigger threshold**. Automatic compaction defaults to on at 80%; the picker offers 60%, 70%, 80% and 90%. These settings are stored by the host for the account and also apply to turns sent through the web. `/compact now`, `/compact auto on`, `/compact auto off`, and `/compact threshold 70` work directly. The accepted threshold range is 50–95%.

Before a new personal Router turn, the host uses the most recent measured model context capacity when available; otherwise it uses the serialized host context budget. If neither is available, it uses the retained history size against the personal scope budget (128,000 bytes for an unscoped legacy conversation). Byte limits are not token estimates. Existing backend compaction during a long tool turn remains separate from this between-turn host setting.

Compaction asks the selected Router model for a bounded summary of goals, constraints, decisions, unfinished work and confirmed outcomes. It has no tools or Worker execution. The last three complete turns normally remain verbatim; short histories retain their last complete turn. Earlier original messages stay searchable, scoped journal originals remain readable, and long-term memory, files, schedules and Worker jobs are retained. The next Router inference starts fresh with the summary and current state. A summary may omit detail, so originals remain the source of truth. A failed summary does not replace working context; automatic failure leaves the request available for retry. No compression can make a single oversized new prompt fit automatically.

Manual compaction waits until the Router is idle. A newly sent message queues behind an in-progress summary. `/clear` remains the separate confirmed action that removes shared conversation messages and resets working context.

## Use in scripts

```sh
cat notes.txt | roppo -p "Summarize these notes"
roppo -p "Summarize the supplied file" --file notes.md --json
roppo -c -p "Report the results" --timeout 120
roppo -p "Summarize progress" --output-format stream-json
```

Only explicit project mode needs folder registration: use `--cwd DIRECTORY --trust-project` for a new project. A print invocation waits for its own run and associated Worker tasks. Plain output contains the reply. With `--json`, stdout contains one object with `conversationId`, `runId`, `status`, `text`, `tasks` and `deliveries`. Startup and transport errors return an error object. Use the conversation ID with `-r` to continue.

| Exit code | Meaning |
| --- | --- |
| 0 | Completed |
| 1 | Failed, unavailable, or sign-in required |
| 2 | Invalid command or input |
| 3 | Waiting for a decision or clarification |
| 124 | Wait timed out. The host continues the run |
| 130 | Cancelled or interrupted |

### Streaming output

`--output-format text|json|stream-json` selects print mode. `--json` is the existing JSON alias. A stored `outputFormat` preference only changes print output; it does not turn an interactive launch into a script.

`stream-json` emits newline-delimited JSON with no terminal decoration:

- `system` with `subtype: "init"`, `conversationId`, `runId`, and the web URL after the host accepts the message.
- `assistant` with a `message` containing its stable `id`, text, status and speaker. Each changed record **replaces** that message; it is not a token delta. Private Router-to-Worker messages are excluded.
- `task` with the latest changed Worker task.
- Exactly one final `result` with the normal result fields. Startup or transport failure uses `status: "error"`, `code` and `error`.

The client polls run snapshots, so a fast reply may appear only once. This is Roppo's event schema, not Claude's wire protocol. Ctrl+C requests cancellation and exits with 130. Reaching `--timeout` exits with 124 while the host continues working.

## Optional project compatibility

```sh
cd ~/work/my-project
roppo --cwd . "Review the change and run the relevant tests"
roppo --cwd . -c
roppo --cwd . -r
roppo --cwd . -r <conversation-id>
```

On first use of a new folder, Roppo shows its resolved project path and requested access. Subdirectories use the nearest Git root or a more specific registered workspace. Git projects with an existing commit use per-task worktrees. Empty repositories and other new directories use read-only access. Existing sources keep their configured workspace and permissions. Registering a new source uses the host's configuration update and requires an idle host. A subscription restricted to a specific source uses that registered source.


## Interface reference

The interactive screen follows OpenCode's input, searchable overlays, Markdown and activity feedback. Roppo retains one personal Router conversation, its local service and internal Worker collaboration. The host continues to own authorization, memory, schedules and file delivery.

- [OpenCode TUI documentation](https://opencode.ai/docs/cli/tui/)
- [OpenTUI runtime support](https://opentui.com/docs/getting-started/runtime-support/)

The interactive renderer runs on the bundled Bun because current OpenTUI requires Bun 1.3.14+ or Node 26.4+ with experimental FFI. Print mode and the service continue to support Node 22.19+.

### System file chooser implementation

`src/terminal/file-picker.ts` launches the platform helper without a shell. `file-picker-macos.js` uses macOS Standard Additions; `file-picker-windows.ps1` uses the Windows Forms file dialog with multiple selection enabled. Paths are passed as arguments or environment values, never interpolated into executable code. `tui-actions.ts` connects the chooser to the attachment draft and falls back to the terminal browser when unavailable. The attachment TUI test covers multi-selection, cancellation, retained drafts, and remembered directories.

Platform references: [Apple file chooser](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/PromptforaFileorFolder.html), [Windows file dialog](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/openfiledialog-component-overview-windows-forms).
