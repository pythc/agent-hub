/** Process-local authority, not a credential or a bearer token. Never serialize a handle. */
type Scope = {
 sourceId: string
 account: string
 purpose: 'authentication' | 'capabilities'
 target?: string
 revision: number
}
type Lease = {scope: Scope; expiresAt: number; stillCurrent: () => boolean}
export class ConnectorCredentialHandles {
 private readonly leases = new WeakMap<object,Lease>()
 constructor(private readonly now: () => number = Date.now){}
 issue(scope: Scope, ttlMs: number, stillCurrent: () => boolean): object {
  const handle = Object.freeze(Object.create(null)) as object
  this.leases.set(handle, {scope:{...scope}, expiresAt:this.now()+Math.min(20_000,Math.max(1,ttlMs)), stillCurrent})
  return handle
 }
 allows(handle: object, scope: Scope): boolean {
  const lease=this.leases.get(handle)
  if(!lease||this.now()>=lease.expiresAt)return false
  const expected=lease.scope
  return expected.sourceId===scope.sourceId&&expected.account===scope.account&&expected.purpose===scope.purpose&&
   expected.target===scope.target&&expected.revision===scope.revision&&lease.stillCurrent()
 }
 revoke(handle: object){this.leases.delete(handle)}
}
