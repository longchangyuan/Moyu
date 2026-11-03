'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listen = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('moyu', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveWork: (work) => ipcRenderer.invoke('work:save', work),
  setApp: (patch) => ipcRenderer.invoke('app:set', patch),
  onWorkChanged: listen('work:changed'),
  onAppChanged: listen('app:changed'),
  openMain: () => ipcRenderer.send('main:open'),
  openDataFolder: () => ipcRenderer.send('app:open-data'),
  ackUpdate: () => ipcRenderer.send('update:ack'),
  look: {
    pick: (target) => ipcRenderer.invoke('look:pick', target),
    importFiles: (files, target) => {
      const paths = Array.from(files || []).map((f) => webUtils.getPathForFile(f)).filter(Boolean);
      return ipcRenderer.invoke('look:import', paths, target);
    },
    remove: (id) => ipcRenderer.invoke('look:remove', id),
    set: (patch) => ipcRenderer.invoke('look:set', patch),
    onChanged: listen('look:changed'),
  },
  focus: {
    get: () => ipcRenderer.invoke('focus:get'),
    set: (patch) => ipcRenderer.invoke('focus:set', patch),
    add: (app) => ipcRenderer.invoke('focus:add', app),
    remove: (id) => ipcRenderer.invoke('focus:remove', id),
    pick: () => ipcRenderer.invoke('focus:pick'),
    onLive: listen('focus:live'),
    onConfig: listen('focus:config'),
  },
  widget: {
    dragStart: () => ipcRenderer.send('widget:drag-start'),
    dragEnd: () => ipcRenderer.send('widget:drag-end'),
    menu: () => ipcRenderer.send('widget:menu'),
  },
});
