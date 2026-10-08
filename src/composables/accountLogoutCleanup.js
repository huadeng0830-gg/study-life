import { setAccountDataOwner } from './accountSyncIdentity.js'
import { clearAccountLocalData } from './accountLocalData.js'
import { clearStoredDataByPrefix } from './store/index.js'

export async function clearSignedOutAccountData() {
  setAccountDataOwner('')
  await Promise.all([clearAccountLocalData(), clearStoredDataByPrefix('sl_')])
}
