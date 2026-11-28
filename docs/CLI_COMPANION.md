# CLI 顶部角色动效

顶部居中显示网页版的 R 形角色：3 行点阵和 1 行状态文字。它占用独立布局空间，不覆盖对话和输入框。角色本身约 6 列 × 3 行；交接动作在 16 列范围内移动。

`/animation` 每次调用切换显示开关，默认开启，立即生效并保存到终端用户设置。关闭后停止角色动画计时器并收起四行空间，不弹确认窗口。现有 `motion=reduced` 设置保留静态角色；窗口少于 18 行时临时隐藏角色，放大后恢复，不改保存的偏好。

## 网页复用与终端重构

- 直接复用 `web/chat/companion-state.ts` 的真实活动状态和状态文字。
- 轮廓取自原有 `src/ui/assets/agents/roppo-body.webp` 的透明度采样。终端以 Unicode Braille 点阵重绘，无新增图片依赖，也不要求终端支持图片协议。
- 参考 `roppo-character.tsx`、`companion.css` 和 `companion-scene.tsx`：4.8 秒呼吸、5.8 秒眨眼周期、思考探头、敲键盘、查阅、完成摆动和 6 秒交接。因终端点阵分辨率有限，曲线、渐变和亚像素位移做了离散化近似。
- 活跃状态切换沿用 1.4 秒稳定时间。首次载入不重放历史交接；关闭时的新交接不会在重新开启后补播。
- 网页代码和原贴图没有修改。

## 文件变更说明

| 文件 | 说明 |
| --- | --- |
| `src/terminal/companion.ts`（新增） | 原贴图点阵轮廓、动作绘制、真实状态与交接播放 |
| `src/terminal/tui-screen.ts` | 顶部居中区域、主题颜色、计时器与窄屏布局 |
| `src/terminal/settings.ts` | 默认开启的 `animation` 持久化设置 |
| `src/terminal/controls.ts` | `/animation` 开关及保存 |
| `src/terminal/tui-actions.ts` | 命令补全、设置入口和即时提示 |
| `src/terminal/commands.ts` | 命令说明 |
| `tests/terminal-companion.spec.ts`（新增） | 交接不重放、关闭后不补播、完成状态与减少动效 |
| `tests/terminal-settings.spec.ts` | 连续开关、重启读取及其他设置保留 |
| `tests/terminal-tui.ts` | 原生渲染的显示/隐藏、空屏滚动、窄屏输入框 |
| `docs/TERMINAL.md`、本文（新增） | 使用方法、复现范围和逐文件说明 |

没有删除项目文件。验证包括宿主 TypeScript 检查、38 项 CLI 测试、OpenTUI 原生渲染测试和已安装 CLI 的真实终端显示检查。

## 启动过场与网页入口更新

每次重新打开交互 CLI，首次读到会话后播放 2 秒全屏像素潮汐，角色从左往右走过、不招手；接着在顶部播放 1.4 秒探头、眨眼和挥手。按键、粘贴、点击或打开菜单可以跳过，输入不会丢失。关闭 `/animation`、减少动效或短窗口时跳过；刷新、调整窗口和重新启用开关不补播。

顶部移除 `/ personal`。底栏左侧 `Open web ↗` 打开同一段网页版对话，右侧 `Commands · ctrl+p` 打开可搜索的命令面板；中间空白不响应点击。预览的滑杆按钮属于预览工具，实际 CLI 没有该按钮。

网页与 CLI 共用同一本机服务和账号的数据。配置修改增加独立事件通知，保证网页修改模型后，空闲 CLI 也会更新；聊天事件编号保持原协议。测试使用两个入口验证模型和消息一致，没有修改用户现有模型或消息。

本次文件变更：

- `src/terminal/startup.ts`：新增终端全屏潮汐、行走和顶部探头动作绘制。
- `src/terminal/companion.ts`：复用角色轮廓，将启动招手移交给完整启动序列。
- `src/terminal/tui-screen.ts`：启动生命周期、跳过与清理，精简标题，拆分底栏点击区域。
- `src/terminal/tui-actions.ts`：网页版入口打开当前对话，成功后只给轻提示。
- `src/server.ts`、`src/terminal/client.ts`：配置变更通知与终端刷新。
- `tests/terminal-tui.ts`：原生渲染验证两段动画、每次启动、输入/鼠标跳过、窗口变化和底栏点击区域。
- `tests/terminal.spec.ts`：验证浏览器与 CLI 共享消息和配置，以及空闲时接收模型更新。
- `tests/terminal-tui-actions.spec.ts`：验证网页版入口使用当前对话地址。
- `docs/TERMINAL.md`、本文：更新使用方法与文件变更说明。

没有删除项目文件。

## 点阵漏点修正

保留原来的 12×12 点阵轮廓、Braille 字符、大小和布局。角色倾斜时改用目标像素反向采样，避免相邻源像素取整到同一位置、留下内部空洞；眼睛先在原轮廓中绘制，再一起变换。已复现并修复完成动画 1600ms、思考动画 1900ms 的身体漏点。

macOS Terminal 截图中每四排点之间的整行间隙属于终端盲文字形与行高的组合效果，本次算法修正不消除该间隙，也没有修改用户终端字体或替换为实心像素。

本次只修改 `src/terminal/companion.ts`（采样绘制）、`tests/terminal-companion.spec.ts`（漏点回归与原轮廓检查）和本文。没有删除文件。类型检查、点阵测试和原生 TUI 测试通过。

## macOS 横向间隙的字体适配

后续通过 CoreText 确认：Menlo 不含 Braille 字符，系统会回退到 Apple Braille，四排圆点的高度与正文行高不一致。为此提供独立的 Roppo Mono 字体：保留 JetBrains Mono 的普通字形和指标，补入覆盖全行高度的 256 个圆点字形。角色仍使用原有点阵、三行布局和动画。

运行 `npm run setup:terminal-font` 安装，再打开 `~/.roppo/terminal/Roppo.terminal`，在新窗口运行 `roppo`。已有窗口需要选择新字体才会生效；该安装不会自动更改默认终端配置。

CoreText 验证所有点阵字符均由新字体直接绘制，没有字体回退；三行满点阵得到连续的十二排圆点，2× 渲染的相邻排中心距离为 7.91–8.27 像素，原来的两处大间隙不再出现。这个验证覆盖系统字体渲染；Terminal.app 的实际窗口仍需选用新配置后确认。

本次新增 `assets/terminal/` 下的字体、OFL 授权、独立 Terminal 配置与使用说明，新增 `tools/fonts/build-roppo-mono.py`（字体构建源代码）及 `bin/install-terminal-font.mjs`（本机安装），修改 `package.json`（安装命令）、`docs/TERMINAL.md` 和本文。没有删除项目文件，也没有修改角色绘制代码。

## 角色比例调整

在原版点阵轮廓上加宽 50%、增高约 10%，静止身体的实际点阵范围由 8 列 × 10 排变为 12 列 × 11 排。圆点字形不变，顶部区域仍占三行字符和一行状态文字。使用同一个输出采样调整顶部状态、交接道具和启动行走/招手，保持两处角色比例一致。

修改 `src/terminal/companion.ts`（共享比例采样）、`src/terminal/startup.ts`（启动动画复用采样）、`tests/terminal-companion.spec.ts`（更新尺寸及漏点回归位置）和本文。没有删除文件。点阵测试、原生 TUI/启动测试和 TypeScript 检查通过，并用 macOS CoreText 检查了实际圆点字形的渲染效果。


## 原版等比例放大与双眼修正

恢复原版轮廓，取消横向 1.5 倍、纵向 1.1 倍的拉伸，统一以 1.2 倍采样。字符网格取整后，静止身体约为 10 列 × 12 排点；完整动画区域使用四行字符和一行状态文字，以免裁掉头顶、脚和道具。小于 19 行的窗口隐藏角色。

头顶第一排由居中的两个源点扩为四个源点，缩放后的顶部过渡更平缓。

双眼改为在身体缩放完成后绘制，避免取整把一只眼复制成更大的缺口。睁眼为两条等大的短竖线，眨眼及完成表情为两条等长的短横线，保持眼间的点阵分隔；面部位置随身体倾斜移动。启动动画复用同一绘制方式。

本次修改 `src/terminal/companion.ts`（统一缩放、双眼）、`src/terminal/startup.ts`（启动比例与双眼）、`src/terminal/tui-screen.ts`（四行布局）、`tests/terminal-companion.spec.ts` 和 `tests/terminal-tui.ts`（尺寸、双眼与启动一致性验证）、`docs/TERMINAL.md` 和本文。没有删除文件。

## 左上角字标

左上角单行灰色 `roppo` 改成两行、19 列的亮色像素字标，提高标题辨识度。窗口低于 20 行或窄于 24 列时使用单行标题，保留输入空间。通知结束后恢复当前尺寸的字标。

修改 `src/terminal/tui-screen.ts`（标题、通知恢复与布局）、`tests/terminal-tui.ts`（启动露出字标检查）和本文。没有删除文件。

## 顶部对齐

宽窗口中字标和居中的角色共享同一顶部区域，从同一字符行开始，回收原先上下堆叠多占的两行。状态文字继续放在角色下方。窄于 76 列或正在显示通知时恢复上下布局，避免字标、提示与角色重叠。

修改 `src/terminal/tui-screen.ts`（共享顶部区域与尺寸计算）、`tests/terminal-tui.ts`（同排、居中检查）和本文。没有删除文件。
