# Tool Access Map motion

The user requested integration with the existing “复刻 X 链接中的 UI 动效” chat.
That chat supplied original native DOM/SVG motion and an integration handoff.
`src/ui/flow-motion.js` and `.css` adapt those files to AgentHub.

The original visual reference is [affectUI Tool Access Map](https://www.affectui.com/components/tool-access-map). No affectUI Pro source, registry package or paid assets are included. This is separate from the free MIT Button and Segmented Control integration in `../affectui`.

The adapter retains the 700 ms connection reveal, 1700 ms running flow,
350 ms content reveal and interruptible 320/180 ms dialog animation.
Flow follows host-recorded running operations. Media preferences, cancellation,
route cleanup and sticky-node scrolling are handled locally.
Source hashes and the small adapter changes are in `provenance.json`.
