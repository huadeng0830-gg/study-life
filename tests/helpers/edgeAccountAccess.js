export * as accountRestrictionGuard from '../../supabase/functions/_shared/accountRestrictions.js'

// Existing domain tests model unrestricted accounts. Keep their business RPC
// fixtures/ordering intact while executing the real preflight module. Denial
// and live permission rechecks are tested by capacityBackend/RestrictionGuard.
export function withUnrestrictedAccount(client) {
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'rpc') return (name, ...args) => name === 'platform_account_access'
        ? Promise.resolve({ data: { allowed: true }, error: null }) : target.rpc(name, ...args)
      return Reflect.get(target, key, receiver)
    },
  })
}
