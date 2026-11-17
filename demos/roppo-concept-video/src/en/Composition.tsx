import { Track, useVideoConfig } from "remotion";
import { DemoScene } from "./Scenes";
import "../video.css";

export const RoppoEnglish = () => {
  const { fps } = useVideoConfig();
  return (
    <Track name="Roppo · English product walkthrough">
      <DemoScene
        name="Opening"
        kind="intro"
        title=""
        caption=""
        durationInFrames={5 * fps}
      />
      <DemoScene
        name="For you and your organization"
        kind="positioning"
        title="Built for one person. Ready for an organization."
        caption="Your 24/7 assistant. Your team's intelligent coordination hub."
        from={5 * fps}
        durationInFrames={7 * fps}
      />
      <DemoScene
        name="Open your workspace"
        kind="access"
        title="Your workspace, on your machine"
        caption="Sign in to your local account and pick up where you left off."
        from={12 * fps}
        durationInFrames={6 * fps}
      />
      <DemoScene
        name="Connect a model"
        kind="connect"
        title="Bring your own model connection"
        caption="Choose your provider, model and parameters."
        from={18 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="API, subscription or CLI"
        kind="runtimes"
        title="Three ways to connect. One team."
        caption="Model APIs, supported subscriptions, or your signed-in local CLI."
        from={26 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="Configure your team"
        kind="team"
        title="One Router. Specialized Workers."
        caption="You set the goal. Router coordinates the team."
        from={34 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="Instructions and tools"
        kind="roletools"
        title="Configure each role independently"
        caption="Models, reasoning, instructions and tools — tailored to every agent."
        from={42 * fps}
        durationInFrames={8 * fps}
      />
      <DemoScene
        name="Connect Slack and Linear"
        kind="ecosystem"
        title="Connect the places where work happens"
        caption="Bring Slack channels, Linear projects and your tools into one workflow."
        from={50 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="Optional decision layer"
        kind="decision"
        title="Choose how lightweight decisions are made"
        caption="Jev, a self-hosted model, or an external API can advise Router."
        from={59 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="Batch, check, assess, intervene"
        kind="listening"
        title="Batch messages. Check rules. Assess intent. Then act."
        caption="Reduce repeated context. Keep the final decision with Router."
        from={68 * fps}
        durationInFrames={13 * fps}
      />
      <DemoScene
        name="Slack — no mention needed"
        kind="inbox"
        title="A problem surfaces in Slack. Roppo picks it up."
        caption="Within the approved channel scope, no @mention is needed."
        from={81 * fps}
        durationInFrames={11 * fps}
      />
      <DemoScene
        name="Linear — create and track"
        kind="linear-intake"
        title="Turn the conversation into tracked work"
        caption="A linked Linear issue keeps scope, ownership and progress in one place."
        from={92 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="Router receives the task"
        kind="route"
        title="The conversation becomes a visible task"
        caption="Keep the source discussion, goal and execution together."
        from={101 * fps}
        durationInFrames={7 * fps}
      />
      <DemoScene
        name="Team activity"
        kind="work"
        title="Parallel work. One coordinated result."
        caption="Watch delegation, tool calls and Worker progress as they happen."
        from={108 * fps}
        durationInFrames={11 * fps}
      />
      <DemoScene
        name="Browser and human takeover"
        kind="browser"
        title="A browser, right beside the conversation"
        caption="Isolated profiles, persistent sign-in, and human takeover when needed."
        from={119 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="Files and evidence"
        kind="files"
        title="See the changes. Inspect the evidence."
        caption="Files, code, tool calls and verification stay in the same workspace."
        from={128 * fps}
        durationInFrames={8 * fps}
        dark
      />
      <DemoScene
        name="Stop and continue"
        kind="control"
        title="You're always in control"
        caption="Stop naturally, update the scope, and continue the same task."
        from={136 * fps}
        durationInFrames={9 * fps}
        dark
      />
      <DemoScene
        name="Linear — ready for review"
        kind="linear-review"
        title="Progress returns to Linear, with evidence"
        caption="Move the issue to In Review. Keep the human review explicit."
        from={145 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="Slack — report back"
        kind="delivery"
        title="Results return to the original Slack conversation"
        caption="One clear update, a linked issue, and the evidence to review."
        from={154 * fps}
        durationInFrames={9 * fps}
      />
      <DemoScene
        name="Local first and open source"
        kind="local"
        title="Local first. Open source. Yours to deploy."
        caption="Build your AI team around your own models, roles and tools."
        from={163 * fps}
        durationInFrames={8 * fps}
        dark
      />
      <DemoScene
        name="Closing"
        kind="outro"
        title=""
        caption=""
        from={171 * fps}
        durationInFrames={6 * fps}
        dark
      />
    </Track>
  );
};
