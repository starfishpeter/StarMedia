const { contextBridge, ipcRenderer, webUtils } = require('electron')
const { createPreloadBridge } = require('./preload-bridge.cjs')

contextBridge.exposeInMainWorld(
  'starMedia',
  createPreloadBridge({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    subscribe: (channel, listener) => {
      const handler = (_event, progress) => listener(progress)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    getPathForFile: (file) => webUtils.getPathForFile(file),
  }),
)
