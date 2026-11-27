'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('odwd', {
  state: () => ipcRenderer.invoke('odwd:state'),
  dispatch: (action) => ipcRenderer.invoke('odwd:dispatch', action),
  onState: (callback) => { ipcRenderer.on('odwd:state', (event, state) => callback(state)); },
  onHotkey: (callback) => { ipcRenderer.on('odwd:hotkey', (event, key) => callback(key)); },
  home: () => ipcRenderer.send('odwd:home'),
  enter: () => ipcRenderer.send('odwd:enter'),
  showSite: (visible) => ipcRenderer.send('odwd:show-site', !!visible)
});
