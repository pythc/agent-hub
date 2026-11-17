import { Icon } from "./UI";

export function BrandMark({ app, size = 30 }: { app: string; size?: number }) {
  if (app === "Slack")
    return (
      <svg width={size} height={size} viewBox="0 0 54 54" aria-label="Slack">
        <g fill="#36c5f0">
          <rect x="13" y="3" width="10" height="23" rx="5" />
          <circle cx="8" cy="21" r="5" />
        </g>
        <g fill="#2eb67d">
          <rect x="28" y="13" width="23" height="10" rx="5" />
          <circle cx="33" cy="8" r="5" />
        </g>
        <g fill="#ecb22e">
          <rect x="31" y="28" width="10" height="23" rx="5" />
          <circle cx="46" cy="33" r="5" />
        </g>
        <g fill="#e01e5a">
          <rect x="3" y="31" width="23" height="10" rx="5" />
          <circle cx="21" cy="46" r="5" />
        </g>
      </svg>
    );
  if (app === "Linear")
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" aria-label="Linear">
        <circle cx="20" cy="20" r="18" fill="#6264dc" />
        <path
          d="m4 25 11 11M4 18l18 18M7 12l21 21M12 7l21 21"
          stroke="white"
          strokeWidth="2.8"
        />
      </svg>
    );
  if (app === "GitHub")
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 7,
          background: "#18181b",
          color: "white",
          display: "grid",
          placeItems: "center",
        }}
      >
        <Icon name="code" size={size * 0.7} />
      </div>
    );
  return <Icon name="plug" size={size} />;
}
