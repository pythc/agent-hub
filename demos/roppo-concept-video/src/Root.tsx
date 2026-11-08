import { Composition, Folder } from "remotion";
import { RoppoConcept, DecisionWalkthrough } from "./Composition";
import { DemoScene } from "./Scenes";
export const RemotionRoot = () => (
  <>
    <Composition
      id="Roppo-Concept"
      component={RoppoConcept}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={4770}
    />
    <Folder name="Scenes">
      <Composition
        id="Personal-And-Organization"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={210}
        defaultProps={{
          kind: "positioning",
          title: "为一个人，也为整个组织",
          caption: "你的 24 小时助手，组织的智能协作中枢。",
        }}
      />
      <Composition
        id="Model-Access"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
        defaultProps={{
          kind: "runtimes",
          title: "三种接入方式，按角色自由组合",
          caption: "复用受支持的订阅额度，也可使用 CLI 自带的工具和插件。",
        }}
      />
      <Composition
        id="Role-Tools"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
        defaultProps={{
          kind: "roletools",
          title: "每个 Router 和 Worker，都能独立配置",
          caption: "模型、思考参数、提示词和工具权限，按角色设置。",
        }}
      />
      <Composition
        id="App-Ecosystem"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={270}
        defaultProps={{
          kind: "ecosystem",
          title: "连接应用，管理一个或多个群聊",
          caption: "飞书、Slack、Linear，通过适配器与插件 / MCP 扩展。",
        }}
      />
      <Composition
        id="Decision-Layer-Walkthrough"
        component={DecisionWalkthrough}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={660}
      />
      <Composition
        id="Decision-Layer-Settings"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={270}
        defaultProps={{
          kind: "decision",
          title: "让轻量判断，也能按需配置",
          caption: "Jev、自部署模型或外接服务，为 Router 提供意图建议。",
        }}
      />
      <Composition
        id="Proactive-Listening"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={390}
        defaultProps={{
          kind: "listening",
          title: "批处理、规则检查、辅助判别，再由 Router 介入",
          caption: "先检查范围，再结合辅助建议；最终介入由 Router 决定。",
        }}
      />
      <Composition
        id="Local-Deployment"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
        defaultProps={{
          kind: "local",
          title: "本地优先，开源可部署",
          caption: "按自己的需求配置模型、角色和工具，打造你的 AI 团队。",
        }}
      />
      <Composition
        id="Model-Connection"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
        defaultProps={{
          kind: "connect",
          title: "接入你选择的模型",
          caption: "API、受支持的订阅或 CLI，各自配置，各尽其用。",
        }}
      />
      <Composition
        id="Feishu-Inbox"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={330}
        defaultProps={{
          kind: "inbox",
          title: "群聊里提到问题，Router 主动接手",
          caption: "已授权范围内自动处理，完成后回到原群报告。",
        }}
      />
      <Composition
        id="Feishu-Delivery"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={270}
        defaultProps={{
          kind: "delivery",
          title: "结果，自动回到工作发生的地方",
          caption: "Router 统一回复，交付变更、报告和待确认事项。",
        }}
      />
      <Composition
        id="Team-Activity"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={330}
        defaultProps={{
          kind: "work",
          title: "并行推进，统一交付",
          caption: "Workers 独立执行，结果回到 Router 汇总。",
        }}
      />
      <Composition
        id="Browser-Takeover"
        component={DemoScene}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={270}
        defaultProps={{
          kind: "browser",
          title: "浏览器就在会话里",
          caption: "独立浏览环境，保留登录状态，必要时由你接管。",
        }}
      />
    </Folder>
  </>
);
