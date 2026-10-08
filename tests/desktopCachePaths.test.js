import { describe, expect, it } from 'vitest'

const { routeWindowsCachePaths } = require('../desktop-app/cachePaths.cjs')

describe('desktop updater cache paths', () => {
  it('stores update downloads and temporary files under the selected Windows install root', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', TEMP: 'C:\\Temp', TMP: 'C:\\Temp' }

    expect(routeWindowsCachePaths({
      updates: 'D:\\三两事\\updates',
      temp: 'D:\\三两事\\temp',
    }, env, true)).toBe(true)

    expect(env).toEqual({
      LOCALAPPDATA: 'D:\\三两事\\updates',
      TEMP: 'D:\\三两事\\temp',
      TMP: 'D:\\三两事\\temp',
    })
  })

  it('leaves non-Windows process paths unchanged', () => {
    const env = { LOCALAPPDATA: 'existing', TEMP: 'existing-temp', TMP: 'existing-temp' }

    expect(routeWindowsCachePaths({ updates: '/opt/app/updates', temp: '/opt/app/temp' }, env, false)).toBe(false)
    expect(env).toEqual({ LOCALAPPDATA: 'existing', TEMP: 'existing-temp', TMP: 'existing-temp' })
  })
})
