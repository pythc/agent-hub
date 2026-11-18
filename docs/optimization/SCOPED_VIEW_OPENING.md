# O32: workspace-bound current View opening

Artifact catalog View entries now open `/configure?workspace=…#artifact-view/:id` through the existing `WorkspaceTransportOwner`. The new route has no root-workspace fallback. It loads the selected workspace's package catalog and passes the same captured workspace binding and lifetime signal to the existing sandboxed View renderer. Bundle, runtime polling and frame-requested navigation revalidation use that binding. The legacy unscoped catalog poll is disabled on catalog and scoped View routes.

Invalidation closes the MessagePort, aborts pending reads and removes the iframe. Delayed bundle/runtime replies cannot repopulate it after invalidation or unmount. Package catalog failures/removal fail closed with a retry. Polling rechecks current metadata, and package digest changes restart the renderer. The existing digest-bound server package checks, capability gate, sandbox and CSP are unchanged.

Managed frame navigation allows only the existing closed configuration destinations and adds the captured workspace ID explicitly. Conversation/browser destinations are withheld because those surfaces are not workspace-bound by this slice. Standalone behavior is unchanged. The existing legacy `/configure#plugin/:id` route is not converted by this slice; use the catalog's new entry for managed-workspace opening.

This opens the current enabled package, not a historical View version or frozen runtime snapshot. No new capabilities, object grants, backend routes, storage migration or execution permissions are added.

## Evidence

Automated hook/message-channel tests cover scoped catalog, bundle, runtime and navigation reads; invalidation/unmount during requests; runtime revocation; retry; disabled legacy polling; managed-navigation restrictions and preserved standalone behavior. Existing real package/HTTP tests remain in the focused suite. Exact-head typecheck/build, full baseline comparison, remote CI/container, independent review and final Codex receipts are recorded in the PR. These simulations are not a real browser acceptance claim: visual/mobile/keyboard/reduced-motion and real IM are deferred.
