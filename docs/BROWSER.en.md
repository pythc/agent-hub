# Roppo Embedded Browser

[English](BROWSER.en.md) · [简体中文](BROWSER.md)

The browser lives on the right side of the session and shares the tab panel with **Files** and **Team activity**. The button in the top-right corner collapses or reopens the panel; the left side no longer has a separate browser entry. The Router keeps handling communication and dispatch, and Workers operate their own browsers through host tools; no second model planning loop is introduced.

## Usage

1. Create a browser profile and sign in to websites manually inside it, or save an account from the key button and choose **Fill**. After filling, you or the Worker confirm the submission; CAPTCHAs and two-factor authentication can be completed by a human.
2. In the browser profile settings, choose which Workers may reuse these saved logins. Every Worker can use a blank, isolated browser by default; personal login profiles must be authorized separately.
3. Submit web tasks to the Router. The browser tabs show only the current session's personal browser and Worker instances, where you can watch the live screen, the page tabs, and the control state.
4. Click **Take over** and the host completes the control handover. When you are done, click **Return to Worker**; the Worker receives a continuation input and must take a new page snapshot. A different window must click **Transfer control to this window** to replace the original operator.

Supported input covers mouse clicks, scrolling, text/paste/IME, common keys, and select-all. Press F6 in the remote input area to return to the address bar; Escape operates the remote page, while Escape inside the account dialog only closes the dialog. Light and dark themes, expanded panels, and narrow viewports are supported; the page itself has no outer scrolling.

## Persistence and isolation

Browser profiles and saved accounts remain selectable inside their own session, but a personal profile that is currently in use can be bound to only one session; to use it in another session, create a separate profile or close the original instance first. Worker login copying still follows the authorization you granted.

A personal browser uses its own Chrome profile and keeps persistent website cookies, site storage, and tab URLs/current tabs across sessions. It reopens after a normal close and after a host restart. Each Worker receives a different browser process session and writable directory per assignment/subagent; they do not share the personal profile and cannot operate tabs belonging to another assignment.

When reusing a personal login, Roppo first exports the authorized profile and then copies only the cookies and origin storage that match the target URLs into the task browser. Later changes made by the Worker are not written back to the personal profile. When several browsers use the same website account, the business data on the website's server still belongs to that one account; local browser isolation cannot remove write conflicts at the website's business layer. Tasks of this kind should be serialized by the Router, or use different website accounts.

Commands inside one session run serially. A manual takeover first blocks subsequent Worker commands and then waits for commands that already started to finish; stale control generations, stale snapshots, and stale tab references are rejected. After a manual-control lease expires the browser stays paused, and Worker write operations do not resume automatically. When a task ends its task browsers are reclaimed; a browser handed over to a human is kept for inspection and can no longer be operated by the old task. Background idle instances are reclaimed according to configuration. Only browsers that are actively being watched open a screen stream.

`superagent_browser` is the actual tool shared by the API backend and native Codex Workers. It provides the `profiles`, `open`, `navigate`, `snapshot`, `click`, `fill`, `press`, `scroll`, tab, `login`, `request_takeover`, and `close` operations. Element operations must carry the revision of the most recent snapshot, and tabs are addressed by stable IDs such as `t1`. A repeated `requestId` is not executed again, and unconfirmed write operations after a timeout or host interruption are not replayed automatically.

## Passwords and installation

Saved accounts are provided by Roppo's local credential vault and do not depend on Chrome's password-save popup. Passwords are encrypted with AES-256-GCM, and the key file is readable and writable only by the host user; a key environment variable can be specified instead. Tools only receive a `credentialId`, and the password is passed to the browser through standard input, so it never appears in command-line arguments, ordinary log tables, or tool receipts; known saved passwords are filtered out of page snapshots returned to the model. Passwords are not imported from your everyday Chrome password library, and no cloud sync is offered.

Deleting a saved account removes only the password record; it does not sign the website session out. To end a website session, use the website's own logout inside the corresponding browser.

The runtime depends on the pinned `agent-browser 0.27.0`. On macOS the installed Google Chrome is used by default; on other hosts you can point `browser.executablePath` at a compatible executable, or install the Chrome the tool uses:

```sh
npm ci
npx agent-browser install
npm run build:chat
```

Top-level configuration example (the rest of the configuration keeps its original values):

```json
{
  "browser": {
    "enabled": true,
    "maxSessions": 8,
    "timeoutMs": 20000,
    "idleMs": 900000
  }
}
```

`maxSessions` counts both personal and task browsers. `browser.command` can select a compatible engine executable, and `browser.keyEnv` can name an environment variable that holds the 64-hex-digit key. Do not replace or drop the key directly on an existing vault.

The tools page in a Worker's configuration can turn off browser access and set a tab limit; this maps to `browser: {enabled, maxTabs}` for each `execution.workers[]` entry. These settings follow the existing task-configuration rules, and authorization of a personal profile is rechecked on every call.

Browser data lives under `<stateDir>/browser`. The existing database backup command does not include the whole Chrome profile: when migrating or backing up, stop the host and save the database, this directory, and the external key together. Restoring only the database does not restore logins, and a lost key cannot be used to recover saved passwords. Website session lifetime, cross-site SSO, device binding, and two-factor authentication remain decided by each website; permanent logins or unconditional migration across machines are not promised.

Current acceptance covers macOS with local Chrome. Linux/Windows, arbitrary external websites, Chrome extensions, downloads/file pickers, system Passkeys, and complex cross-site login flows are not counted as passing items. See the [acceptance record](BROWSER_ACCEPTANCE_2026-11-07.md) and the [open-source licenses](THIRD_PARTY_BROWSER.md).
