import { setAccountDataOwner } from './accountSyncIdentity.js'
import { clearAccountLocalData, withAccountDataLock } from './accountLocalData.js'
import { clearStoredDataByPrefix } from './store/index.js'

export async function clearSignedOutAccountData() {
  return withAccountDataLock(async (assertLock) => {
    assertLock()
    await clearAccountLocalData()
    assertLock()
    await clearStoredDataByPrefix('sl_')
    assertLock()
    setAccountDataOwner('')
  })
}
