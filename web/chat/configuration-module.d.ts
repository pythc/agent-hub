declare module "virtual:configuration-content" {
  export function mount(host: {
    element: HTMLElement;
    active: () => boolean;
    memory: () => HTMLElement;
    chat: () => HTMLElement;
    browser: () => HTMLElement;
  }): {
    transport: import('./workspace-transport.ts').WorkspaceTransport;
    activate: (language: string) => void;
    language: (language: string) => void;
    workspace: () => Promise<void>;
  };
}
