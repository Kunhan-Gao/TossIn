const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = ['added', 'changed', 'level', 'update'];

contextBridge.exposeInMainWorld('yw', {
  init: () => ipcRenderer.invoke('init'),
  capture: () => ipcRenderer.invoke('capture'),
  addText: (text) => ipcRenderer.invoke('addText', text),
  addPaths: (paths) => ipcRenderer.invoke('addPaths', paths),
  addImageUrl: (url) => ipcRenderer.invoke('addImageUrl', url),
  update: (id, patch) => ipcRenderer.invoke('update', id, patch),
  remove: (id) => ipcRenderer.invoke('remove', id),
  trash: (ids) => ipcRenderer.invoke('trash', ids),
  untrash: () => ipcRenderer.invoke('untrash'),
  emptyTrash: () => ipcRenderer.invoke('emptyTrash'),
  copy: (id) => ipcRenderer.invoke('copy', id),
  copyMany: (ids) => ipcRenderer.invoke('copyMany', ids),
  peek: (what) => ipcRenderer.send('peek', what),
  open: (id) => ipcRenderer.invoke('open', id),
  drag: (id) => ipcRenderer.send('drag', id),
  win: (action) => ipcRenderer.invoke('win', action),
  setZoom: (z) => ipcRenderer.send('setZoom', z),
  setTheme: (name) => ipcRenderer.send('setTheme', name),
  openData: () => ipcRenderer.send('openData'),
  openAuthor: () => ipcRenderer.send('openAuthor'),
  openUpdate: () => ipcRenderer.send('openUpdate'),
  setLang: (lang) => ipcRenderer.send('setLang', lang),
  setHotkey: (which, accel) => ipcRenderer.invoke('setHotkey', which, accel),
  hotkeyRecording: (on) => ipcRenderer.send('hotkeyRecording', on),
  pathFor: (file) => webUtils.getPathForFile(file),
  on: (channel, fn) => {
    if (EVENTS.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
