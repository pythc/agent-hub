# AgentHub entry management

The current product positioning is defined in [the root PRODUCT.md](../../PRODUCT.md): personal and organization workspaces have equal importance, with a Router managing Workers. This document retains the conversation-entry behavior and acceptance boundaries that still apply within each workspace.

AgentHub is a resident, general-purpose assistant connected to existing work software. It receives work from conversations or client tools and returns results there.

The configuration website serves two audiences. Ordinary users follow plain-text instructions shared in their existing team conversation to find the enabled bot or client; the local Web guide is optional. Operators manage connections and respond to work needing human input. The default experience must not require ordinary users to understand models, credentials, JSON or source identifiers.

Multiple entries can share one existing model service. Entry setup preserves existing deployments and exposes prerequisites for Feishu, WeCom, Codex, Cursor, VS Code, WorkBuddy, GitHub and other MCP clients. Some require administrator permissions or software installed on the host.

Success means a request and its reply have been observed in the selected software. Saving settings, adding a client configuration and generating a verification phrase are intermediate states.

This is a Web surface with English as the initial language and complete Chinese controls. Use the root DESIGN.md white/dark palette and retain the existing local font stacks. Host administration is local or accessed through a secure tunnel. The current invitation URL is a local usage guide, not a hosted public team portal.

The host owns authentication, settings revisions, external access and verification evidence. The UI presents those results and supports operator choices without inferring success from incomplete evidence.
