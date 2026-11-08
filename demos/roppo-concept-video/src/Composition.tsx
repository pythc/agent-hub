import { Track, useVideoConfig } from "remotion";
import { DemoScene } from "./Scenes";
import "./video.css";
export const RoppoConcept = () => {
  const { fps } = useVideoConfig();
  return (
    <Track name="Roppo · 完整使用流程">
      <DemoScene
        name="开场 · Roppo"
        kind="intro"
        title=""
        caption=""
        durationInFrames={5 * fps}
      />
      <DemoScene
        name="个人与组织"
        kind="positioning"
        title="为一个人，也为整个组织"
        caption="你的 24 小时助手，组织的智能协作中枢。"
        from={5 * fps}
        durationInFrames={7 * fps}
      />
      <DemoScene
        name="进入工作区"
        kind="access"
        title="进入你的工作区"
        caption="本地账号，登录后回到自己的工作空间。"
        from={12 * fps}
        durationInFrames={6 * fps}
      />
      <DemoScene
        name="连接模型"
        kind="connect"
        title="接入你选择的模型"
        caption="API、受支持的订阅或 CLI，各自配置，各尽其用。"
        from={18 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="API · 订阅 · CLI"
        kind="runtimes"
        title="三种接入方式，按角色自由组合"
        caption="复用受支持的订阅额度，也可使用 CLI 自带的工具和插件。"
        from={26 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="配置 Router 与 Workers"
        kind="team"
        title="一个 Router，分工明确的 Workers"
        caption="你设定目标和边界，Router 管理执行团队。"
        from={34 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="角色提示词与工具"
        kind="roletools"
        title="每个 Router 和 Worker，都能独立配置"
        caption="模型、思考参数、提示词和工具权限，按角色设置。"
        from={42 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="插件生态与多群协作"
        kind="ecosystem"
        title="连接应用，管理一个或多个群聊"
        caption="飞书、Slack、Linear，通过适配器与插件 / MCP 扩展。"
        from={50 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="额外决策层 · 接入配置"
        kind="decision"
        title="让轻量判断，也能按需配置"
        caption="Jev、自部署模型或外接服务，为 Router 提供意图建议。"
        from={59 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="批处理 · 规则 · 辅助判别 · 介入"
        kind="listening"
        title="批处理、规则检查、辅助判别，再由 Router 介入"
        caption="先检查范围，再结合辅助建议；最终介入由 Router 决定。"
        from={68 * fps}
        durationInFrames={13 * fps}
      />
      <DemoScene
        name="飞书 · 无需 @ 自动接手"
        kind="inbox"
        title="群聊里提到问题，Router 主动接手"
        caption="已授权范围内自动处理，完成后回到原群报告。"
        from={81 * fps}
        durationInFrames={11 * fps}
      />
      <DemoScene
        name="Roppo · 接收任务"
        kind="route"
        title="消息进入 Roppo，成为可追踪的任务"
        caption="来源、目标和执行范围，集中在一个工作空间。"
        from={92 * fps}
        durationInFrames={7 * fps}
      />
      <DemoScene
        name="团队动态 · 分工执行"
        kind="work"
        title="并行推进，统一交付"
        caption="对话、工具调用和任务进展，都在同一个工作空间。"
        from={99 * fps}
        durationInFrames={11 * fps}
      />
      <DemoScene
        name="浏览器 · 人工接管"
        kind="browser"
        title="浏览器就在会话里"
        caption="独立浏览环境，保留登录状态，必要时由你接管。"
        from={110 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="文件 · 查看证据"
        kind="files"
        title="过程可见，结果可查"
        caption="查看文件、代码改动、工具调用与验证记录。"
        from={119 * fps}
        durationInFrames={8 * fps}
        dark
      />
      <DemoScene
        name="停止 · 补充 · 续接"
        kind="control"
        title="随时停止，也能接着做"
        caption="补充新的范围，沿用已有上下文继续执行。"
        from={127 * fps}
        durationInFrames={9 * fps}
        dark
      />
      <DemoScene
        name="飞书 · 自动返回结果"
        kind="delivery"
        title="结果，自动回到工作发生的地方"
        caption="Router 统一回复，交付变更、报告和待确认事项。"
        from={136 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="本地优先 · 开源部署"
        kind="local"
        title="本地优先，开源可部署"
        caption="按自己的需求配置模型、角色和工具，打造你的 AI 团队。"
        from={145 * fps}
        durationInFrames={8 * fps}
        dark
      />
      <DemoScene
        name="收尾 · Roppo"
        kind="outro"
        title=""
        caption=""
        from={153 * fps}
        durationInFrames={6 * fps}
        dark
      />
    </Track>
  );
};

export const DecisionWalkthrough = () => {
  const { fps } = useVideoConfig();
  return (
    <Track name="额外决策层 · 配置与流程">
      <DemoScene
        name="额外决策层 · 接入配置"
        kind="decision"
        title="让轻量判断，也能按需配置"
        caption="Jev、自部署模型或外接服务，为 Router 提供意图建议。"
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="批处理 · 规则 · 辅助判别 · 介入"
        kind="listening"
        title="批处理、规则检查、辅助判别，再由 Router 介入"
        caption="先检查范围，再结合辅助建议；最终介入由 Router 决定。"
        from={9 * fps}
        durationInFrames={13 * fps}
      />
    </Track>
  );
};
