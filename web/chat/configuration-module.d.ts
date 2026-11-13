declare module "virtual:configuration-content" {
  export function mount(host: {
    element: HTMLElement;
    active: () => boolean;
    memory: () => HTMLElement;
  }): {
    activate: (language: string) => void;
    language: (language: string) => void;
    workspace: () => Promise<void>;
  };
}
