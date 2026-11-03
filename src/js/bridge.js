/* 摸鱼小狐 · Tauri 桥接层：封装 window.__TAURI__ 为 window.moyu（接口对齐 main/preload.js） */
(function () {
  'use strict';

  if (window.__TAURI__ == null) {
    console.warn('[moyu] Tauri 运行时不可用');
    return;
  }

  const invoke = window.__TAURI__.core.invoke;
  const listenEvent = window.__TAURI__.event.listen;

  function listen(channel) {
    return function (cb) {
      let unlisten = null;
      let stopped = false;
      listenEvent(channel, (event) => {
        if (!stopped) cb(event.payload);
      }).then((fn) => {
        if (stopped) fn();
        else unlisten = fn;
      });
      return () => {
        stopped = true;
        if (unlisten) unlisten();
      };
    };
  }

  window.moyu = {
    getState: () => invoke('get_state'),
    saveWork: (work) => invoke('save_work', { work }),
    setApp: (patch) => invoke('set_app', { patch }),
    onWorkChanged: listen('work:changed'),
    onAppChanged: listen('app:changed'),
    openMain: () => invoke('open_main'),
    openDataFolder: () => invoke('open_data_folder'),
    ackUpdate: () => invoke('update_ack'),

    look: {
      pick: (target) => invoke('look_pick', { target }),
      importFiles: async (files, target) => {
        // WebView 沙箱拿不到文件路径，改为读字节传给后端（大文件会较慢）
        const arr = [];
        for (const f of Array.from(files || [])) {
          const buf = await f.arrayBuffer();
          arr.push({ name: f.name, bytes: Array.from(new Uint8Array(buf)) });
        }
        return invoke('look_import_files', { files: arr, target });
      },
      remove: (id) => invoke('look_remove', { id }),
      set: (patch) => invoke('look_set', { patch }),
      onChanged: listen('look:changed'),
    },

    focus: {
      get: () => invoke('focus_get'),
      set: (patch) => invoke('focus_set', { patch }),
      add: (app) => invoke('focus_add', { appItem: app }),
      remove: (id) => invoke('focus_remove', { id }),
      pick: () => invoke('focus_pick'),
      onLive: listen('focus:live'),
      onConfig: listen('focus:config'),
    },

    widget: {
      dragStart: () => {
        try {
          window.__TAURI__.window.getCurrentWindow().startDragging();
        } catch (e) {
          /* 忽略 */
        }
      },
      dragEnd: () => {},
      menu: () => {},
    },
  };
})();
