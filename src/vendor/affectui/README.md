# affectUI integration

The Execution page uses native-DOM adaptations of the free MIT components:

- Button: https://www.affectui.com/components/button
- Segmented Control: https://www.affectui.com/components/segmented-control

The original component CSS is in `src/ui/affect-ui.css`; `src/ui/affect-ui.js`
provides the native button/loading and tab/keyboard adapters. Execution-only
styles supply AgentHub's green palette and typography. Original source URLs and
SHA-256 hashes are recorded in `provenance.json`; the license is retained here.
React 19 is not required by this adaptation. React lifecycle, width-morph and
pointer-drag mechanics are not part of this adapter; keyboard operation, focus,
loading announcements and the source reduced-motion rules are retained.

Agent Graph, Model Picker, Combobox and Integration Picker are Pro components
per their official pages. Their source is not included. The configurable routing
diagram is AgentHub code, backed by its real settings and entry inventory. Its
canvas renders functional relationship lines; all controls and reading order
remain native, accessible DOM elements.
