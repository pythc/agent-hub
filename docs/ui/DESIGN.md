---
name: AgentHub Configuration
description: Bilingual operator interface for inspecting a host and editing revisioned runtime settings.
colors:
  ink: "#182822"
  body: "#364b42"
  muted: "#586b61"
  line: "#d9e1db"
  control-line: "#78887b"
  rail: "#f2f5f1"
  wash: "#f6f8f5"
  surface: "#fff"
  accent: "#226349"
  tint: "#dfece3"
  danger: "#973b2d"
  preview-bg: "#f5ebd9"
  preview-text: "#70501d"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  page-title:
    fontSize: "2.4rem"
    fontWeight: 650
    lineHeight: 1.13
    letterSpacing: "-0.038em"
  section-title:
    fontSize: "1.22rem"
    lineHeight: 1.35
    letterSpacing: "-0.023em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.86rem"
    lineHeight: 1.55
rounded:
  badge: "5px"
  field: "6px"
  button: "7px"
  notice: "8px"
  panel: "12px"
spacing:
  panel-gap: "24px"
  field-gap: "18px"
  editor-gap: "26px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
    padding: "8px 13px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "8px 13px"
  text-action:
    textColor: "{colors.accent}"
    rounded: "{rounded.button}"
    padding: "5px 6px"
  text-field:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.field}"
    padding: "8px 10px"
  nav-current:
    backgroundColor: "{colors.tint}"
    rounded: "{rounded.button}"
    padding: "9px 12px"
  badge-preview:
    backgroundColor: "{colors.preview-bg}"
    textColor: "{colors.preview-text}"
    rounded: "{rounded.badge}"
    padding: "4px 8px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "23px 24px"
---

## Overview

AgentHub opens with a four-step task guide at /configure. First-time users choose an AI service, a place to give requests and a dedicated work folder, then check their choices and try a first request. Advanced settings remain one action away, including a direct /configure#advanced bookmark. Both views retain their own draft while the tab stays open.

The previous entrance asked for a host token before explaining the task, gave eight internal sections equal weight and showed runtime health without saying whether a first request could run. It also offered backend selection before a new user had a connection to select. The guide defers authorization until needed, separates preparing choices from applying them, and gives provider setup a direct path.

## Colors

Use ink for headings, body for supporting labels and muted for explanations. The pale line separates panels and rows. The darker control line marks input boundaries, secondary buttons and unchecked switches. Green marks primary actions, active navigation and keyboard focus. Pair every health indicator with text. The amber preview badge appears only when the host reports a preview workspace.

## Typography

The system stack supports English and Simplified Chinese. The page title sits above a single explanatory paragraph. Use monospace for host identifiers, JSON and prompt output. Runtime values in key–value rows use tabular numerals. Long values and error paths wrap within the available width.

## Layout

- The guide uses a single reading column up to 800px wide. Four ordered steps show the route to a first task. The current step asks one question and uses native radio groups, labeled inputs and a primary continuation action. On a narrow display the step names sit below their markers.
- Advanced settings use the existing sidebar layout described below.

- On desktop, a sticky 232px rail contains grouped navigation and host status. A 64px top bar carries the language selector and console link. Main content is capped at 1140px. The overview pairs a larger task panel with a narrower runtime summary.
- At 1050px and below, the rail narrows to 204px and panel padding drops to 20px.
- At 780px and below, a labeled native section selector replaces the rail, the overview stacks and the page title drops to 2rem.
- At 540px and below, field labels sit above inputs, switch labels stay alongside their controls, panel padding drops to 17px and text inputs use 16px type. The sticky draft bar wraps its controls and respects the bottom safe area.

## Elevation & Depth

Use surface tone and a 1px border for separation. The access panel has a pale green fill. Technical details expand in place onto a muted wash. The draft bar stays above scrolling content with a top border.

## Shapes

Buttons and navigation have 7px corners, inputs 6px and panels 12px. The native checkbox is styled as a 38 × 22px switch with a sliding thumb. Outline icons inherit the text color and are hidden from assistive technology.

## Components

- **First use.** Collect choices before asking for operator access. Pair by selecting the private connection file for this origin. Opening the token fallback is optional. Pairing does not check a provider, and checking does not apply the setup.
- **First task and later requests.** On success the stepper gives way to a task inbox. Keep a labeled natural-language composer, examples that fill the draft and a separate optional no-file test. A sent request and its eventual reply stay together. Each new request gets an independent discussion. A transport retry reuses the original event. Restore recent requests from the saved source when the user reconnects.
- **Preview.** The guide explains on entry that live AI checks and delivery are disabled. Its final inbox has a disabled composer. A saved preview receipt never appears as a verified live assistant.

- **Navigation and language.** A skip link targets main content. The active rail control exposes `aria-current="page"`. Section changes move focus to the page heading. English is the initial language. Selecting 简体中文 updates the document language, page title, labels and formatted dates, and retains the draft. The language preference can persist across tabs and reloads.
- **Fields and feedback.** Associate each control with a visible label. Hints use `aria-describedby`. Invalid inputs expose `aria-invalid` and link to the error message. Keep invalid input available for correction. Keyboard focus uses a 2px accent outline with a 3px offset. Error notices use an alert role. Ordinary updates use status announcements.
- **Draft actions.** A sticky bar appears when an authenticated draft has edits or validation errors. Discard asks for confirmation. Save sends changed groups against the draft’s base revision, and the receipt supplies the saved revision. Loading history replaces the editable draft after confirmation.
- **Conflict review.** Focus and scroll to “Review newer revision” when a newer revision interrupts a save. The sticky “Review conflict” action returns there. Show both revisions, and disclose the local and host values under each overlapping path. The operator picks one side for all overlaps or rebases independent edits. The result remains a draft until explicitly saved.
- **Motion.** Use the shared 155ms easing for control state changes and the draft bar’s 6px entrance. Under reduced motion, disable transitions and animations and use automatic scrolling.

## Do's and Don'ts

- Show whether a value comes from the saved host revision or the editable draft.
- Keep the operator’s edits available across section and language changes.
- Never use a health dot or color change as the only status message.
- Never present history restoration or conflict resolution as a completed save.
