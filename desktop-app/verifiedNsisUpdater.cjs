'use strict'

const { spawn } = require('node:child_process')
const { createReadStream } = require('node:fs')
const { createHash } = require('node:crypto')
const path = require('node:path')

function installerError(code) { return Object.assign(new Error(code), { code }) }
async function hashInstaller(file, signal) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk)
  return hash.digest('base64')
}

// Kept deliberately small and tested against the pinned electron-updater 6.8.10.
// Download/provider/differential/signature logic remains in NsisUpdater. Its stock
// doInstall returns before spawn and can auto-elevate, so override only launch/quit.
function createVerifiedNsisUpdaterClass(NsisUpdater, { spawnInstaller = spawn, hashFile = hashInstaller } = {}) {
  return class VerifiedNsisUpdater extends NsisUpdater {
    quitAndInstall(isSilent = false, isForceRunAfter = false, options = {}) {
      if (this.installTask) return this.installTask
      if (this.quitAndInstallCalled) return Promise.resolve(false)
      const signal = options.signal
      let launched = false
      const assertActive = () => { if (signal?.aborted) throw installerError('ETIMEDOUT') }
      const run = async () => {
        assertActive()
        const helper = this.downloadedUpdateHelper
        const file = this.installerPath
        const info = helper?.downloadedFileInfo
        const expectedHash = helper?.fileInfo?.info?.sha512
        if (!file || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.exe' ||
          !info || !expectedHash || expectedHash !== info.sha512 || helper.packageFile ||
          (options.version && helper.versionInfo?.version !== options.version))
          throw installerError('ERR_UPDATER_INVALID_INSTALLER')
        if (info.isAdminRightsRequired) throw installerError('EACCES')
        if (await hashFile(file, signal) !== expectedHash) {
          await helper.clear()
          throw installerError('ERR_UPDATER_INVALID_SHA512')
        }
        assertActive()
        const config = await this.configOnDisk.value
        const publishers = (Array.isArray(config.publisherName) ? config.publisherName : [config.publisherName])
          .filter((name) => typeof name === 'string' && name.trim())
        if (!publishers.length) throw installerError('ERR_UPDATER_INVALID_SIGNATURE')
        const signatureError = await this.verifyUpdateCodeSignature(publishers, file)
        if (signatureError != null) {
          await helper.clear()
          throw installerError('ERR_UPDATER_INVALID_SIGNATURE')
        }
        assertActive()
        const args = ['--updated']
        if (isSilent) args.push('/S')
        if (isForceRunAfter) args.push('--force-run')
        if (this.installDirectory) args.push(`/D=${this.installDirectory}`)
        // No shell, openPath fallback or elevate.exe. Wait for the real spawn event.
        const child = spawnInstaller(file, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })
        await new Promise((resolve, reject) => {
          child.once('error', reject)
          child.once('spawn', resolve)
        })
        launched = true
        this.quitAndInstallCalled = true
        child.on('error', (error) => this.emit('error', error))
        child.once('exit', (code) => {
          if (code != null && code !== 0) this.emit('error', installerError('INSTALL_PROCESS_EXIT'))
        })
        child.unref()
        options.onStarted?.()
        this.app.quit()
        return true
      }
      this.installTask = run().catch((error) => {
        if (!launched) this.quitAndInstallCalled = false
        else error.installerStarted = true
        throw error
      }).finally(() => { this.installTask = null })
      return this.installTask
    }
  }
}

module.exports = { createVerifiedNsisUpdaterClass, hashInstaller }
