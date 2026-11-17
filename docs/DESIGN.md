---
name: Roppo
description: White and dark operator workspace
colors:
  green: "#171717"
  green-hover: "#333333"
  green-soft: "#f0f0f0"
  ink: "#171717"
  body: "#444444"
  muted: "#666666"
  line: "#e5e5e5"
  surface: "#ffffff"
  soft: "#fafafa"
  rail: "#ffffff"
  amber: "#805400"
  amber-soft: "#fff8e8"
  danger: "#a82b32"
  focus: "#737373"
  button-line: "#e5e5e5"
  nav-active: "#f0f0f0"
  team-edge: "#a3a3a3"
  team-selected: "#f0f0f0"
  field-line: "#aaaaaa"
  segment-tray: "#f0f0f0"
  segment-ink: "#171717"
typography:
  headline:
    fontFamily: '"Avenir Next", "PingFang SC", system-ui, sans-serif'
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"Avenir Next", "PingFang SC", system-ui, sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  inspector-title:
    fontFamily: '"Avenir Next", "PingFang SC", system-ui, sans-serif'
    fontSize: "18px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"Avenir Next", "PingFang SC", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Avenir Next", "PingFang SC", system-ui, sans-serif'
    fontSize: "14px"
    fontWeight: 550
  help:
    fontFamily: '"Avenir Next", "PingFang SC", system-ui, sans-serif'
    fontSize: "12px"
    lineHeight: 1.6
  segmented-label:
    fontFamily: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1
rounded:
  status: "4px"
  button: "6px"
  field: "7px"
  workspace-choice: "8px"
  avatar: "10px"
  node: "12px"
  segmented-tray: "13px"
  panel: "16px"
spacing:
  inline-small: "8px"
  inline: "12px"
  compact-panel: "16px"
  field-stack: "20px"
  panel: "24px"
  map: "28px"
  columns: "32px"
  content-inline: "40px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-text:
    textColor: "{colors.green}"
    padding: "5px 0"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "10px 11px"
  nav-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.green}"
    rounded: "{rounded.button}"
    padding: "0 12px"
    height: "38px"
  status-green:
    backgroundColor: "#eef8f1"
    textColor: "#21683e"
    rounded: "{rounded.status}"
    padding: "3px 6px"
  inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  team-node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node}"
    padding: "17px 18px"
  team-node-selected:
    backgroundColor: "{colors.team-selected}"
    textColor: "{colors.ink}"
  segmented-tray:
    backgroundColor: "{colors.segment-tray}"
    typography: "{typography.segmented-label}"
    rounded: "{rounded.segmented-tray}"
  workspace-picker:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    width: "min(480px, calc(100vw - 32px))"
---

# Roppo design reference

## Overview

**Creative North Star: "The operator workspace"**

Roppo uses a pure white default theme and an explicit dark theme. Actions, navigation and agent selection use neutral tones. Green, amber, red and blue are reserved for status or recognizable service badges. The existing layout, local typography and controls remain in place.

Hierarchy comes from spacing, type weight, borders and selected states. Configuration nodes expose editable members, while actual execution remains a separate view. The top bar and left navigation retain their established structure. No new font downloads or raster assets were introduced for this extension.

This reference records design conventions and dated interface changes. Earlier layout measurements describe their original surface; later dated sections document subsequent changes. Consult the current implementation before reusing an older layout.

**Key Characteristics:**

- Persistent workspace identity and navigation.
- Neutral selection and action states on white or dark surfaces.
- Local font stacks, compact form labels and bordered controls.
- Static configuration relationships; runtime-driven motion belongs to actual Calls.

**Recorded scope and evidence:** The current palette is centralized in `src/ui/theme.css`; the existing shell, forms, Calls graph and team studio consume its semantic variables. Historical browser checks covered rendered light/dark desktop and 390px layouts, configuration draft preservation and browser-storage behavior. Screenshots use isolated synthetic fixtures, not live provider execution or user visual sign-off.

## Colors

`src/ui/theme.css` owns both palettes. The frontmatter records light-theme values; legacy names such as `green` are compatibility aliases for the neutral action color, not instructions to restore green branding.

| Role | White theme | Dark theme |
| --- | --- | --- |
| Canvas | #ffffff | #111111 |
| Surface | #ffffff | #191919 |
| Soft surface | #fafafa | #161616 |
| Selected surface | #f0f0f0 | #292929 |
| Primary text/action | #171717 | #f5f5f5 |
| Secondary text | #444444 | #d4d4d4 |
| Muted text | #666666 | #ababab |
| Hairline | #e5e5e5 | #333333 |
| Input boundary | #aaaaaa | #666666 |
| Success | #21683e | #8ed6a7 |
| Warning | #805400 | #efc675 |
| Error | #a82b32 | #ffa0a7 |

Each status has its own theme-aware background. Selection, caret, scrollbars, focus, form controls and native dialogs use the same palette. Service icons are not inverted or filtered.

The sun/moon button in each page header switches between white and dark. The choice is saved locally and applied before the first paint, defaults to white even on a dark OS, and synchronizes between tabs. Switching changes only root theme attributes: it does not rebuild forms, lose drafts or write host configuration. If browser storage is unavailable, switching still works for the current page.

## Typography

**Body and heading stack:** the frontmatter's local Avenir Next / PingFang SC / system stack. **Segmented controls:** the existing Inter / system fallback stack. **Structured JSON:** `ui-monospace, SFMono-Regular, Consolas, monospace`. These are CSS family requests, not claims that a downloaded font is installed or loaded.

`src/ui/typography.css` defines fixed UI roles shared by the Chat shell, configuration, public guide and account screens. Repeated roles use the same size instead of local display scales. Font families, colors and content structure retain the existing product identity.

| UI role | Desktop | Window up to 800px |
| --- | --- | --- |
| Page heading | 28px | 24px |
| Dialog / inspector title | 18px | 18px |
| Section heading | 16px | 16px |
| Dense body and field label | 14px | 14px |
| Button and page tab | 14px | 14px |
| Form input | 14px | 16px |
| Reading text | 16px | 16px |
| Secondary metadata | 12px | 12px |

Chat Markdown, formulas, code, diagram annotations, status badges and brand lettering retain their content-specific hierarchy. Input sizes follow the shared breakpoint independently of each page's layout breakpoint. Buttons retain their touch height when their labels become smaller.

The packaged Agent board declares the same role values in its sandboxed document. The host sends the window's compact typography state with its existing environment message, so expanding navigation does not shrink the board heading earlier than the other pages. Older hosts retain the board's local responsive fallback.

## Layout

The desktop shell is a two-column grid: a sticky, full-height left rail (224px) and a flexible content area. The top bar is a bordered row (64px). Main content is centered with a maximum width (1300px) and desktop padding (36px 40px 44px). At widths up to 1200px the rail narrows (204px) and main padding becomes 30px. At widths of at least 1600px the main top padding becomes 45px.

At widths up to 700px the shell becomes one column; navigation becomes a dismissible, fixed drawer (224px) with a scrim. The top bar becomes shorter (58px) and uses 16px inline padding. Main content uses 26px 20px 35px padding, reducing its inline padding to 16px at widths up to 360px. Heading actions wrap. These are existing shell rules, not a new navigation model.

The team surface uses a graph beside an inspector, with a gap (32px) and columns `minmax(290px, 1fr) minmax(330px, 420px)`. At widths up to 1180px the gap becomes 20px, the map's minimum becomes 250px and the inspector ranges from 290px to 360px. At widths up to 960px the inspector stacks below the graph and Workers use two columns without branch lines. At widths up to 560px Workers use one column, panel padding becomes 16px, and the three connection-type choices stack vertically. Selecting a member focuses the inspector heading; at widths up to 960px it also scrolls the inspector into view.

Workspace overview uses a flexible member list beside a 300px start panel with a 32px gap, stacking at 960px. The connection editor is limited to 680px. The spacing names in frontmatter are extracted recurring dimensions, not an assertion that every existing value follows a single spacing scale.

## Elevation & Depth

The workspace is primarily flat: borders and pale surface changes distinguish controls and groups. The team map, member cards and inspector have no resting shadow. Existing depth is concentrated in selected segmented pills, primary-button edge highlights, drawers and dialogs.

- **Primary action:** `0 1px 2px #0000000d, inset 0 1px #ffffff20`.
- **Selected segmented pill:** `0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.06)`.
- **Workspace picker:** `0 14px 60px #00000029`, with a translucent backdrop (`#00000045`).
- **Open mobile navigation:** `15px 0 60px #00000029`.

These observed shadow values are not generalized elevation levels for every container.

## Shapes

Controls are restrained rounded rectangles. Buttons and navigation use tighter corners than member cards; the graph and inspector use the broadest panel corners. Inputs preserve their slightly different field radius. Status labels are compact rounded rectangles rather than large capsules. Member icons sit in small square tiles (36px square); icon strokes are thin, round-capped and round-joined. Profile avatars may be circular in the existing shell.

The configuration graph's lines are simple one-pixel vertical and horizontal segments. Their structure conveys configuration ownership. They are removed where narrow layouts would make the branch arrangement misleading.

## Components

Preserve the semantic separation between configured agents, the explicitly labeled user-controlled workflow explanation, and recorded runtime Calls. Short panel transitions use native WAAPI with cancellation handling; reduced-motion retains immediate state changes and readable status. Never make an idle configuration graph look like executing work.

### Buttons

Primary actions use white text on near-black in light mode, and near-black text on off-white in dark mode. Secondary buttons use the current surface and a neutral border; hover uses the neutral hover surface. Both use compact padding, medium text (14px, weight 500, line height 1.4), a minimum height (34px), and increase that minimum to 40px in the mobile shell. Text actions use the neutral action color, weight 550, and underline on hover. Disabled operator buttons reduce opacity to 0.5 and use a default cursor.

The shared operator focus treatment is an outline (3px, offset 3px). Primary, secondary and text buttons use background/border/shadow transitions (160ms ease). API connection actions use this operator button family. Existing legacy forms and affectUI buttons remain separate families outside that adapter.

### Fields

Team fields use white fill, a defined border, full available width and 10px 11px padding. Labels sit above fields with a 7px gap; the field stack uses a 20px gap. Selects are 42px high. Textareas resize vertically, have a minimum height (130px) and line height (1.7). Invalid numeric inputs receive an error border and associated message; helper copy and `aria-describedby` retain meaning beyond visual styling. Disabled prompt areas use a soft background and muted text. Team and advanced settings fields use the shared 14px input role, increasing to 16px when the host window is at most 800px wide.

### Navigation and segmented tabs

Rail items use a compact row (38px), icon, label and rounded active fill. The selected route uses primary text, stronger weight and a neutral selected fill. The current workspace remains above the route list.

The existing large segmented control has a neutral tray, theme surface for the selected pill, label size (14px), option height (36px), tray padding (4px) and radius (13px). Coarse-pointer rules increase the option height to 44px. The active label changes from weight 500 to 600. It uses tab semantics and arrow/Home/End keyboard navigation; the selected option owns the tab stop. The segmented-control rule uses the shared focus token (2px, offset 0); operator controls use a 3px outline. The existing pill slides using asymmetric leading/trailing edge durations (270–400ms); label transitions use 200ms.

### Status labels and containers

Green, amber, blue and neutral status variants exist in the shell. Theme tokens distinguish semantic status colors from neutral action and selection colors. Badges use compact text (11px), weight 500 and 3px 6px padding.

The team inspector is a white bordered panel; the graph uses a soft filled panel. On desktop, the inspector padding is 24px and graph padding is 28px; both reduce to 20px at 1180px and 16px at 560px. Workspace member summaries use separated rows, not repeated elevated cards.

### Agent configuration node and inspector

Each member is a real button with an icon tile, human-readable name, role and model. The selected node has a high-contrast neutral border and neutral selected fill; it uses `aria-pressed` and identifies the controlled inspector. Hover changes its border and background over 160ms ease-out. Member and model text wrap instead of truncating essential identity.

The inspector exposes Basics, Tools & control and Advanced tabs. Switching members retains the revisioned draft; it does not mean the draft was saved. Worker duplicate/remove controls are adjacent to the selected member. Configuration connectors remain static. The explanatory step selector uses a separate 180ms ease-out state transition, without inventing running work.

### Workspace picker and connection choices

The workspace switch opens a native dialog, capped at 480px with 16px viewport clearance per side. Current choices use a neutral selected fill; hovering uses the soft surface. The picker groups personal and organizational choices and retains an explicit current identity. Dirty drafts block workspace changes with an explanation. This is interface behavior; server-enforced isolation is a separate capability.

Connection creation presents API, subscription and CLI as three bordered choices with selected-state borders and fills. Available controls and errors reflect backend-reported capabilities. Subscription background use is an explicit checkbox; the consent state resets when account/owner identity or connection context changes. Pending authorization remains distinct from connected state. These states are documented from the implementation and contract checks, not from a claim that a live provider login was performed.

### Motion and reduced motion

Motion communicates selection, navigation or real execution. The operator reduced-motion rule disables animation and transitions and restores automatic scrolling across its descendants. Team member selection uses instant scrolling when reduced motion is requested. The separate runtime Calls view keeps its event-driven flow adapter; configuration does not start it.

## Do's and Don'ts

### Do:

- Do preserve the existing top bar and left rail when extending an operator surface.
- Do use the neutral action and selection tokens, and pair semantic state colors with readable text.
- Do retain visible keyboard focus, labels, validation messages and the current reduced-motion behavior.
- Do keep configuration drafts, saved configuration and actual execution visibly distinct.
- Do keep new content within the existing responsive shell and let long member or model names wrap.

### Don't:

- Don't add decorative metrics or repeated explanatory subtitles beneath page headings.
- Don't present a configured connection or selected node as proof that a provider call succeeded.
- Don't infer workspace isolation or successful authentication from a label, badge or synthetic screenshot.
- Don't add external font or raster dependencies for this extension.
- Don't reintroduce literal light-only colors, green branding or CSS inversion filters. Keep typography and control behavior outside this palette change intact.


## Shared conversation workspace — 2026-11-07

Authenticated `/chat`, `/configure` and `/` now use the same application shell: one global feature rail, a persistent Chat space, workspace picker, header, theme and language controls. Configuration is a content outlet; the existing form controllers and revisioned drafts are retained through a build-time module adapter with scoped CSS. Account onboarding and the public usage guide remain separate entry flows.

The conversation owns a collapsible panel with Files, Browser and Team activity tabs. Browser instances are scoped to the conversation, while authorized login profiles remain reusable. Files previews are read-only and restricted to that conversation's task directories. Team flow continues to reflect recorded execution. The black/white palette and existing controls remain; motion on the shared panel is a brief reveal, with immediate reduced-motion behavior.

Historical acceptance covered the shared workspace using isolated fixtures, not live provider execution.


## Single Chat space and feature rail — 2026-11-14

One persistent Chat space replaces the conversation list. The existing feature rail remains 64px collapsed and 208px expanded. Group mode gives the remaining width to the shared transcript. Agent-list mode adds a 240px contact list containing the Router and Workers; selecting a Worker shows its actual Router/Worker exchange in the same content region, with a disabled input reading “请与 Router 对话” and a link back to Router. Older Router identities remain read-only. No new-chat, rename, search or archive controls appear.

Display mode and clearing live in the existing Settings → Chat tab. Two plain radio rows select the mode; a separate clear action names its scope and requires inline confirmation. It clears only the current account’s built-in Chat and associated memory/context. Independent external entry data belongs to its plugin. The memory tab retains only Edit and Delete per saved item.

At 800px and below the feature rail and contact list form a drawer. Expanding feature labels temporarily hides contacts; closing restores focus after the main region leaves inert. Resource tools retain their existing panel and become an overlay when the remaining content width would drop below 360px. The same Router draft survives contact, view, language, theme and settings navigation. Reduced motion removes navigation transitions.

Rendered evidence in `images/chat-space-*` uses an isolated HTTP/SQLite host and deterministic model replies; it verifies UI and execution projection, not a live model’s coding quality.

## Resource launcher and open views — 2026-11-07

The upper current-workspace control is the sole workspace entry in global navigation. It retains the workspace picker and overview; the redundant route link has been removed.

The conversation's right-hand workspace now uses closable open-view tabs and a new-tab launcher. Tools are opened from compact two-column actions for Browser, Files and Team activity. The top input filters real tools or opens an HTTP(S) address through the personal browser flow. A Recent section appears only after actual tool use; it does not invent sites, recommendations or unsupported tools. Reopening a tool restores its existing view rather than duplicating controllers.

Closing the last view restores the launcher. Hiding the whole panel is separate, and reopening restores the selected view. View state and recent tools persist per conversation; a closed browser view stops its stream but leaves the underlying browser session intact. A website launch does not automatically navigate a Worker session. Internal website tabs remain in the browser's own toolbar, alongside its profile, login and takeover controls.

The reference's tab contour and address field use 9px upper corners and a 20px field radius; close affordances use 5px. These compact control shapes intentionally supplement existing surface radii. All surfaces keep the existing black/white tokens and reduced-motion behavior.

Historical resource-tab acceptance covered view reuse, closing, persistence and browser-session boundaries.


## Model connections and decision settings — 2026-11-08

The model page uses a single 1120px content measure. Saved connections appear as separated service rows: identity, protocol, model, assigned roles and actions. Decision setup is one bordered region, with configuration on the left and a draft probe on the right; below 800px the probe follows the configuration vertically. The section heading uses 24px and service names 16px. Existing white/dark tokens and the global shell remain unchanged.

Connection selection comes before behavior. Native radio inputs provide three keyboard-accessible choices, and advanced limits, instructions and JSON stay collapsed until requested. A saved-mode label refers to the persisted configuration, while the existing save bar owns draft changes. Probe samples are editable examples, not accuracy claims. Results display only returned labels, latency and token usage; missing usage displays an em dash. Editing the request invalidates prior results. Pending motion occurs only during an actual request and stops under reduced motion.

Visual evidence and browser checks use the isolated decision acceptance host with a synthetic provider. They exercise the real settings and probe HTTP routes, not a paid provider or production message flow.


## Memory in Settings (2026-11-13)

Memory is a section of the existing Settings navigation, not a conversation resource or an entry under Shared instructions. It shares the settings shell, neutral palette, typography, language and responsive layout. Saved memories appear as plain separated rows. Each row offers only Edit and Delete; editing uses one text field. Cancel and save controls belong to the active operation. Conditions and temporary scope remain readable metadata, with source and scope retained during editing.

Do not reintroduce learning switches, entry selectors, candidate approval, source/history drawers, usage ledgers or technical configuration into this surface. Pending suggestions stay separate from saved memories; removing their UI does not approve them. Existing policy, background learning and authorization remain unchanged. Retired URLs lead to Settings, and retired memory tabs are removed without discarding other conversation tools or drafts.

Desktop light/dark and 390px screenshots in images/memory-settings-* use isolated HTTP/SQLite fixtures. They verify the interface, not live-provider behavior or user visual approval.


## Event automations in the shared workspace — 2026-11-15

Event automations use `/configure#automations` inside the existing feature rail and header. They inherit the Chat tokens, theme and language. The 28px heading (24px on mobile) and 15px row names follow the existing plugin workspace. The separate green workbench, marketing heading, metric cards and persistent explanatory copy are removed.

Saved automations appear as separated rows with name, event type, receiving state and latest event time. The empty state has one action. Task, event history and connection details are separate views; JSON, key rotation, reconciliation and revocation stay behind disclosures. Creation has two steps: Task and Event connection. One Worker owns the default task, with optional custom rules preserving existing multi-node contracts. Required authorization and credential configuration are retained. Unavailable receivers and missing authorized conversations expose their actual prerequisite instead of letting users complete an unusable form.

No explanatory subtitles or permanent instruction small print. Necessary field labels, state, validation errors and requested setup instructions remain. Saved-skill bindings preserve the pinned contract. Grant creation retries reuse the same operation and expiry for an unchanged draft. The old URL redirects without losing its skill parameters.


## Chat presentation and agent names — 2026-11-15

Chat retains the neutral shell and R-shaped avatars. User bubbles have 8px vertical padding and zero paragraph margin; content determines their height. Timestamps are real message/tool start times, displayed at 11px with a full date and time on hover. The current Router run status and copy action share the message footer. A run without an assistant reply keeps its standalone status; stopped, waiting and failed runs never display as completed.

Replies and user messages render Markdown tables, lists, code and KaTeX formulas. Inline and block math accept dollar delimiters and ChatGPT-style backslash delimiters; code stays literal. Wide formulas and tables scroll within the message. Code headers contain a language label and copy action. Reply and code copy actions show a check and “Copied” only after the clipboard write succeeds; failure displays “Copy failed”. The transient label occupies the existing action row, without a toast or permanent explanatory copy.

The composer has one paperclip action, file drop support and image paste. Draft files appear as compact removable chips with upload/error states and image previews; successful uploads survive reload. Uploading or failed files block sending until ready or removed. Sent attachments retain their filename, size and download link above the user bubble; a file-only message has no empty bubble. Attachment styling uses the existing neutral surfaces, 12px corners and shared theme tokens. The same controls work in light/dark themes and stack within a narrow viewport. Worker conversations remain read-only.

New messages and tool rows enter once with a 240ms, 6px vertical reveal. The arrival baseline belongs to the persistent Chat space, including first-send creation. History loads, reloads and Agent switches do not replay arrivals. Native disclosures animate their contents over 200ms where supported; reduced motion makes both arrivals and disclosures immediate. Tool actors, times and role labels reuse compact metadata typography, with 11px as the Chat metadata size.

Names are edited in Agent team → Essentials using the existing revisioned save flow. Router and Worker retain their roles and stable IDs; labels update in the transcript, Agents list, tool rows, composer, team view and runtime prompt. Historic message bodies remain evidence, while their speaker labels reflect current configuration. Language follows the explicit request or current human message; browser locale is a fallback for language-neutral input, separate from interface language.

## Model configuration and Chat selection — 2026-11-17

The connection library is a reusable inventory for component selection. Its 1120px content measure uses separated rows with identity, last test, usage count and actions. Search and method filters precede the rows. A native side dialog exposes the test, usages, editing and deletion. Router and Worker configuration use the same inventory in a searchable picker. The decision layer belongs to the Router configuration tab.

Creation has a 680px content measure: select API, subscription account or CLI, then the provider/tool. API requires the connection address where applicable, credentials and model; name, protocol and endpoint override are advanced. Subscription account aliases are generated internally. Only one unambiguous local identity can be inferred; other cases expose one combined identity choice, and background authorization remains explicit. CLI detects installation and sign-in, with executable path and one-argument-per-line overrides behind a disclosure. Drafts survive switching methods. Creating a connection does not reassign components.

Brand marks come from official product assets bundled locally. Each row reserves the same 40px centered frame; provider buttons and picker triggers use 20px and 24px frames. Codex and OpenAI desktop assets contain internal padding, so per-brand optical scales normalize the visible artwork without recoloring or distortion. Light/dark Codex assets retain their supplied appearance. The shared typography roles govern labels, actions and inputs; narrow windows use 16px inputs. Failed tests offer recovery, field changes invalidate prior results, and details remain behind disclosures.

The Chat composer opens a native popover for the Router connection and reasoning effort. Applying a selection uses the revisioned settings API, refreshes the displayed model, and keeps the message draft. The popover is rendered outside the composer form, supports keyboard opening and Escape, and exposes a link to manage connections. Anthropic's provider-specific thinking controls stay in team configuration. The Worker button opens actual team activity and its settings link.

Motion is limited to short form/result transitions, popover opening and a pending-request indicator. Reduced motion removes these animations. Model switches start compatible backend context for subsequent turns, retaining the Chat transcript and durable memory; no clear-context action is involved.

## Chat status companion and reading column — 2026-11-17

Chat retains its existing font sizes and gains a small Roppo in the header. Its model-written short status comes from the current execution call; host lifecycle, reconnect and selected participant determine the visible state. The fixed high-resolution body uses separate eyes, hands and props for continuous motion. Background tabs pause it and reduced-motion users receive static poses.

Messages and the composer share an 800px reading column. Desktop avatars sit outside the text measure; narrow conversation lanes move them into the speaker row. Resource panels, feature navigation and scrollbar gutters preserve alignment. The composer retains its existing attachment, draft, IME and send/cancel behavior with tighter spacing and short focus/height/icon transitions. Tool groups initially collapse. See `ui/CHAT_COMPANION.md` for implementation and acceptance details.
