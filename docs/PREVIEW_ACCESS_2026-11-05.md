# Preview access recovery — 2026-11-05

The browser's actual error was an expired or already consumed management link. `/configure` was serving the full application with GET 200; this was not an observed 404. An earlier request to open a temporary management link had been queued, so successful link creation was insufficient evidence of a usable preview.

Recovery used the existing private connection file to establish the ordinary same-origin HttpOnly operator session. In the actual in-app browser, reloading then opening Execution succeeded: Router and two independently configured Workers displayed their saved native Codex models. The working tab was retained as the preview. No work task or model-provider request was submitted during this recovery.

A separate HTTP defect was found and fixed: unauthenticated HEAD requests to public pages and `/health` previously fell through to operator authentication and returned 401. They now match their GET status/type/security headers and return no body. Private API routes still require authorization. No evidence established that HEAD preflight caused this particular browser failure; it is a separate compatibility fix.

TypeScript and 347 macOS tests passed. The new regression checks `/`, `/configure`, its trailing-slash/query variants and `/health`, with protected API probes remaining unauthorized. The idle local host was backed up and verified before graceful update; all ten existing work records were retained.

Use the stable `/configure` URL after establishing the session. Temporary pairing links expire after ten minutes and are consumed once. An operator session survives page reload for up to twelve hours while that host process remains running; restarting the host requires signing in again. Connection files and pairing links remain private.
