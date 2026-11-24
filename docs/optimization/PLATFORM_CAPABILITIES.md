# O15: platform capabilities and authorization
The existing connector snapshot shows local switches for receiving events,
replying, reading history, and reading files. History and files currently share
the host resource master switch; neither derives permission from the other.
A switch being on is never provider verification or authorization to act.
Scope counts include active entries that match the source's own scope gates,
current owning management scope, and tenant; the group-history subset reflects
only explicitly marked non-private groups, not evidence of per-task access.
Legacy or absent evidence does not imply wildcard access.

MCP entries remain in their separate tool registry and still require the
existing Worker and task authorization. No credential details, actual scope
IDs, new grants, provider calls, or permission changes are introduced. Access
remains decided by the existing operation at execution time. Separate admin
toggles for history and files and task-dispatch explanations are not included.

Feishu, Slack and WeCom connections with the existing source resource capability can independently allow or block history and file reads in the Connections panel. The host revision and explicit operation are checked separately for each change. Legacy configurations keep their previous access. These controls only narrow (or restore the configured baseline of) local access; they never grant platform scopes, widen the task boundary, or change receiving, replies or MCP. A current admitted message is still readable when history is blocked; the model's previously received text and files already copied elsewhere are not recalled. Existing host attachment handles are rechecked on access; legacy handles without provable provenance are withheld when a connected platform's file access is revoked.

The assignment preview reports the source's local switches and selected MCP connections separately. It does not claim that the provider is reachable, scopes are sufficient, or a specific operation has been authorized.
