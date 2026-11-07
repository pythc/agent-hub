import {
  BookOpen,
  History,
  Inbox,
  Link2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Users,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import mark from "../../src/ui/assets/roppo-mark.png";

type Props = {
  L: (en: string, zh: string) => string;
  configuring: boolean;
  hash: string;
  expanded: boolean;
  onExpanded: () => void;
  mobile: boolean;
  menuOpen: boolean;
  closeMenu: () => void;
  openWorkspaces: () => void;
  user?: { displayName: string };
};
/** Global functions stay separate from the conversation list, even when collapsed. */
export function FeatureNavigation({
  L,
  configuring,
  hash,
  expanded,
  onExpanded,
  mobile,
  menuOpen,
  closeMenu,
  openWorkspaces,
  user,
}: Props) {
  const groups = [
    [
      {
        href: "/chat",
        label: L("Conversations", "对话"),
        Icon: MessageSquare,
        current: !configuring,
      },
      {
        href: "/configure#tasks/history",
        label: L("Tasks", "任务"),
        Icon: History,
        current: configuring && hash === "tasks/history",
      },
      {
        href: "/configure#attention",
        label: L("Needs attention", "待处理"),
        Icon: Inbox,
        current: configuring && hash === "attention",
      },
    ],
    [
      {
        href: "/configure#execution/configuration",
        label: L("Agent team", "Agent 团队"),
        Icon: Users,
        current: configuring && hash.startsWith("execution"),
      },
      {
        href: "/configure#models",
        label: L("Model connections", "模型连接"),
        Icon: Link2,
        current: configuring && hash.startsWith("models"),
      },
      {
        href: "/configure#connections",
        label: L("Conversation entries", "会话入口"),
        Icon: Plug,
        current: configuring && hash.startsWith("connections"),
      },
      {
        href: "/configure#integrations",
        label: L("Tools and apps", "工具与应用"),
        Icon: Wrench,
        current: configuring && hash === "integrations",
      },
      {
        href: "/configure#prompts",
        label: L("Shared instructions", "共享指令"),
        Icon: MessageSquare,
        current: configuring && hash.startsWith("prompts"),
      },
    ],
  ];
  const collapse = expanded
    ? L("Collapse function navigation", "折叠功能栏")
    : L("Expand function navigation", "展开功能栏");
  return (
    <aside
      className="chat-sidebar functions-sidebar"
      id="function-navigation"
      aria-label={L("Workspace navigation", "工作区导航")}
      inert={mobile && !menuOpen}
    >
      <div className="functions-brand">
        <a href="/chat" aria-label="Roppo" title="Roppo">
          <img className="roppo-mark" src={mark} alt="" />
          <span className="nav-label">Roppo</span>
        </a>
      </div>
      <a
        className="function-link workspace-entry"
        href="/configure#tasks"
        aria-current={configuring && hash === "tasks" ? "page" : undefined}
        aria-haspopup="dialog"
        aria-label={L("Current workspace", "当前工作区")}
        title={L("Current workspace", "当前工作区")}
        onClick={openWorkspaces}
      >
        <UserRound size={19} />
        <span className="nav-label">
          {L("Current workspace", "当前工作区")}
        </span>
      </a>
      <nav className="function-groups" aria-label={L("Functions", "功能")}>
        {groups.map((group, index) => (
          <div className="function-group" key={index}>
            {group.map(({ href, label, Icon, current }) => (
              <a
                key={href}
                href={href}
                className="function-link"
                aria-label={label}
                title={label}
                aria-current={current ? "page" : undefined}
              >
                <Icon size={19} />
                <span className="nav-label">{label}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>
      <footer className="function-footer">
        <a
          className="function-link"
          href="/configure#usage"
          aria-label={L("Usage guide", "使用指引")}
          title={L("Usage guide", "使用指引")}
          aria-current={configuring && hash === "usage" ? "page" : undefined}
        >
          <BookOpen size={19} />
          <span className="nav-label">{L("Usage guide", "使用指引")}</span>
        </a>
        <a
          className="function-link"
          href="/configure#advanced/host"
          aria-label={L("Settings", "设置")}
          title={L("Settings", "设置")}
          aria-current={
            configuring && hash.startsWith("advanced") ? "page" : undefined
          }
        >
          <Settings size={19} />
          <span className="nav-label">{L("Settings", "设置")}</span>
        </a>
        <button
          className="function-link navigation-collapse"
          onClick={onExpanded}
          aria-expanded={expanded}
          aria-controls="function-navigation"
          aria-label={collapse}
          title={collapse}
        >
          {expanded ? (
            <PanelLeftClose size={19} />
          ) : (
            <PanelLeftOpen size={19} />
          )}
          <span className="nav-label">{L("Collapse", "折叠")}</span>
        </button>
        {mobile && menuOpen ? (
          <button
            className="function-link close-functions"
            onClick={closeMenu}
            aria-label={L("Close navigation", "关闭导航")}
            title={L("Close navigation", "关闭导航")}
          >
            <X size={19} />
            <span className="nav-label">{L("Close", "关闭")}</span>
          </button>
        ) : null}
        <a
          className="function-link rail-profile"
          href="/account"
          aria-label={L("Your account", "你的账号")}
          title={user?.displayName ?? L("Your account", "你的账号")}
        >
          <span className="avatar">
            {user?.displayName?.slice(0, 1).toUpperCase() ?? "R"}
          </span>
          <span className="nav-label">
            {user?.displayName ?? L("Your account", "你的账号")}
          </span>
        </a>
      </footer>
    </aside>
  );
}
