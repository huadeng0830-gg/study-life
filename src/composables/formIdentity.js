import { assertAccountDataIdentity, captureAccountDataIdentity } from './accountSyncIdentity.js'

// A form belongs to the identity that opened it, including a guest/local owner.
// Recheck at the actual commit, including after conflict confirmation dialogs.
export function createFormIdentityGuard() {
  let generation = 0
  let currentSnapshot = null
  return {
    begin() {
      generation += 1
      currentSnapshot = Object.freeze({ generation, identity: captureAccountDataIdentity() })
      return currentSnapshot
    },
    assertCurrent(snapshot = currentSnapshot) {
      if (!snapshot || snapshot.generation !== generation) {
        throw new Error('表单已重新打开，之前的保存已取消。')
      }
      return assertAccountDataIdentity(snapshot.identity)
    },
  }
}
