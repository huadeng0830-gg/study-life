'use strict'

function routeWindowsCachePaths(paths, env = process.env, isWindows = process.platform === 'win32') {
  if (!isWindows) return false
  if (!paths?.updates || !paths?.temp) throw new TypeError('Windows cache paths must include updates and temp directories')

  // electron-updater uses LOCALAPPDATA as its cache root, while several
  // download helpers use TEMP/TMP. Keep both inside the user's chosen install root.
  env.LOCALAPPDATA = paths.updates
  env.TEMP = paths.temp
  env.TMP = paths.temp
  return true
}

module.exports = { routeWindowsCachePaths }
