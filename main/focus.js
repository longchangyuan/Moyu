'use strict';
/*
 * 专注识别：判断当前是在用「工作软件」还是在摸鱼
 *
 * 只看【前台】软件（正在使用的那个窗口），后台运行的软件不计。
 * - macOS：轮询系统自带的 lsappinfo，无需任何系统权限
 * - Windows：常驻一个隐藏的 PowerShell 进程，通过 Win32 API 读取前台窗口所属程序，变化时输出一行 JSON
 * 键鼠长时间无操作或锁屏时，记为「离开」。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const KEEP_DAYS = 120;

const FOCUS_DEFAULTS = {
  enabled: false,
  apps: [], // [{ id, name }]  id：mac 为 bundle id，Windows 为小写 exe 文件名
  idleMinutes: 5, // 0 = 不判定离开
  countOvertime: false, // 下班后/休息日使用工作软件也计入专注
  showOnMain: true,
  showOnWidget: true,
  showInTray: true,
};

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeout || 3000, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

/* ---------------- macOS ---------------- */
class MacWatcher extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.current = null;
    this.failures = 0;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.failures = 0;
    this._poll();
    this.timer = setInterval(() => this._poll(), 1500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.current = null;
  }

  async _poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const asn = (await run('lsappinfo', ['front'])).trim();
      let app = null;
      if (asn) {
        const out = await run('lsappinfo', ['info', '-only', 'bundleid', '-only', 'name', '-only', 'bundlepath', asn]);
        const kv = {};
        out.replace(/"([^"]+)"="([^"]*)"/g, (_m, k, v) => { kv[k] = v; });
        const name = kv.LSDisplayName || (kv.LSBundlePath ? path.basename(kv.LSBundlePath, '.app') : '');
        const id = kv.CFBundleIdentifier || (name ? 'name:' + name : '');
        if (id) {
          app = {
            id,
            name: name || id,
            self: !!kv.LSBundlePath && process.execPath.startsWith(kv.LSBundlePath + '/'),
          };
        }
      }
      this.failures = 0;
      this._set(app);
    } catch (e) {
      if (++this.failures === 5) this.emit('error', '无法读取前台软件（lsappinfo 调用失败）');
    } finally {
      this.busy = false;
    }
  }

  _set(app) {
    if ((app && app.id) === (this.current && this.current.id)) {
      if (app) this.current = app;
      return;
    }
    this.current = app;
    this.emit('change', app);
  }
}

/* ---------------- Windows ---------------- */
const WIN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MoyuForeground {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static string Current() {
    IntPtr hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return "";
    uint pid;
    GetWindowThreadProcessId(hwnd, out pid);
    if (pid == 0) return "";
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return "?" + pid;
    try {
      StringBuilder sb = new StringBuilder(1024);
      uint size = (uint)sb.Capacity;
      return QueryFullProcessImageNameW(h, 0, sb, ref size) ? sb.ToString() : "?" + pid;
    } finally {
      CloseHandle(h);
    }
  }
}
'@
$ErrorActionPreference = 'SilentlyContinue'
$parentPid = __PARENT_PID__
$last = $null
$descCache = @{}
$n = 0
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $cur = [MoyuForeground]::Current()
  if ($cur -ne $last) {
    $last = $cur
    $desc = ''
    if ($cur -and -not $cur.StartsWith('?')) {
      if (-not $descCache.ContainsKey($cur)) {
        $text = ''
        try {
          $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($cur)
          if ($info.FileDescription) { $text = $info.FileDescription.Trim() }
        } catch {}
        $descCache[$cur] = $text
      }
      $desc = $descCache[$cur]
    }
    [Console]::Out.WriteLine((@{ path = $cur; desc = $desc } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  }
  $n++
  if ($n % 10 -eq 0) {
    if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { exit }
  }
  Start-Sleep -Milliseconds 1000
}
`;

class WinWatcher extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.current = null;
    this.running = false;
    this.restarts = [];
    this.stderr = '';
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.restarts = [];
    this._spawn();
  }

  stop() {
    this.running = false;
    this.current = null;
    if (this.child) {
      this.child.removeAllListeners('exit');
      try { this.child.kill(); } catch (e) { /* 已退出 */ }
      this.child = null;
    }
  }

  _spawn() {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = WIN_SCRIPT.replace('__PARENT_PID__', String(process.pid));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    this.stderr = '';
    let child;
    try {
      child = spawn(fs.existsSync(exe) ? exe : 'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.emit('error', '无法启动 PowerShell：' + e.message);
      return;
    }
    this.child = child;
    child.on('error', (e) => this.emit('error', '无法启动 PowerShell：' + e.message));
    child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-600); });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch (e) { return; }
      if (msg.ready) {
        this.emit('ready');
        return;
      }
      this._set(this._parse(msg));
    });
    child.on('exit', () => {
      this.child = null;
      if (!this.running) return;
      const now = Date.now();
      this.restarts = this.restarts.filter((t) => now - t < 10 * 60 * 1000);
      if (this.restarts.length >= 3) {
        this.running = false;
        const reason = this.stderr.replace(/\s+/g, ' ').trim().slice(0, 160);
        this.emit('error', '前台软件识别进程多次退出' + (reason ? '：' + reason : ''));
        return;
      }
      this.restarts.push(now);
      setTimeout(() => this.running && this._spawn(), 3000);
    });
  }

  _parse(msg) {
    const p = String(msg.path || '');
    if (!p) return null;
    if (p.startsWith('?')) return { id: 'unknown', name: '无法识别的程序（可能需要管理员权限）' };
    const file = p.split('\\').pop();
    return {
      id: file.toLowerCase(),
      name: (msg.desc || file.replace(/\.exe$/i, '')).slice(0, 60),
      self: p.toLowerCase() === process.execPath.toLowerCase(),
    };
  }

  _set(app) {
    if ((app && app.id) === (this.current && this.current.id)) return;
    this.current = app;
    this.emit('change', app);
  }
}

class NullWatcher extends EventEmitter {
  constructor() { super(); this.current = null; }
  start() { setTimeout(() => this.emit('error', '当前系统暂不支持识别前台软件'), 0); }
  stop() {}
}

function createWatcher() {
  if (IS_MAC) return new MacWatcher();
  if (IS_WIN) return new WinWatcher();
  return new NullWatcher();
}

/* ---------------- 手动选择软件 ---------------- */
async function describeAppFile(file) {
  if (IS_MAC) {
    const plist = path.join(file, 'Contents', 'Info.plist');
    const read = (key) => run('plutil', ['-extract', key, 'raw', '-o', '-', plist]).then((s) => s.trim(), () => '');
    const id = await read('CFBundleIdentifier');
    if (!id) throw new Error('这不是一个有效的应用程序');
    const name = (await read('CFBundleDisplayName')) || (await read('CFBundleName')) || path.basename(file, '.app');
    return { id, name };
  }
  const base = path.basename(file);
  if (!/\.exe$/i.test(base)) throw new Error('请选择 .exe 程序');
  return { id: base.toLowerCase(), name: base.replace(/\.exe$/i, '') };
}

/* ---------------- 统计 ---------------- */
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const emptyDay = () => ({ focus: 0, slack: 0, away: 0, overtime: 0, apps: {} });

class FocusTracker {
  constructor(file) {
    this.file = file;
    this.data = this._load();
    this.lastAt = 0;
    this.dirty = false;
    this.lastSave = Date.now();
    this.live = { state: 'off', app: null, isWork: false };
    this.seen = new Map(); // 本次运行中出现过的前台软件
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.days === 'object') return { days: raw.days };
    } catch (e) { /* 首次运行 */ }
    return { days: {} };
  }

  day(key) {
    if (!this.data.days[key]) this.data.days[key] = emptyDay();
    return this.data.days[key];
  }

  noteApp(app) {
    if (!app || app.self || app.id === 'unknown') return;
    this.seen.set(app.id, { id: app.id, name: app.name, at: Date.now() });
  }

  /**
   * 每秒调用一次。按距离上次采样的真实间隔累加（睡眠/卡顿超过 5 秒的间隔丢弃）。
   * @param {object} p { now, cfg, status, idleSeconds, locked, app, available }
   */
  sample(p) {
    const nowMs = p.now.getTime();
    const dt = this.lastAt ? (nowMs - this.lastAt) / 1000 : 0;
    this.lastAt = nowMs;
    const cfg = p.cfg;
    const app = p.app;
    const isWork = !!app && cfg.apps.some((a) => a.id === app.id);
    let state;
    if (!cfg.enabled) state = 'off';
    else if (!p.available) state = 'unavailable';
    else {
      const away = p.locked || (cfg.idleMinutes > 0 && p.idleSeconds >= cfg.idleMinutes * 60);
      if (p.status === 'working') state = away ? 'away' : isWork ? 'focus' : 'slack';
      else if (cfg.countOvertime && !away && isWork) state = 'overtime';
      else state = 'outside';
    }
    this.live = { state, app: app ? { id: app.id, name: app.name, self: !!app.self } : null, isWork };
    if (dt <= 0 || dt > 5 || !['focus', 'slack', 'away', 'overtime'].includes(state)) return this.live;

    const rec = this.day(dayKey(p.now));
    rec[state] += dt;
    if (state !== 'away' && app) {
      const a = rec.apps[app.id] || (rec.apps[app.id] = { name: app.name, secs: 0 });
      a.secs += dt;
      a.name = app.name;
      if (app.self) a.self = true;
    }
    this.dirty = true;
    if (nowMs - this.lastSave > 30000) this.flush();
    return this.live;
  }

  today(now, cfg) {
    const rec = this.data.days[dayKey(now)] || emptyDay();
    const work = new Set(cfg.apps.map((a) => a.id));
    const apps = Object.entries(rec.apps)
      .map(([id, a]) => ({ id, name: a.name, secs: a.secs, self: !!a.self, work: work.has(id) }))
      .sort((x, y) => y.secs - x.secs);
    return { focus: rec.focus, slack: rec.slack, away: rec.away, overtime: rec.overtime, apps };
  }

  /** 供「添加工作软件」使用：今天用过的 + 本次运行中出现过的 */
  recentApps(now, cfg) {
    const t = this.today(now, cfg).apps.filter((a) => !a.self && a.id !== 'unknown');
    const map = new Map(t.map((a) => [a.id, a]));
    const work = new Set(cfg.apps.map((a) => a.id));
    for (const s of [...this.seen.values()].sort((a, b) => b.at - a.at)) {
      if (!map.has(s.id)) map.set(s.id, { id: s.id, name: s.name, secs: 0, work: work.has(s.id) });
    }
    return [...map.values()].slice(0, 30);
  }

  history(now, days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const r = this.data.days[dayKey(d)] || emptyDay();
      out.push({ date: dayKey(d), focus: r.focus + r.overtime, slack: r.slack, away: r.away });
    }
    return out;
  }

  flush() {
    this.lastSave = Date.now();
    if (!this.dirty) return;
    this.dirty = false;
    const keys = Object.keys(this.data.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete this.data.days[k];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[focus] 保存统计失败', e);
    }
  }
}

module.exports = { FOCUS_DEFAULTS, createWatcher, describeAppFile, FocusTracker, dayKey };
