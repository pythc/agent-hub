---
name: AgentHub
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
    fontSize: "clamp(24px, 2.6vw, 34px)"
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
    fontSize: "13px"
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

# Design System: AgentHub

## Overview

**Creative North Star: "The operator workspace"**

AgentHub uses a pure white default theme and an explicit dark theme, as requested on 2026-11-06. Actions, navigation and agent selection use neutral tones. Green, amber, red and blue are reserved for status or recognizable service badges. The existing layout, local typography and controls remain in place.

Hierarchy comes from spacing, type weight, borders and selected states. Configuration nodes expose editable members, while actual execution remains a separate view. The top bar and left navigation retain their established structure. No new font downloads or raster assets were introduced for this extension.

The North Star is a descriptive label for the implemented workspace, not a new creative direction. Surface composition remains in .impeccable/surfaces/src-ui-team-studio-js.md (local historical notes).

**Key Characteristics:**

- Persistent workspace identity and navigation.
- Neutral selection and action states on white or dark surfaces.
- Local font stacks, compact form labels and bordered controls.
- Static configuration relationships; runtime-driven motion belongs to actual Calls.

**Recorded scope and evidence:** The current palette is centralized in `src/ui/theme.css`; the existing shell, forms, Calls graph and team studio consume its semantic variables. `.local/theme-browser-evidence` records rendered light/dark desktop and 390px checks, configuration draft preservation and browser-storage behavior. Screenshots use isolated synthetic fixtures, not live provider execution or user visual sign-off.

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

The active page-heading size is fluid; ordinary section titles are compact and the selected member's inspector title is slightly larger. Body paragraphs use a looser line height (1.7) than the inherited body value. Member names use a compact title (15px), field labels use the label role, and helper copy uses the help role. There is no separate marketing display scale or regular geometric type ratio.

**Pre-existing variation:** `workspace-settings.css` overrides the earlier system-stack declaration and smaller page-heading rule in `operator-workspace.css`. `affect-ui.css` retains its own segmented-control font family; `execution-page.css` retains larger local control sizes. These files were unchanged by the team-studio extension. This document records the resulting cascade rather than treating the earlier declarations as the rendered truth or silently standardizing them.

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

These observed shadow values are also carried in the sidecar; they are not generalized elevation levels for every container.

## Shapes

Controls are restrained rounded rectangles. Buttons and navigation use tighter corners than member cards; the graph and inspector use the broadest panel corners. Inputs preserve their slightly different field radius. Status labels are compact rounded rectangles rather than large capsules. Member icons sit in small square tiles (36px square); icon strokes are thin, round-capped and round-joined. Profile avatars may be circular in the existing shell.

The new graph's lines are simple one-pixel vertical and horizontal segments. Their structure conveys configuration ownership. They are removed where narrow layouts would make the branch arrangement misleading.

## Components

The current motion behavior is recorded in MOTION_2026-11-06.md (local historical notes). Preserve the semantic separation between configured agents, the explicitly labeled user-controlled workflow explanation, and recorded runtime Calls. Short panel transitions use native WAAPI with cancellation handling; reduced-motion retains immediate state changes and readable status. Never make an idle configuration graph look like executing work.

### Buttons

Primary actions use white text on near-black in light mode, and near-black text on off-white in dark mode. Secondary buttons use the current surface and a neutral border; hover uses the neutral hover surface. Both use compact padding, medium text (12px, weight 500, line height 1.4), a minimum height (34px), and increase that minimum to 40px in the mobile shell. Text actions use the neutral action color, weight 550, and underline on hover. Disabled operator buttons reduce opacity to 0.5 and use a default cursor.

The shared operator focus treatment is an outline (3px, offset 3px). Primary, secondary and text buttons use background/border/shadow transitions (160ms ease). API connection actions use this operator button family; current theme contrast results are in `.local/theme-browser-evidence/report.json`. Existing legacy forms and affectUI buttons remain separate families outside that adapter.

### Fields

Team fields use white fill, a defined border, full available width and 10px 11px padding. Labels sit above fields with a 7px gap; the field stack uses a 20px gap. Selects are 42px high. Textareas resize vertically, have a minimum height (130px) and line height (1.7). Invalid numeric inputs receive an error border and associated message; helper copy and `aria-describedby` retain meaning beyond visual styling. Disabled prompt areas use a soft background and muted text. Team fields remain 13px in the current mobile CSS; the separate advanced settings forms have their own 16px mobile override. No system-wide mobile input-size normalization is claimed here.

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

Authenticated `/chat`, `/configure` and `/` now use the same application shell: one global feature rail, an independent conversation list, workspace picker, header, theme and language controls. Configuration is a content outlet; the existing form controllers and revisioned drafts are retained through a build-time module adapter with scoped CSS. Account onboarding and the public usage guide remain separate entry flows.

The conversation owns a collapsible panel with Files, Browser and Team activity tabs. Browser instances are scoped to the conversation, while authorized login profiles remain reusable. Files previews are read-only and restricted to that conversation's task directories. Team flow continues to reflect recorded execution. The black/white palette and existing controls remain; motion on the shared panel is a brief reveal, with immediate reduced-motion behavior.

Rendered evidence: shared-workspace acceptance (local historical notes).


## Conversation space and feature rail — 2026-11-07

The Codex reference establishes three separate regions: global feature navigation, conversation list, and conversation content. Feature navigation defaults to a 64px icon rail and expands to 208px; its labels are restored on expansion. The conversation list is 220–252px and can be hidden independently. Both preferences persist locally. Management pages reuse the same global rail and omit the conversation list; returning to chat restores the list preference and drafts.

The new-conversation action, search and archive controls belong to the conversation list. The feature rail uses 40px rows, neutral active fills and accessible names/native titles for all collapsed icons. Its logo uses 22px type; secondary history captions retain 11px from the existing compact UI. The mobile navigation scrim retains the existing `#0005` treatment.

At 800px and below the two navigation regions form a drawer. Expanding feature labels temporarily hides its history column; closing restores focus to the menu button after the main region leaves inert. The session panel defaults closed for a new conversation and remembers existing choices. It uses an overlay on mobile or when splitting would leave less than 360px for conversation content. Reduced motion removes navigation transitions. No model execution is simulated by layout motion.

Rendered evidence: conversation-space acceptance (local historical notes).

## Resource launcher and open views — 2026-11-07

The upper current-workspace control is the sole workspace entry in global navigation. It retains the workspace picker and overview; the redundant route link has been removed.

The conversation's right-hand workspace now uses closable open-view tabs and a new-tab launcher. Tools are opened from compact two-column actions for Browser, Files and Team activity. The top input filters real tools or opens an HTTP(S) address through the personal browser flow. A Recent section appears only after actual tool use; it does not invent sites, recommendations or unsupported tools. Reopening a tool restores its existing view rather than duplicating controllers.

Closing the last view restores the launcher. Hiding the whole panel is separate, and reopening restores the selected view. View state and recent tools persist per conversation; a closed browser view stops its stream but leaves the underlying browser session intact. A website launch does not automatically navigate a Worker session. Internal website tabs remain in the browser's own toolbar, alongside its profile, login and takeover controls.

The reference's tab contour and address field use 9px upper corners and a 20px field radius; close affordances use 5px. These compact control shapes intentionally supplement existing surface radii. All surfaces keep the existing black/white tokens and reduced-motion behavior.

Evidence: resource-tabs acceptance (local historical notes).
