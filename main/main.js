'use strict';
const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, screen, shell, protocol, dialog, powerMonitor,
} = require('electron');
const Core = require('../src/js/core.js');
const Store = require('./store.js');
const { Backgrounds, SCHEME, PICK_EXTENSIONS } = require('./backgrounds.js');
const CHANGELOG = require('./changelog.js');
const Focus = require('./focus.js');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const APP_NAME = '摸鱼小狐';
const ROOT = path.join(__dirname, '..');
const APP_VERSION = require('../package.json').version;
const asset = (...p) => path.join(ROOT, 'assets', ...p);
const page = (name) => path.join(ROOT, 'src', name);

const WIDGET_BASE = { width: 240, height: 240 };
const WIDGET_SCALES = [
  { label: '小', value: 0.8 },
  { label: '中', value: 1 },
  { label: '大', value: 1.25 },
  { label: '特大', value: 1.5 },
];

const APP_DEFAULTS = {
  autoLaunch: false,
  widgetVisible: true,
  widgetOnTop: true,
  widgetScale: 1,
  widgetBounds: null,
  trayCountdown: true,
  notify: true,
  closeTipShown: false,
};

const LOOK_DEFAULTS = {
  library: [],
  main: 'builtin', // 'builtin' | 素材 id
  widget: 'same', // 'same' 跟随主界面 | 'builtin' | 素材 id
  fit: 'cover', // cover 铺满 | contain 完整显示
  dim: 15, // 遮罩暗度 0-70
};

function compareVersion(a, b) {
  const pa = String(a || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

app.setName(APP_NAME);
if (IS_WIN) app.setAppUserModelId('com.moyufox.desktop');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  let store;
  let mainWin = null;
  let widgetWin = null;
  let tray = null;
  let quitting = false;
  let drag = null;
  let lastStatus = null;
  let warnedTenMin = '';
  let lastTrayText = '';
  let backgrounds;
  let updateInfo = null;
  let tracker;
  let watcher = null;
  let watcherError = '';
  let focusLive = { state: 'off', app: null, isWork: false };
  let lastFocusPayload = '';

  const work = () => Core.normalize(store.get('work'));
  const prefs = () => store.get('app');

  const startHidden = () =>
    process.argv.includes('--hidden') ||
    (IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin);

  /* ---------------- 窗口 ---------------- */
  function webPrefs() {
    return {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    };
  }

  function createMainWindow(show) {
    mainWin = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 980,
      minHeight: 640,
      show: false,
      title: APP_NAME,
      backgroundColor: '#DCEFFB',
      titleBarStyle: 'hidden',
      ...(IS_MAC
        ? { trafficLightPosition: { x: 18, y: 18 } }
        : { titleBarOverlay: { color: '#00000000', symbolColor: '#2B3A55', height: 40 } }),
      icon: IS_MAC ? undefined : asset('icon.png'),
      webPreferences: webPrefs(),
    });
    mainWin.loadFile(page('index.html'));
    mainWin.once('ready-to-show', () => show && mainWin.show());

    mainWin.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      mainWin.hide();
      if (!prefs().closeTipShown) {
        store.patch('app', { closeTipShown: true });
        notify(`${APP_NAME}仍在后台运行`, IS_MAC ? '可在菜单栏图标里重新打开或退出' : '可在右下角托盘图标里重新打开或退出');
      }
    });
    mainWin.on('closed', () => { mainWin = null; });
    guardNavigation(mainWin);
  }

  function showMain() {
    if (!mainWin) createMainWindow(true);
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }

  function widgetSize() {
    const s = prefs().widgetScale || 1;
    return { width: Math.round(WIDGET_BASE.width * s), height: Math.round(WIDGET_BASE.height * s) };
  }

  function widgetPosition(size) {
    const b = prefs().widgetBounds;
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
      const visible = screen.getAllDisplays().some((d) => {
        const wa = d.workArea;
        return b.x + 40 < wa.x + wa.width && b.x + size.width - 40 > wa.x &&
          b.y + 20 < wa.y + wa.height && b.y + size.height - 40 > wa.y;
      });
      if (visible) return { x: b.x, y: b.y };
    }
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: wa.x + wa.width - size.width - 24, y: wa.y + 24 };
  }

  function createWidget() {
    const size = widgetSize();
    const pos = widgetPosition(size);
    widgetWin = new BrowserWindow({
      ...size,
      ...pos,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: !!prefs().widgetOnTop,
      title: `${APP_NAME} · 小组件`,
      backgroundColor: '#00000000',
      webPreferences: webPrefs(),
    });
    if (IS_MAC) widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    applyWidgetTop();
    widgetWin.loadFile(page('widget.html'));
    widgetWin.webContents.on('did-finish-load', () => {
      widgetWin.webContents.setZoomFactor(prefs().widgetScale || 1);
    });
    widgetWin.once('ready-to-show', () => widgetWin.showInactive());
    widgetWin.on('closed', () => { widgetWin = null; });
    guardNavigation(widgetWin);
  }

  function applyWidgetTop() {
    if (!widgetWin) return;
    const top = !!prefs().widgetOnTop;
    widgetWin.setAlwaysOnTop(top, top ? 'floating' : 'normal');
  }

  function setWidgetVisible(v) {
    store.patch('app', { widgetVisible: v });
    if (v) {
      if (!widgetWin) createWidget();
      else widgetWin.showInactive();
    } else if (widgetWin) {
      widgetWin.close();
    }
    broadcastApp();
  }

  function setWidgetScale(scale) {
    store.patch('app', { widgetScale: scale });
    if (!widgetWin) return;
    const size = widgetSize();
    const [x, y] = widgetWin.getPosition();
    widgetWin.setBounds({ x, y, ...size });
    widgetWin.webContents.setZoomFactor(scale);
    broadcastApp();
  }

  function guardNavigation(win) {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
  }

  /* ---------------- 偏好 ---------------- */
  function applyAutoLaunch(on) {
    if (!app.isPackaged) return;
    try {
      app.setLoginItemSettings(IS_WIN ? { openAtLogin: on, args: ['--hidden'] } : { openAtLogin: on });
    } catch (e) {
      console.error('[autoLaunch]', e);
    }
  }

  function setAppPrefs(patch) {
    const allowed = ['autoLaunch', 'widgetVisible', 'widgetOnTop', 'widgetScale', 'trayCountdown', 'notify'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ('widgetVisible' in clean) {
      setWidgetVisible(!!clean.widgetVisible);
      delete clean.widgetVisible;
    }
    if ('widgetScale' in clean) {
      const v = Number(clean.widgetScale);
      if (WIDGET_SCALES.some((s) => s.value === v)) setWidgetScale(v);
      delete clean.widgetScale;
    }
    if (Object.keys(clean).length) {
      store.patch('app', clean);
      if ('autoLaunch' in clean) applyAutoLaunch(!!clean.autoLaunch);
      if ('widgetOnTop' in clean) applyWidgetTop();
      if ('trayCountdown' in clean) { lastTrayText = ''; tick(); }
      broadcastApp();
    }
    return publicPrefs();
  }

  function publicPrefs() {
    const p = Object.assign({}, prefs());
    delete p.widgetBounds;
    delete p.closeTipShown;
    if (app.isPackaged) p.autoLaunch = app.getLoginItemSettings().openAtLogin;
    return p;
  }

  function broadcast(channel, payload) {
    for (const w of [mainWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
  const broadcastApp = () => broadcast('app:changed', publicPrefs());

  /* ---------------- 外观：自定义背景 ---------------- */
  function normalizeLook(raw) {
    const l = Object.assign({}, LOOK_DEFAULTS, raw || {});
    const seen = new Set();
    l.library = (Array.isArray(l.library) ? l.library : []).filter((it) => {
      if (!it || typeof it.id !== 'string' || seen.has(it.id) || !backgrounds.exists(it)) return false;
      seen.add(it.id);
      return true;
    });
    const has = (id) => l.library.some((x) => x.id === id);
    if (l.main !== 'builtin' && !has(l.main)) l.main = 'builtin';
    if (l.widget !== 'same' && l.widget !== 'builtin' && !has(l.widget)) l.widget = 'same';
    if (!['cover', 'contain'].includes(l.fit)) l.fit = 'cover';
    l.dim = Math.min(70, Math.max(0, Math.round(Number(l.dim) || 0)));
    return l;
  }

  const look = () => store.get('look');

  function commitLook(next) {
    const n = normalizeLook(next);
    store.set('look', n);
    broadcast('look:changed', n);
    return n;
  }

  async function importBackgrounds(paths, target) {
    const results = [];
    let lib = look().library.slice();
    for (const p of (paths || []).slice(0, 30)) {
      if (typeof p !== 'string' || !p) continue;
      try {
        const r = await backgrounds.import(p, lib);
        if (r.ok && !r.duplicate) lib = [r.item, ...lib];
        results.push(r);
      } catch (e) {
        results.push({ ok: false, name: path.basename(p), error: '导入失败：' + e.message });
      }
    }
    const next = Object.assign({}, look(), { library: lib });
    const first = results.find((r) => r.ok);
    if (first && (target === 'main' || target === 'widget')) next[target] = first.item.id;
    const saved = commitLook(next);
    return {
      look: saved,
      added: results.filter((r) => r.ok && !r.duplicate).map((r) => r.item.name),
      duplicates: results.filter((r) => r.duplicate).map((r) => r.item.name),
      errors: results.filter((r) => !r.ok).map((r) => ({ name: r.name, error: r.error })),
    };
  }

  async function pickBackgrounds(target) {
    const res = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
      title: '选择背景（图片 / GIF 动图 / 视频）',
      buttonLabel: '添加',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片、GIF 动图、视频', extensions: PICK_EXTENSIONS },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return { look: look(), added: [], duplicates: [], errors: [], canceled: true };
    return importBackgrounds(res.filePaths, target);
  }

  async function removeBackground(id) {
    const cur = look();
    const item = cur.library.find((x) => x.id === id);
    if (!item) return cur;
    const next = Object.assign({}, cur, { library: cur.library.filter((x) => x.id !== id) });
    const saved = commitLook(next);
    await backgrounds.remove(item);
    return saved;
  }

  function setLook(patch) {
    const allowed = ['main', 'widget', 'fit', 'dim'];
    const next = Object.assign({}, look());
    for (const k of allowed) if (patch && k in patch) next[k] = patch[k];
    return commitLook(next);
  }

  /* ---------------- 版本：升级 / 降级检测 ---------------- */
  function checkVersion() {
    const cur = APP_VERSION;
    const meta = store.get('meta');
    const prev = meta.version || (store.existed ? '1.0.0' : null);
    const cmp = prev ? compareVersion(cur, prev) : 0;
    if (prev && cmp > 0) {
      updateInfo = {
        from: prev,
        to: cur,
        notes: CHANGELOG.filter((c) => compareVersion(c.version, prev) > 0 && compareVersion(c.version, cur) <= 0),
      };
    }
    store.set('meta', {
      version: cur,
      previousVersion: prev && cmp !== 0 ? prev : meta.previousVersion || null,
      installedAt: meta.installedAt || Date.now(),
      updatedAt: cmp !== 0 ? Date.now() : meta.updatedAt || null,
    });
    if (prev && cmp < 0) {
      app.whenReady().then(() => dialog.showMessageBox({
        type: 'warning',
        title: APP_NAME,
        message: `当前是旧版本 v${cur}`,
        detail: `你之前使用的是 v${prev}。设置会继续保留，但新版本里的部分功能在这个版本中不可用。建议安装最新版本。`,
        buttons: ['知道了'],
      }));
    }
    if (updateInfo) {
      setTimeout(() => notify(`已更新到 v${cur}`, '设置和背景都已保留，打开主界面查看更新内容'), 2500);
    }
  }

  /* ---------------- 专注识别 ---------------- */
  const focusCfg = () => store.get('focus');

  function normalizeFocus(raw) {
    const c = Object.assign({}, Focus.FOCUS_DEFAULTS, raw || {});
    const seen = new Set();
    c.apps = (Array.isArray(c.apps) ? c.apps : []).filter((a) => {
      if (!a || typeof a.id !== 'string' || !a.id || seen.has(a.id)) return false;
      seen.add(a.id);
      a.name = String(a.name || a.id).slice(0, 60);
      return true;
    }).map((a) => ({ id: a.id, name: a.name }));
    c.idleMinutes = [0, 2, 5, 10, 15, 30].includes(Number(c.idleMinutes)) ? Number(c.idleMinutes) : 5;
    for (const k of ['enabled', 'countOvertime', 'showOnMain', 'showOnWidget', 'showInTray']) c[k] = !!c[k];
    return c;
  }

  function startWatcher() {
    if (watcher) return;
    watcherError = '';
    watcher = Focus.createWatcher();
    watcher.on('change', (a) => tracker.noteApp(a));
    watcher.on('ready', () => { watcherError = ''; });
    watcher.on('error', (msg) => {
      watcherError = msg;
      console.warn('[focus]', msg);
    });
    watcher.start();
  }

  function stopWatcher() {
    if (!watcher) return;
    watcher.removeAllListeners();
    watcher.stop();
    watcher = null;
  }

  function applyFocusEnabled() {
    if (focusCfg().enabled) startWatcher();
    else stopWatcher();
  }

  function setFocusCfg(patch) {
    const allowed = ['enabled', 'idleMinutes', 'countOvertime', 'showOnMain', 'showOnWidget', 'showInTray', 'apps'];
    const next = Object.assign({}, focusCfg());
    for (const k of allowed) if (patch && k in patch) next[k] = patch[k];
    store.set('focus', normalizeFocus(next));
    applyFocusEnabled();
    lastFocusPayload = '';
    broadcast('focus:config', focusCfg());
    return focusCfg();
  }

  function addWorkApp(app) {
    if (!app || !app.id) return focusCfg();
    const apps = focusCfg().apps.filter((a) => a.id !== app.id);
    apps.push({ id: app.id, name: app.name || app.id });
    return setFocusCfg({ apps });
  }

  function removeWorkApp(id) {
    return setFocusCfg({ apps: focusCfg().apps.filter((a) => a.id !== id) });
  }

  async function pickWorkApp() {
    const res = await dialog.showOpenDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
      title: '选择工作软件',
      buttonLabel: '添加',
      defaultPath: IS_MAC ? '/Applications' : process.env.ProgramFiles || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: IS_MAC ? [{ name: '应用程序', extensions: ['app'] }] : [{ name: '程序', extensions: ['exe'] }],
    });
    if (res.canceled) return { cfg: focusCfg(), added: [], errors: [] };
    const added = [];
    const errors = [];
    for (const f of res.filePaths) {
      try {
        const a = await Focus.describeAppFile(f);
        addWorkApp(a);
        added.push(a.name);
      } catch (e) {
        errors.push(`${path.basename(f)}：${e.message}`);
      }
    }
    return { cfg: focusCfg(), added, errors };
  }

  function focusSummary(now) {
    const cfg = focusCfg();
    return {
      cfg,
      live: focusLive,
      error: cfg.enabled ? watcherError : '',
      today: tracker.today(now, cfg),
      recent: tracker.recentApps(now, cfg),
      history: tracker.history(now, 7),
      platform: process.platform,
    };
  }

  function sampleFocus(now, snap) {
    const cfg = focusCfg();
    let idleSeconds = 0;
    let locked = false;
    if (cfg.enabled) {
      try {
        idleSeconds = powerMonitor.getSystemIdleTime();
        locked = powerMonitor.getSystemIdleState(60) === 'locked';
      } catch (e) { /* 部分系统不支持时按未空闲处理 */ }
    }
    focusLive = tracker.sample({
      now,
      cfg,
      status: snap.status,
      idleSeconds,
      locked,
      app: watcher ? watcher.current : null,
      available: !!watcher && !watcherError,
    });
    const t = tracker.today(now, cfg);
    const payload = {
      live: focusLive,
      show: { main: cfg.showOnMain, widget: cfg.showOnWidget },
      enabled: cfg.enabled,
      focus: t.focus,
      slack: t.slack,
      away: t.away,
      overtime: t.overtime,
      error: cfg.enabled ? watcherError : '',
    };
    const key = JSON.stringify(payload, (k, v) => (typeof v === 'number' ? Math.floor(v) : v));
    if (key !== lastFocusPayload) {
      lastFocusPayload = key;
      broadcast('focus:live', payload);
    }
  }

  function focusTrayLine() {
    const cfg = focusCfg();
    if (!cfg.enabled || !cfg.showInTray) return null;
    const t = tracker.today(new Date(), cfg);
    const fmt = (s) => Core.formatDuration(s).replace(/ /g, '');
    return `今日专注 ${fmt(t.focus + t.overtime)} · 摸鱼 ${fmt(t.slack)}`;
  }

  /* ---------------- 托盘 ---------------- */
  function trayIcon() {
    if (IS_MAC) {
      const img = nativeImage.createFromPath(asset('trayTemplate.png'));
      img.setTemplateImage(true);
      return img;
    }
    return nativeImage.createFromPath(asset(IS_WIN ? 'icon.ico' : 'icon.png'));
  }

  function statusLine() {
    const snap = Core.snapshot(work(), new Date());
    const d = Core.describe(snap);
    const earned = snap.status === 'rest' ? '' : ` · 今日 ¥${Core.formatMoney(snap.earned)}`;
    if (snap.status === 'off' || snap.status === 'invalid') return `${d.title}${earned}`;
    return `${d.short} ${d.big}${earned}`;
  }

  function buildTrayMenu() {
    const p = prefs();
    const items = [
      { label: statusLine(), enabled: false },
    ];
    const fl = focusTrayLine();
    if (fl) items.push({ label: fl, enabled: false });
    items.push(
      { type: 'separator' },
      { label: '打开主界面', click: showMain },
      { label: '显示桌面小组件', type: 'checkbox', checked: !!p.widgetVisible, click: (m) => setAppPrefs({ widgetVisible: m.checked }) },
      { label: '小组件置顶', type: 'checkbox', checked: !!p.widgetOnTop, click: (m) => setAppPrefs({ widgetOnTop: m.checked }) },
    );
    if (IS_MAC) {
      items.push({ label: '菜单栏显示倒计时', type: 'checkbox', checked: !!p.trayCountdown, click: (m) => setAppPrefs({ trayCountdown: m.checked }) });
    }
    items.push(
      { label: '识别工作 / 摸鱼', type: 'checkbox', checked: !!focusCfg().enabled, click: (m) => setFocusCfg({ enabled: m.checked }) },
      { label: '下班提醒', type: 'checkbox', checked: !!p.notify, click: (m) => setAppPrefs({ notify: m.checked }) },
      { label: '开机自启', type: 'checkbox', checked: !!publicPrefs().autoLaunch, enabled: app.isPackaged, click: (m) => setAppPrefs({ autoLaunch: m.checked }) },
      { type: 'separator' },
      { label: `退出${APP_NAME}`, click: quit },
    );
    return Menu.buildFromTemplate(items);
  }

  function createTray() {
    tray = new Tray(trayIcon());
    tray.setToolTip(APP_NAME);
    const popup = () => tray.popUpContextMenu(buildTrayMenu());
    if (IS_MAC) {
      tray.on('click', popup);
      tray.on('right-click', popup);
    } else {
      tray.on('click', showMain);
      tray.on('right-click', popup);
    }
  }

  /* ---------------- 每秒心跳：托盘文字 + 提醒 ---------------- */
  function tick() {
    const now = new Date();
    const snap = Core.snapshot(work(), now);
    const d = Core.describe(snap);
    if (tray) {
      const text = IS_MAC && prefs().trayCountdown ? ' ' + d.tray : '';
      if (text !== lastTrayText) {
        lastTrayText = text;
        if (IS_MAC) tray.setTitle(text, { fontType: 'monospacedDigit' });
      }
      if (!IS_MAC) {
        const fl = focusTrayLine();
        tray.setToolTip(`${APP_NAME}\n${statusLine()}${fl ? '\n' + fl : ''}`.slice(0, 127));
      }
    }
    sampleFocus(now, snap);
    if (prefs().notify && lastStatus) {
      if ((lastStatus === 'working' || lastStatus === 'lunch') && snap.status === 'off') {
        notify('下班啦！', `今日已赚 ¥${Core.formatMoney(snap.daily)}，辛苦啦，快去钓鱼吧~`);
      }
      const dayKey = Core.dateKey(now);
      if (snap.status === 'working' && snap.countdown <= 600 && snap.countdown > 590 && warnedTenMin !== dayKey) {
        warnedTenMin = dayKey;
        notify('还有 10 分钟下班', '收拾收拾，准备溜了~');
      }
      if (lastStatus === 'before' && snap.status === 'working') {
        notify('开始上班啦', '今天也要元气满满地摸鱼哦');
      }
    }
    lastStatus = snap.status;
  }

  function startTicker() {
    tick();
    const align = 1000 - (Date.now() % 1000) + 5;
    setTimeout(() => {
      tick();
      setInterval(tick, 1000);
    }, align);
  }

  function notify(title, body) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, silent: false, icon: IS_MAC ? undefined : asset('icon.png') });
    n.on('click', showMain);
    n.show();
  }

  /* ---------------- 应用菜单（mac 需要编辑菜单以支持复制粘贴） ---------------- */
  function setupAppMenu() {
    if (!IS_MAC) {
      Menu.setApplicationMenu(null);
      return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `关于${APP_NAME}` },
          { type: 'separator' },
          { label: '打开主界面', accelerator: 'Cmd+1', click: showMain },
          { label: '显示/隐藏小组件', accelerator: 'Cmd+2', click: () => setAppPrefs({ widgetVisible: !prefs().widgetVisible }) },
          { type: 'separator' },
          { role: 'hide', label: `隐藏${APP_NAME}` },
          { role: 'hideOthers', label: '隐藏其他' },
          { type: 'separator' },
          { label: `退出${APP_NAME}`, accelerator: 'Cmd+Q', click: quit },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
          { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { label: '关闭窗口', accelerator: 'Cmd+W', click: () => BrowserWindow.getFocusedWindow()?.close() },
        ],
      },
    ]));
  }

  function quit() {
    quitting = true;
    app.quit();
  }

  /* ---------------- IPC ---------------- */
  function setupIpc() {
    ipcMain.handle('state:get', () => ({
      work: work(),
      app: publicPrefs(),
      look: look(),
      platform: process.platform,
      version: APP_VERSION,
      packaged: app.isPackaged,
      changelog: CHANGELOG,
      updateInfo,
    }));
    ipcMain.on('update:ack', () => { updateInfo = null; });
    ipcMain.on('app:open-data', () => shell.openPath(app.getPath('userData')));

    ipcMain.handle('look:pick', (_e, target) => pickBackgrounds(target));
    ipcMain.handle('look:import', (_e, paths, target) => importBackgrounds(paths, target));
    ipcMain.handle('look:remove', (_e, id) => removeBackground(id));
    ipcMain.handle('look:set', (_e, patch) => setLook(patch));

    ipcMain.handle('focus:get', () => focusSummary(new Date()));
    ipcMain.handle('focus:set', (_e, patch) => setFocusCfg(patch));
    ipcMain.handle('focus:add', (_e, a) => addWorkApp(a && { id: String(a.id), name: String(a.name || a.id) }));
    ipcMain.handle('focus:remove', (_e, id) => removeWorkApp(String(id)));
    ipcMain.handle('focus:pick', () => pickWorkApp());

    ipcMain.handle('work:save', (_e, input) => {
      const normalized = Core.normalize(input);
      const errors = Core.validate(normalized);
      if (errors.length) return { ok: false, errors };
      store.set('work', normalized);
      lastStatus = null;
      broadcast('work:changed', normalized);
      tick();
      return { ok: true, work: normalized };
    });

    ipcMain.handle('app:set', (_e, patch) => setAppPrefs(patch || {}));
    ipcMain.on('main:open', showMain);

    ipcMain.on('widget:drag-start', () => {
      if (!widgetWin) return;
      const cursor = screen.getCursorScreenPoint();
      const [wx, wy] = widgetWin.getPosition();
      const size = widgetWin.getSize();
      clearInterval(drag?.timer);
      drag = {
        dx: cursor.x - wx,
        dy: cursor.y - wy,
        timer: setInterval(() => {
          if (!widgetWin) return endDrag();
          const c = screen.getCursorScreenPoint();
          widgetWin.setBounds({ x: c.x - drag.dx, y: c.y - drag.dy, width: size[0], height: size[1] });
        }, 1000 / 60),
      };
    });
    ipcMain.on('widget:drag-end', endDrag);

    ipcMain.on('widget:menu', () => {
      if (!widgetWin) return;
      const p = prefs();
      Menu.buildFromTemplate([
        { label: '打开主界面', click: showMain },
        { type: 'separator' },
        { label: '置顶显示', type: 'checkbox', checked: !!p.widgetOnTop, click: (m) => setAppPrefs({ widgetOnTop: m.checked }) },
        {
          label: '大小',
          submenu: WIDGET_SCALES.map((s) => ({
            label: s.label, type: 'radio', checked: (p.widgetScale || 1) === s.value, click: () => setAppPrefs({ widgetScale: s.value }),
          })),
        },
        { label: '回到默认位置', click: resetWidgetPosition },
        { type: 'separator' },
        { label: '隐藏小组件', click: () => setAppPrefs({ widgetVisible: false }) },
        { label: `退出${APP_NAME}`, click: quit },
      ]).popup({ window: widgetWin });
    });
  }

  function endDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    drag = null;
    if (widgetWin) {
      const [x, y] = widgetWin.getPosition();
      store.patch('app', { widgetBounds: { x, y } });
    }
  }

  function resetWidgetPosition() {
    store.patch('app', { widgetBounds: null });
    if (!widgetWin) return;
    const size = widgetSize();
    widgetWin.setBounds({ ...widgetPosition(size), ...size });
  }

  /* ---------------- 启动 ---------------- */
  app.on('second-instance', showMain);
  app.on('activate', showMain);
  app.on('before-quit', () => {
    quitting = true;
    endDrag();
    stopWatcher();
    tracker?.flush();
    store?.flush();
  });
  app.on('window-all-closed', () => {
    /* 常驻托盘，不随窗口关闭退出 */
  });

  app.whenReady().then(() => {
    store = new Store(path.join(app.getPath('userData'), 'config.json'), {
      work: Core.normalize(null),
      app: APP_DEFAULTS,
      look: LOOK_DEFAULTS,
      focus: Focus.FOCUS_DEFAULTS,
      meta: {},
    });
    backgrounds = new Backgrounds(path.join(app.getPath('userData'), 'backgrounds'));
    protocol.handle(SCHEME, (req) => backgrounds.handle(req));
    store.set('look', normalizeLook(store.get('look')));
    store.set('focus', normalizeFocus(store.get('focus')));
    tracker = new Focus.FocusTracker(path.join(app.getPath('userData'), 'focus-stats.json'));
    applyFocusEnabled();
    powerMonitor.on('suspend', () => tracker.flush());
    checkVersion();
    if (IS_MAC) {
      app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: APP_VERSION, copyright: '带薪摸鱼，快乐加倍' });
    }
    setupAppMenu();
    setupIpc();
    createTray();
    createMainWindow(!startHidden());
    if (prefs().widgetVisible) createWidget();
    screen.on('display-removed', resetWidgetIfOffscreen);
    screen.on('display-metrics-changed', resetWidgetIfOffscreen);
    startTicker();
  });

  function resetWidgetIfOffscreen() {
    if (!widgetWin) return;
    const size = widgetSize();
    const [x, y] = widgetWin.getPosition();
    const pos = (() => {
      const saved = prefs().widgetBounds;
      store.data.app.widgetBounds = { x, y };
      const p = widgetPosition(size);
      store.data.app.widgetBounds = saved;
      return p;
    })();
    if (pos.x !== x || pos.y !== y) widgetWin.setBounds({ ...pos, ...size });
  }
}
