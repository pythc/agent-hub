import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import postcss from "postcss";
import {
  configurationScripts,
  configurationStyles,
} from "../../src/ui/configuration-assets.ts";

/** Compile the existing configuration controllers into a content module, never an iframe or runtime eval. */
export function configurationContent(): Plugin {
  const asset = (name: string) =>
    readFileSync(new URL("../../src/ui/" + name, import.meta.url), "utf8");
  return {
    name: "roppo-configuration-content",
    resolveId(id) {
      if (id === "virtual:configuration-content") return "\0" + id;
    },
    load(id) {
      if (id !== "\0virtual:configuration-content") return;
      const css = postcss.parse(configurationStyles.map(asset).join("\n"));
      css.walkRules((rule) => {
        if (
          rule.parent?.type === "atrule" &&
          /keyframes$/.test(rule.parent.name)
        )
          return;
        rule.selectors = rule.selectors.map((selector) => {
          if (/^(:root|html|body)(?=[\s.:#\[]|$)/.test(selector))
            return selector.replace(
              /^(:root|html|body)/,
              ".management-content",
            );
          return ".management-content " + selector;
        });
      });
      const executionAssets = Object.fromEntries(
        ["feishu", "wecom"].map((name) => [
          name,
          "data:image/x-icon;base64," +
            readFileSync(
              new URL("../../src/ui/assets/" + name + ".ico", import.meta.url),
            ).toString("base64"),
        ]),
      );
      return `export function mount(configurationHost){
      const style=document.createElement('style');style.textContent=${JSON.stringify(css.toString())};document.head.append(style);
      const executionAssets=${JSON.stringify(executionAssets)};
      ${configurationScripts.map((name) => (name === "application.js" ? asset(name).replace("void startEntrySession()", "const configurationReady=startEntrySession()") : asset(name))).join("\n")}
      return {activate(language){lang=language;applyWorkspaceLocation();render()}, language(language){lang=language;render()}, async workspace(){await configurationReady;if(configurationHost.active())workspaceShowPicker()}};
    }`;
    },
  };
}
