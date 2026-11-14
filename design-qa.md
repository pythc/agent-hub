# Execution design QA — 2026-11-05

This report records the November 5 build. The November 6 update removed the animation preview control, simulated flow and preview label from the product.

Source visual truth: `docs/ui/reference/execution-fanout.png`, the annotated `docs/ui/reference/execution-feedback.png`, and `docs/ui/reference/tool-access-map-study.jpg` from the explicitly requested motion chat. The latest feedback rejected the earlier static-looking layout. Calls now follows the center/perimeter study; Configuration retains the editable fan-out layout with independent rounded Worker rectangles. The existing top and left chrome are preserved.

Implementation screenshots: `docs/ui/acceptance/execution-2026-11-05/real-call-map.jpg` (actual compact Calls), `call-map-wide.jpg` (illustrative desktop Calls), `call-map-native-detail.jpg` (real Codex-backend call metadata), `desktop.jpg` / `real-host.jpg` (Configuration), and the earlier narrow/native configuration checks. `real-motion-preview.gif` records actual browser frames in the user's 729 px preview pane; `motion-preview.gif` records the illustrative wide map.

## Comparison evidence

- `call-map-comparison.png` was opened as one source + implementation image: semantic crops of the original center/perimeter study, the illustrative desktop Calls view and the actual compact host. The study is 1280 × 834; the wide capture is 1725 × 1103; the real preview is 729 × 886. Aspect ratios are preserved within comparison panels. Runtime content and AgentHub's existing green tokens deliberately replace the study's simulated tools and grayscale identity.
- The actual 729 px pane has 465 px of content and a 431 px map. Both SVG layers remain displayed; preview flow uses `tam-flow`, with observed offset changing from 0.0270588 to 0.474118 between observations. This directly verifies motion in the window where the user reported it absent. The earlier 650 px container cutoff incorrectly removed those wires; it is now 400 px, with a compact graph between 401–650 px.
- Calls actor tabs retain their DOM and slide their indicator instead of remounting it. Content reveal is 350 ms, connector draw 700 ms, running flow 1700 ms, detail enter/exit 320/180 ms. A separate blue preview layer is explicitly labeled and has no host effects; real counts remain unchanged.
- The original source is 1568 × 1003 pixels. The final desktop fixture is 1725 × 1103 CSS/pixel dimensions. Screenshot pixels match the measured CSS viewport; devicePixelRatio is not used for a physical-pixel comparison. The full comparison downsizes that capture to the source frame before cropping the main content, excluding the preserved chrome from fidelity judgments. This is a composition comparison under the added Tools requirement, not an identical-layout pixel measurement.
- `full-comparison.png` was opened as a single source + implementation input. `focus-comparison.png` was also opened; it uses separate semantic crops of Router and Workers, fitted with preserved aspect ratios into equal comparison frames.
- The actual host was inspected at 1568 × 1003 CSS pixels; `real-host.jpg` is a full-page capture, 1568 pixels wide. Its two saved Workers and six actual entry types intentionally differ from the three-Worker sample.
- Earlier IAB captures had DPR ≈1.1 and display-fit padding. Those intermediate analysis copies were normalized privately; the final published desktop comparison uses the later unpadded 1725 × 1103 capture.
- Narrow browser evidence is 390 × 844 CSS pixels; the tool returned CSS-size raster captures. Full-page images include content below that viewport. The tool grid becomes two columns, and the graph stacks vertically without page overflow.

## Findings and fixes

No actionable P0/P1/P2 visual or interaction finding remains for the requested scope.

| Earlier finding | Fix | Post-fix evidence |
| --- | --- | --- |
| P1: configuration tree did not follow the requested motion study | Default Calls view with center actor, perimeter nodes and animated actor tabs; editable Configuration remains separate | call-map-comparison.png, wide and real preview GIFs |
| P1: narrow preview concealed the SVG motion | Compact three-column map at 401–650 px containers; mobile fallback only at <=400 px | Actual 729 × 886 pane, 431 px map, visible animated SVG |
| P2: overlapping source wires and Router/Queue hump | Bounded rounded paths; shared Worker bus; SVG motion path resolver | Final full/focus comparisons and real-host screenshot |
| P2: Router/Workers tabs on different rows | Corrected the bold text overlay grid class | Browser equal tab Y/height, keyboard switching; centered instructions dialog |
| P2: inherited full-height dialog and literal null | Scoped centered dialog geometry; null-filtered children | Browser instructions and call details |
| P2: Workers share only one outer rectangle | Removed pool outline; every Worker is its own bordered 12 px rectangle | Ten-card DOM/style check and final screenshots |
| P2: long software label loses room | Removed an empty child span; compact icon/grid spacing | WorkBuddy stays on one line at compact desktop width |
| P2: tools disappear when inspecting Worker 10 | Sticky tool panel; scroll-driven edge layout | Tools top 88 px, bottom 752 px in a 1103 px viewport |
| P2: cancelled reveal creates an unhandled rejection | Armed Animation.finished rejection handling | DOM/API harness passes; cooperating chat's cancellation regression; browser console review |
| P2: tool focus is lost after detail closes | Restore focus after the new tool DOM mounts | Actual host focus returns to execution-tool-superagent_read after Escape |

The initial wire/tab/dialog comparisons were blocked and fixed before the three-Worker screenshot was re-captured. The later rounded-card/Tools requirement was implemented and compared again, but that iteration still failed the requested motion composition and actual compact pane. Those blockers were resolved by the new Calls view and corrected breakpoint, then checked in the user's real window. Configuration save and prompt checks were repeated through the actual host API. The final focus fix was rechecked on the real host after deployment.

## Required fidelity surfaces

- **Typography:** existing system font stack (-apple-system, Segoe UI, PingFang SC, Microsoft YaHei); 36 px desktop title, 24 px Router/Workers, 20 px Worker headings, 16 px editable model controls. The denser Tools layout uses smaller supporting labels than the original image. Chinese labels wrap cleanly; narrow inputs remain 16 px. No extra title subtitle is introduced.
- **Spacing/layout:** Calls uses a centered actor, balanced perimeter columns, role tabs and bounded rounded wires. Configuration uses a green Router, explicit queue and 12 px independent Worker cards. Native fields and Worker counts drive geometry. Original chrome DOM is byte-for-byte unchanged on the real deployment. Configuration tools move below the flow in narrower containers; Calls retains its compact graph down to a 401 px container.
- **Colors/tokens:** AgentHub green #226349, Router #edf5ee, border/line #709480 and neutral #586b61. Running/failure are also written as text, not communicated only by color.
- **Assets:** genuine Feishu/WeCom favicons; existing coding-client UI glyphs match the later feedback screenshot. No reconstructed paid logos/illustrations or affectUI Pro assets are used. Relationship SVGs are functional geometry. CSS/DOM assets remain crisp in the final captures.
- **Copy/content:** real entry inventory and models replace illustrative fixed content. Prompt scope explicitly says all Workers. Recorded calls show actual state/duration/model. Tool Returned describes an invocation response; task/job completion remains distinct. Clean forms disable Save; no artificial running counts or simulated completion are shown.

## Interaction and evidence boundaries

Passed checks: TypeScript, all 350 tests in 27 files, 11 DOM/host API cases, one and ten Worker limits, independent cards, model persistence, prompt save with draft retention, new-entry/service navigation, empty/actual call history, keyboard navigation, Escape/focus return, reduced motion, disconnect/re-authentication and Chinese 390 px overflow checks. Calls-specific checks cover retained actor tabs, preview without host mutation, correct selected-Worker caller flow and actual-model attribution. Normal-view console review found no new JavaScript exception; deliberately stopped hosts produced expected network/401 diagnostics. Native runtime validation completed two actual tasks and four real managed tool calls. It used a local direct API trigger, not a new desktop-message or office transport E2E test. The real ten-Worker draft was restored and verified before closing the old tab; saved runtime Workers remain two.

P3 follow-up: broader physical-device and cross-browser motion/performance measurement. No FPS guarantee or complete accessibility audit is claimed. Old task histories are retained; metadata recorded before this feature is not synthesized.

## Implementation checklist

- [x] Preserve header/sidebar and saved deployment data.
- [x] Wire real settings, role instructions and provider-neutral call metadata.
- [x] Independent Worker cards, selected-node tool map and read-only detail animation.
- [x] Cancel animations/listeners on unmount; retain drafts and focus.
- [x] Open combined comparisons, run browser/native checks and complete self-review.

final result: passed


---

# 2026-11-14 · Roppo Agent 头像

范围：把用户确认的 R 形角色接入已有内置 Chat；不是重建概念稿的展示板。此前记录保留在本文件上方。

## Comparison target and evidence

- Source visual truth: `docs/images/agent-identity-concept.png`，1536 × 1024，用户本次明确选择的第一版。
- Full implementation: `docs/images/agent-identity-worker-light.png`、`agent-identity-worker-dark.png`，1440 × 960 CSS/pixel，DPR 1，已等待 Worker 对话加载完成；保留真实产品界面。
- Focused asset comparison: `docs/images/agent-identity-portrait-proof.png`，1440 × 960 CSS/pixel，DPR 1；同一浏览器中渲染五个生产 WebP，在浅深背景显示 24/32/36/72 px 头像，另提供大图查看轮廓和边缘。
- Mobile: `docs/images/agent-identity-contacts-mobile.png`、`agent-identity-empty-mobile.png`，390 × 844 CSS/pixel，DPR 1。
- Team context: `docs/images/agent-identity-team-dark.png`，1440 × 960，真实团队动态区域。
- 选定稿与实际界面在同一次比较输入中打开；之后又将选定稿、小尺寸校样、深色对话和手机列表放在同一次输入中检查。源稿是角色展示板，产品截图是实际聊天；比较角色形体、配色和小尺寸表现，不声称页面布局像素等同。

## Findings

没有剩余可执行的 P0/P1/P2 视觉问题。R 形轮廓、双眼、哑光色系和四款 Worker 的顶部差异保留，正文与发言者名称对齐，头像完整且未拉伸。

第一次深色截图抓到了切换好友后的过渡内容，不能用来比较相同状态；验收脚本已等待两条 Worker 协作消息加载完成，并重新捕获了深色截图。这是证据状态修正，没有据此修改产品行为。

## Required fidelity surfaces

- Fonts/typography：现有字体、名称、说明和正文样式保留；头像不承载额外文案。
- Spacing/layout：消息头像 32 px，对应正文左缩进 44 px；好友列表 36 px；团队详情适配头像后的行内间距；手机无横向溢出，输入区和导航可用。
- Colors/tokens：墨黑 Router 与四款低饱和 Worker 保留；深色 Router 采用浅色轮廓，Worker 不反色。状态仍有文字和图标，不依赖头像颜色。
- Image quality：真实生成透明素材，发布为 256 px WebP；在实际大小和放大图检查，无可见白底、彩边、截肢或遮挡。透明原图的极低 alpha 边缘没有在最终浏览器合成中形成可见瑕疵。五款合计 42,110 bytes。没有使用手绘 SVG 或 CSS 图形替代角色。
- Copy/content：保留“与 Router 对话”“只读”“请与 Router 对话”等原产品文案，没有新增配置项或将开发/测试职业绑定到某一角色。

## Browser and functional checks

构建和 TypeScript 通过；现有 Chat 浏览器脚本 6 组流程通过，包含固定空间、Worker 只读、草稿、显示切换、清空/重新提交、头像加载与重新加载后的身份一致。额外检查团队动态和移动端空白页。page error / 非预期 console error 均为 0；裸宿主已有的可选发现接口 404 单独排除。

IAB 控制工具连接超时；实际渲染由项目既有 Python Playwright 验收方式完成，使用本机已有 Playwright 1.65.1 / Chromium。宿主为隔离测试实例，模型为确定性回复；未部署用户实例。

## Implementation checklist

- [x] 保留用户选择的第一版角色。
- [x] 五款透明生产素材，稳定 ID 选择，无新增配置。
- [x] 消息、联系人、团队动态、空白页统一头像。
- [x] 浅深主题、小尺寸与 390 px 实际渲染检查。
- [x] 既有交互回归与代码自审。

P3：四款 Worker 形象允许复用；名称作为身份区分。概念稿的表情变体不属于本次静态头像接入。

final result: passed
