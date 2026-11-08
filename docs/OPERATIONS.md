# Running and maintaining Roppo

## Start the right instance

```sh
./start.sh
./start.sh setup /path/to/private-directory --no-open
./start.sh serve /path/to/config.json
```

The first command starts or reopens a personal installation in `~/.agent-hub`. The second selects a private installation directory. `serve` uses an existing configuration and does not open a browser. Keep the original configuration and state directory when returning to an existing deployment.

Older checkouts used a sample configuration for a bare `./start.sh`. That is no longer the default. To keep that deployment, explicitly run `./start.sh serve examples/config.json`; no automatic migration of its tasks is performed.

The launcher builds `dist/chat/`. When invoking TypeScript entry points directly, first run `npm run build:chat`. The local account authenticates browser access; CLI and MCP clients continue to use the host token. Do not share a management link as a public invitation.

For command options, run `./start.sh help`. Host diagnostics and reopening an account entry use:

```sh
./start.sh check /path/to/config.json
./start.sh open http://127.0.0.1:PORT /path/to/state/access-token --no-open
```

## Independent monitoring

For independent host and task monitoring, use `./start.sh supervise /path/to/config.json` after stopping the existing host. It runs separate host and Watchdog children. A separately managed `serve` process can use `./start.sh watchdog /path/to/config.json`, but that observer cannot restart a host it does not own. See [Watchdog operation, authority and recovery](WATCHDOG.md). Plain `setup`/`serve` does not start the independent observer.

## Before an upgrade

1. Record the current Git commit, Node version, configuration path, and state directory.
2. Stop or finish active work deliberately. Review uncertain external deliveries before retrying them.
3. Create and verify a backup. For a complete migration snapshot, stop the host and its supervisor before copying the rest of the private installation.
4. Check out the intended revision in a separate checkout, run `npm ci` and `npm run check`, and read its changes to persistent formats.
5. Restart with the same intended configuration. Verify login, task state, model connectivity, and any browser profiles you need.

Do not run two hosts against the same state directory. A database rollback cannot undo a Git push, a website change, a sent message, or changes to a working directory.

## Backups and restore

The database backup command snapshots committed SQLite state and managed configuration/credentials. Use a new, private destination each time:

```sh
./start.sh backup /path/to/config.json /path/to/new-backup
./start.sh verify-backup /path/to/new-backup
```

This is **not a complete personal installation backup**. Separately preserve, as applicable:

- `personal-account.json`, including remembered-session state;
- the `browser/` directory and its encryption key, including an externally configured key;
- subscription account credentials and external environment files;
- source working directories, task worktrees, and local artifacts;
- CLI authentication and any provider-specific files outside the installation.

These files contain secrets. Keep backups private and never attach them to a public issue. Website sessions may still expire or be tied to a device. Losing the password-vault key prevents recovery of saved passwords.

Stop the host and supervisor before restoring:

```sh
./start.sh restore /path/to/config.json /path/to/backup
```

Restore verifies the database format and checksum and preserves the previous database state before replacement. It does not restore files omitted from the backup or undo external effects. Use code compatible with the backup's schema; do not assume an arbitrary older checkout can read newer state. Restoring an old account file can also restore old remembered sessions; revoke them after recovery.

## Runtime and platform notes

macOS supports the standalone Seatbelt command sandbox; Linux uses Bubblewrap and needs a compatible host policy. There is no automatic fallback to unrestricted commands. See [Linux deployment and acceptance](LINUX.md). The systemd template in `deployment/` needs local review; it is not a one-command production deployment.

The host binds to loopback. Remote access, TLS, backups, and service supervision are deployment responsibilities. A personal local account is not a tenant isolation boundary. Windows browser and command-sandbox acceptance is not yet complete.

For help, open a [discussion](https://github.com/pythc/agent-hub/discussions) with redacted diagnostics rather than your state directory.
