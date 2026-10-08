'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function subscribeToUpdateState(listener) {
  if (typeof listener !== 'function') return () => {}
  const handleState = (_event, state) => listener(state)
  ipcRenderer.on('study-life:update-state', handleState)
  return () => ipcRenderer.removeListener('study-life:update-state', handleState)
}

contextBridge.exposeInMainWorld('studyLifeDesktop', Object.freeze({
  isDesktop: true,
  getUpdateState: () => ipcRenderer.invoke('study-life:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('study-life:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('study-life:update-download'),
  installUpdate: () => ipcRenderer.invoke('study-life:update-install'),
  onUpdateState: subscribeToUpdateState,
}))
