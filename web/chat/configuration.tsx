import { useEffect, useRef, useState } from "react";
import {createPortal} from "react-dom";
import {BrowserPanel} from './browser.tsx';
import {ChatSettings} from './chat-settings.tsx';
import {MemorySettings} from "./memory.tsx";
import type { mount } from "virtual:configuration-content";
import type {WorkspaceTransport} from "./workspace-transport.ts";
export type ConfigurationController = ReturnType<typeof mount>;
let controller: ReturnType<typeof mount> | undefined;
let element: HTMLDivElement | undefined;
let pending: Promise<void> | undefined;
let memoryElement: HTMLDivElement | undefined;
let browserElement: HTMLDivElement | undefined;
let chatElement: HTMLDivElement | undefined;
const active = () =>
  !['#worker-templates','#connectors','#execution-trace'].includes(location.hash) && location.hash !== '#automations' && location.hash !== '#prompts/memory' && !location.hash.startsWith('#plugin/') && (!location.hash.startsWith('#integrations/')||location.hash==='#integrations/tools') && (location.pathname === "/configure" ||
  location.pathname === "/configure/" ||
  location.pathname === "/");
export async function prepareConfiguration():Promise<ConfigurationController> {
  if (!pending)
    pending = import("virtual:configuration-content")
      .then((module) => {
        element = document.createElement("div");
        element.className = "management-content";
        memoryElement = document.createElement("div");
        chatElement = document.createElement("div");
        browserElement = document.createElement("div");
        controller = module.mount({ element, active, memory: () => memoryElement!, chat: () => chatElement!, browser: () => browserElement! });
      })
      .catch((error) => {
        pending = undefined;
        throw error;
      });
  await pending;
  return controller!;
}
/** Reuses the same controller even when a capability page is the first entry. */
export async function getConfigurationTransport():Promise<WorkspaceTransport> {
  return (await prepareConfiguration()).transport;
}
export function Configuration({
  visible,
  route,
  language,
  pickerRequest,
}: {
  visible: boolean;
  route: string;
  language: string;
  pickerRequest: number;
}) {
  const outlet = useRef<HTMLDivElement>(null),
    [error, setError] = useState(false),
    [browserTarget,setBrowserTarget]=useState<HTMLDivElement|null>(null),
    [chatTarget, setChatTarget] = useState<HTMLDivElement|null>(null),
    [memoryTarget, setMemoryTarget] = useState<HTMLDivElement|null>(null);
  const pickerHandled = useRef(0);
  const latest = useRef({ visible, language });
  latest.current = { visible, language };
  useEffect(() => {
    if (!visible) {
      element
        ?.querySelectorAll<HTMLDialogElement>("dialog[open]")
        .forEach((dialog) => dialog.close());
      if (!controller) return;
    }
    let alive = true;
    void prepareConfiguration()
      .then(() => {
        if (!alive) return;
        setError(false);
        outlet.current?.append(element!);
        memoryElement!.classList.add("memory-mount");
        setMemoryTarget(memoryElement!);
        setChatTarget(chatElement!);
        setBrowserTarget(browserElement!);
        if (latest.current.visible) {
          controller!.activate(latest.current.language);
          if (pickerRequest > pickerHandled.current) {
            pickerHandled.current = pickerRequest;
            void controller!.workspace();
          }
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [visible, route, pickerRequest]);
  useEffect(() => {
    controller?.language(language);
  }, [language]);
  return (
    <section
      className="configuration-outlet"
      hidden={!visible}
      aria-label={language === "en" ? "Workspace content" : "工作区内容"}
    >
      <div ref={outlet} />
      {visible && route.split("#")[1] === "advanced/memory" && memoryTarget ? createPortal(<MemorySettings L={(en, zh) => language === "en" ? en : zh}/>, memoryTarget) : null}
      {visible && route.split("#")[1] === "advanced/chat" && chatTarget ? createPortal(<ChatSettings L={(en, zh) => language === "en" ? en : zh}/>, chatTarget) : null}
      {visible && route.split("#")[1] === "advanced/browser" && browserTarget ? createPortal(<BrowserPanel settingsOnly L={(en,zh)=>language==="en"?en:zh}/>, browserTarget) : null}
      {error ? (
        <button
          className="configuration-retry"
          onClick={() => location.reload()}
        >
          {language === "en"
            ? "Couldn’t load this page. Reload"
            : "页面加载失败，重新加载"}
        </button>
      ) : null}
    </section>
  );
}
