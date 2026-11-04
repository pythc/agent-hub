import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Repositories, Trigger, TriggerDisposition, Thread, Ticket, Decision, OutboundMessage } from './vendor/dsh-core/index.ts'

export interface Job { id: string; kind: string; payload: unknown; state: string; attempts: number; nextAt: number }
export interface Delivery extends OutboundMessage { status: string; attempts: number; nextAt: number; error?: string }
export interface Run {
  ticketId: string; assignmentId: string; threadId?: string; cwd: string
  phase: 'idle' | 'starting' | 'running' | 'background' | 'interrupted' | 'uncertain' | 'human' | 'delivering' | 'merging'
  turnId?: string; prepared?:boolean; waitingForWriter?:boolean; error?: string; result?: string
  toolsVersion?:number;toolsDigest?:string;model?:string;backendId?:string;backendKind?:string
}

/** All engine mutations and the work they schedule share one SQLite transaction. */
export class Store implements Repositories {
  readonly db: DatabaseSync
  private depth = 0
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    chmodSync(path, 0o600)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000')
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
    if (version > 5) {
      this.db.close()
      throw new Error('Database is newer than this program. Use the matching version.')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, body TEXT NOT NULL);
      PRAGMA user_version=5;
    `)
  }
  atomic<T>(work: () => T): T {
    const level = this.depth
    const savepoint = 'nested_' + level
    this.db.exec(level ? 'SAVEPOINT ' + savepoint : 'BEGIN IMMEDIATE')
    this.depth++
    try {
      const value = work()
      this.db.exec(level ? 'RELEASE ' + savepoint : 'COMMIT')
      return value
    } catch (error) {
      this.db.exec(level ? 'ROLLBACK TO ' + savepoint : 'ROLLBACK')
      if (level) this.db.exec('RELEASE ' + savepoint)
      throw error
    } finally { this.depth-- }
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id)
    return row ? JSON.parse(String(row.body)) as T : undefined
  }
  prunePages(){this.db.prepare("DELETE FROM records WHERE kind='resource-page' AND id IN (SELECT id FROM records WHERE kind='resource-page' AND CAST(json_extract(body,'$.expires') AS INTEGER)<? LIMIT 1000)").run(Date.now())}
  put(kind: string, id: string, value: unknown): void {
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body')
      .run(kind, id, JSON.stringify(value))
  }
  list<T>(kind: string): T[] {
    return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(String(row.body)) as T)
  }
  readonly triggers = {
    get: (id: string) => this.get<Trigger>('trigger', id),
    save: (value: Trigger) => this.put('trigger', value.id, value),
    disposition: (id: string) => this.get<TriggerDisposition>('disposition', id),
    saveDisposition: (id: string, value: TriggerDisposition) => this.put('disposition', id, value),
  }
  readonly threads = {
    get: (id: string) => this.get<Thread>('thread', id),
    save: (value: Thread) => this.put('thread', value.key, value),
    list: () => this.list<Thread>('thread'),
    active: () => this.threads.list().filter(t => t.pending.length || t.evaluating),
  }
  readonly tickets = {
    get: (id: string) => this.get<Ticket>('ticket', id),
    save: (value: Ticket) => this.put('ticket', value.id, value),
    list: () => this.list<Ticket>('ticket').reverse(),
    open: () => this.tickets.list().filter(t => !t.ended),
    active: () => this.tickets.list().filter(t => t.undelivered.length || t.assignments.some(a => a.state !== 'ended')),
  }
  readonly decisions = {
    get: (id: string) => this.get<Decision>('decision', id),
    save: (value: Decision) => this.put('decision', value.id, value),
    byThread: (id: string) => this.list<Decision>('decision').filter(d => d.threadKey === id),
  }
  enqueue(id: string, kind: string, payload: unknown): void {
    this.db.prepare('INSERT OR IGNORE INTO jobs(id,kind,payload) VALUES(?,?,?)').run(id, kind, JSON.stringify(payload))
  }
  jobs(): Job[] {
    return this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND next_at<=? ORDER BY rowid").all(Date.now())
      .map(r => ({ id: String(r.id), kind: String(r.kind), payload: JSON.parse(String(r.payload)), state: String(r.state), attempts: Number(r.attempts), nextAt: Number(r.next_at) }))
  }
  jobState(id: string, state: string, error?: string): void {
    this.db.prepare('UPDATE jobs SET state=?,error=? WHERE id=?').run(state, error ?? null, id)
  }
  recoverJobs(): void {
    this.db.prepare("UPDATE jobs SET state=CASE WHEN kind='execute' THEN 'uncertain' ELSE 'pending' END WHERE state='running'").run()
  }
  recoverDeliveries():void {this.db.prepare("UPDATE outbox SET status='uncertain',error='Host stopped during delivery; reconcile destination before retry' WHERE status='sending'").run()}
  deliveryStarted(id:string):boolean{return this.db.prepare("UPDATE outbox SET status='sending' WHERE id=? AND status='pending'").run(id).changes===1}
  readonly outbox = {
    send: (message: OutboundMessage) => { this.db.prepare('INSERT OR IGNORE INTO outbox(id,body) VALUES(?,?)').run(message.id, JSON.stringify(message)) },
    status: (id: string) => {
      const r = this.db.prepare('SELECT status FROM outbox WHERE id=?').get(id)
      return r?.status === 'sent' ? 'sent' as const : r?.status === 'dropped' ? 'dropped' as const : r ? 'pending' as const : undefined
    },
    withdraw: (id: string) => { this.db.prepare("UPDATE outbox SET status='dropped' WHERE id=? AND status='pending'").run(id) },
  }
  deliveries(): Delivery[] {
    return this.db.prepare('SELECT * FROM outbox ORDER BY rowid').all().map(r => ({
      ...JSON.parse(String(r.body)), status: String(r.status), attempts: Number(r.attempts), nextAt: Number(r.next_at),
      ...(r.error ? { error: String(r.error) } : {}),
    }))
  }
  retryDelivery(id:string):void { this.db.prepare("UPDATE outbox SET status='pending',next_at=0 WHERE id=? AND status IN ('uncertain','pending')").run(id) }
  delivered(id: string): void { this.db.prepare("UPDATE outbox SET status='sent',error=NULL WHERE id=?").run(id) }
  deliveryFailed(id: string, attempts: number, error: string, uncertain = false): void {
    this.db.prepare('UPDATE outbox SET status=?,attempts=?,next_at=?,error=? WHERE id=?')
      .run(uncertain ? 'uncertain' : 'pending', attempts, Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(attempts, 9)), error, id)
  }
  audit(body: unknown): void { this.db.prepare('INSERT INTO audit(at,body) VALUES(?,?)').run(new Date().toISOString(), JSON.stringify(body)) }
  close(): void { this.db.close() }
}
