# Memory reader design QA

final result: passed

## Comparison target and evidence

- Source visual truth: `/Users/alex/.codex/generated_images/01a1c4d9-1506-7492-be27-55323ba1c6a6/exec-2f909881-18f4-4e44-abe8-c071bfddd59d.png` (the selected second mock).
- User amendments: file tabs replace saved/pending/method tabs; no approval queue or New button; a brief regular-sized file hint; personal memories by default with separate group scopes; preserve existing typography.
- Implementation: `/configure#advanced/memory`, isolated host built from this branch after integrating main `281c8cf`.
- Implementation screenshot: `.local/acceptance/memory-reader/memory-normalized.png`.
- Source and implementation: 1767 × 890 pixels. Implementation viewport 1767 × 890 CSS pixels, device scale factor 1. Source displayed at its native pixel dimensions. No rescaling, browser chrome, or raster substitution of the interface.
- State: Chinese, light theme, expanded navigation, MEMORY.md reader with a selected note, provenance and collapsed history. Synthetic text, note count and learning switch value differ from the illustrative mock; these are test data, not layout drift. The fixture does not install the optional Agent board navigation plugin.
- Full-view comparison: source and normalized rendered screenshot were opened together in the same comparison tool input. Text, controls and source block were readable at this size; no enlarged region capture was needed.
- Additional browser captures: `.local/acceptance/memory-reader/memory-light.png` and `memory-dark.png` (1920 × 967), `memory-mobile.png` (390 × 844), `memory-mobile-file.png` (320 × 740).

## Findings and accepted differences

No actionable P0/P1/P2 findings remain.

1. **Fonts and typography:** uses the existing system font stack and shared Roppo type roles. Page heading 28px; detail/section heading 18px/16px; controls and hint 14px; reading text 16px. Browser computed note text is 16px with 28.8px line height and rgb(23,23,23) foreground. Text wrapping and hierarchy remain readable; the generated mock's larger labels were deliberately not copied because the user requested the current product sizes.
2. **Spacing and layout:** the flat two-column list/detail layout, gray selected item, thin divider, right-aligned edit/delete controls and source/history hierarchy follow the selected mock. Existing settings container width and sidebar are retained. File hint adds one row as requested. At narrow widths the list and detail become separate views with a Back control; file tabs scroll horizontally without page overflow.
3. **Colors and tokens:** existing white/dark backgrounds, neutral text, muted secondary text, light borders, selected gray surface and monochrome switch are retained. Source quotation and history are visually subordinate to the note. Dark theme checked in browser.
4. **Image quality and assets:** uses the existing Roppo brand asset and installed Lucide interface icons. There are no replacement logo drawings, new generated illustrations or blurred raster UI elements. The source's outer rounded screenshot frame is not added to the application DOM.
5. **Copy and content:** file tabs are MEMORY.md, USER.md, SOUL.md, IDENTITY.md and AGENTS.md. Default scope is 我的记忆; group memories remain separate. No pending-approval tab or New button. The hint is one normal-sized sentence. Working methods and import/export remain available in More. Memory provenance is shown inline rather than navigating away from the reader.

## Comparison history

- **Earlier P2: inherited gray reading text and unwanted rule above More.** Initial evidence: `/tmp/roppo-memory-reader-acceptance-20261117/memory-light.png`. Fixed the memory-content foreground and scoped menu border/padding to avoid legacy settings styles. The normalized final screenshot verifies dark reading text and an unboxed toolbar.
- **Earlier P2: narrow-screen overflow and competing list/detail display rules.** Evidence: `/tmp/roppo-memory-reader-acceptance2-20261117/failure.png` and `/tmp/roppo-memory-reader-acceptance3-20261117/failure.png`. Fixed the React portal grid item's minimum width, bounded the file tab row, and matched selector specificity for responsive list/detail visibility. Final 390px and 320px captures show the corrected single-view layout; browser assertions check both document width and the memory region's bounds.
- **Post-integration comparison:** captured again at 1767 × 890 after incorporating concurrent Chat/Worker changes, then reran all eight memory browser scenarios. No further visual fixes required.

## Interaction verification

Browser evidence: `.local/acceptance/memory-reader/evidence.json`; eight groups passed, no page JavaScript errors.

- Personal aggregation, group separation and other-account isolation.
- Legacy candidates automatically settled; no approval queue.
- Note edit/save/cancel, source text and revision history.
- Delete followed by editing another note from the same source.
- Memory import/export and learning switch persistence.
- Persona file edit/save/reload/import/export and keyboard tabs.
- Working methods accessible from More.
- Desktop, dark theme, 390px and 320px layouts; isolated reset preserves persona and connection settings.

Drafts disable file/scope switching; cancelling restores focus. Reduced-motion preference is respected. Browser fixture uses synthetic data and no real model calls. Router style is verified through the actual execution prompt path in automated tests; real-provider conversational tone is not a visual acceptance claim.

## Implementation checklist

- [x] Apply the selected reader layout and requested file tabs.
- [x] Preserve existing product type sizes and theme tokens.
- [x] Resolve the earlier reading-color, menu-border and mobile overflow findings.
- [x] Capture and compare the integrated implementation with the source.
- [x] Verify editing, deletion, file operations, keyboard interaction and reset.
- [x] Keep user data out of the test fixtures and evidence.

No follow-up visual fixes are required for this scope.
