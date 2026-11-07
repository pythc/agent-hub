> Historical entry-layout baseline. Current theme tokens and appearance are defined in [the root DESIGN.md](../../DESIGN.md) and `src/ui/theme.css`; the green palette below is superseded.

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
    fontSize: "22px"
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

AgentHub opens with a choice between using an existing assistant and deploying or managing one. A usage invitation presents the enabled software and instructions. Management pairs with the host through a one-time link or a private connection file, then opens Tasks. Separate pages handle software instances, model services, Router/Worker execution and role prompts.

Setup starts with an actual work entry. Team conversations, coding clients and repository integrations share the host's existing AI connection. Preflight, applying settings and verifying a reply in the original software are separate stages. Browser chat remains an optional diagnostic. Existing full settings remain accessible.

The earlier four-step AI-to-browser flow made the browser conversation the destination and hid the product's actual entry points. This revision brings those entry points and the operator/user distinction to the main navigation. Exact endpoint semantics and constraints are recorded in ENTRY_SETUP_DESIGN.md.

## Colors

Use ink for headings, body for supporting labels and muted for explanations. The pale line separates panels and rows. The darker control line marks input boundaries, secondary buttons and unchecked switches. Green marks primary actions, active navigation and keyboard focus. Pair every health indicator with text. The amber preview badge appears only when the host reports a preview workspace.

## Typography

The system stack supports English and Simplified Chinese. Page titles stand alone. Do not place a repeated subtitle or generic introductory paragraph beneath them. Use monospace for host identifiers, JSON and prompt output. Runtime values in key–value rows use tabular numerals. Long values and error paths wrap within the available width.

## Layout

- Entry management uses a single reading column up to 1056px wide. A two-action role screen leads to shared usage instructions or an operator overview. Connection choices are grouped text rows. Detail screens show host context, preflight, missing settings and verification. Narrow displays stack status badges and form actions.
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

- **First use.** Show the two roles before management controls. A one-time link establishes the operator session. File and token pairing remain under a disclosure fallback. A usage invitation exposes instructions only.
- **Daily overview.** Show real attention items, then available connections. A failed read cannot produce an empty-success state. Add connection is the main action on an empty deployment.
- **Entry setup.** Reuse detected host settings. Select Feishu groups from probe results. WeCom permission and credentials are explicit prerequisites. Client installation identifies the host computer and offers separate instructions for another device.
- **Verification.** Show received, authorized, executed and replied stages from host evidence. A pending stage remains pending. The operator sends the displayed phrase in the target software. Only verified host evidence changes the conclusion.
- **Preview.** Explain unavailable installation and external verification. A saved configuration or generated test phrase does not imply a verified entry.
- **Browser diagnostics.** The former browser composer remains available under diagnostics with its existing truthful request states and reply matching.

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

## Operator revision integration

The supplied operator revision now provides the management shell, attention/work composition, searchable catalogue and task drawer. It uses scoped tokens (`ink #202721`, `accent #286349`, 14px base, 224px desktop rail); advanced forms retain their original tokens. See [integration details](OPERATOR_INTEGRATION.md) and [acceptance](../UI_INTEGRATION_2026-11-05.md). No illustrative preview records are used as live data.
