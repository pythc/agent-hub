# Agent board changes

## 0.1.4 (unreleased)

Add durable team token accounting by purpose, source-filtered totals, cache/reasoning subsets, and explicit missing/partial coverage. Requires a host with usage accounting; older hosts show an unavailable state. No account, prompt, tool arguments, or native history crosses the view bridge.

新增团队 token 用量、用途分组、来源筛选和缺报状态；缓存输入与推理输出分别计入输入与输出，不重复相加。旧宿主显示尚未提供统计。此版本尚未发布或安装到现有实例。

## 0.1.3

Use plain-language labels throughout the board, including auxiliary model modes, usage reporting, judgment status, suggestions and task details. Keep unknown usage distinct from zero and reported-record counts distinct from token totals. Remove the usage footnote while retaining its scope in accessible hover descriptions. Suggestions remain suggestions; a read receipt remains a client acknowledgment, not proof that a person has read a reply.

统一看板文案：仅记录、提供建议、用量记录数、判断状态、建议和任务详情均改用通俗表达。未知用量不显示为零，记录条数不混作 token 用量。移除用量区底部小字，统计范围保留在可访问的悬停说明中。模型建议不表示已执行，已读回执不表示用户本人已读。

## 0.1.2

Simplify message-handling labels in English and Chinese. Remove the metric-card captions and explanatory footer; precise counting windows remain available on hover and to screen readers. Counts and routing behavior are unchanged.

消息处理指标改用通俗的中英文名称，移除卡片小字和底部说明。统计范围可通过悬停及屏幕阅读器查看，计数与路由行为保持不变。

## 0.1.1

Task, activity and admission timestamps now expose their full local date and time zone on hover, with machine-readable timestamps. This distinguishes records from different days while keeping rows compact. Invalid historical timestamps render an unavailable marker instead of crashing the view.

任务、动态和准入记录的时间现可悬停查看完整本地日期与时区，并提供机器可读时间。跨日记录更易区分，无效历史时间显示不可用标记。

## 0.1.0

First release: live team overview, tasks, attention, tool activity, browser handoffs, listening decisions and token usage, with source filters and English/Chinese white/dark themes.

首版：团队总览、任务、待处理事项、工具动态、浏览器接管、监听决策和 token 用量，支持来源筛选、中英文与黑白主题。
