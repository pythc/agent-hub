import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { BrowserError, type CredentialMeta } from "./browser-contract.ts";

/** Secrets never enter the general records table or tool receipts. */
export class BrowserVault {
  private key: Buffer;
  private file: string;
  private entries: Record<string, { meta: CredentialMeta; sealed: string }> =
    {};
  constructor(directory: string, keyEnv?: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, "credentials.json");
    const path = join(directory, "vault.key");
    if (keyEnv) {
      const key = process.env[keyEnv];
      if (!key || !/^[a-f0-9]{64}$/i.test(key))
        throw new BrowserError(
          "browser_key_missing",
          "Browser vault key must contain 64 hex characters.",
        );
      this.key = Buffer.from(key, "hex");
    } else {
      if (!existsSync(path)) {
        if (existsSync(this.file))
          throw new BrowserError(
            "browser_key_missing",
            "Restore the original browser vault key before opening saved accounts.",
          );
        writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
      }
      if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0)
        throw new BrowserError(
          "browser_key_permissions",
          "Browser vault key must be private to the host user.",
        );
      this.key = readFileSync(path);
      if (this.key.length !== 32)
        throw new BrowserError(
          "browser_key_invalid",
          "Browser vault key is invalid.",
        );
    }
    if (existsSync(this.file)) {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      if (data.version !== 1 || !data.entries)
        throw new BrowserError(
          "browser_vault_invalid",
          "Browser vault could not be read.",
        );
      this.entries = data.entries;
      // Detect a replaced key before allowing writes that would mix encryption keys.
      for (const entry of Object.values(this.entries)) this.read(entry.meta.owner, entry.meta.id);
    }
  }
  list(owner: string) {
    return Object.values(this.entries)
      .filter((v) => v.meta.owner === owner)
      .map((v) => ({ ...v.meta }));
  }
  save(
    owner: string,
    input: Omit<CredentialMeta, "id" | "owner" | "updatedAt"> & {
      password: string;
    },
    id: string = randomUUID(),
  ) {
    const previous = this.entries[id];
    if (previous && previous.meta.owner !== owner)
      throw new BrowserError(
        "account_missing",
        "Saved account not found.",
        404,
      );
    const { password, ...fields } = input,
      meta: CredentialMeta = { ...fields, id, owner, updatedAt: Date.now() };
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(meta)));
    const encrypted = Buffer.concat([
      cipher.update(password, "utf8"),
      cipher.final(),
    ]);
    const entry = {
      meta,
      sealed: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        "base64",
      ),
    };
    this.persist({ ...this.entries, [id]: entry });
    return meta;
  }
  read(owner: string, id: string) {
    const entry = this.entries[id];
    if (!entry || entry.meta.owner !== owner)
      throw new BrowserError(
        "account_missing",
        "Saved account not found.",
        404,
      );
    try {
      const bytes = Buffer.from(entry.sealed, "base64"),
        decipher = createDecipheriv(
          "aes-256-gcm",
          this.key,
          bytes.subarray(0, 12),
        );
      decipher.setAuthTag(bytes.subarray(12, 28));
      decipher.setAAD(Buffer.from(JSON.stringify(entry.meta)));
      return {
        ...entry.meta,
        password: Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      };
    } catch {
      throw new BrowserError(
        "browser_key_invalid",
        "Saved account cannot be decrypted with this key.",
      );
    }
  }
  remove(owner: string, id: string) {
    this.read(owner, id);
    const next = { ...this.entries };
    delete next[id];
    this.persist(next);
  }
  private persist(entries: typeof this.entries) {
    const temporary = this.file + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, JSON.stringify({ version: 1, entries }), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, this.file);
    this.entries = entries;
  }
}
