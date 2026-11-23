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
