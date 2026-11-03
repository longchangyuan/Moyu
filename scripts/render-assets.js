/*
 * 生成应用图标与托盘图标（手绘 SVG → PNG / ICNS / ICO）
 * 用法：npm run assets   （需在 macOS 上运行，ICNS 依赖系统自带 iconutil）
 */
'use strict';
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const BUILD = path.join(ROOT, 'build');

/* 狐狸头（来自场景插画，坐标系与场景一致） */
const FOX_HEAD = `
  <path d="M352 176 L330 104 C348 112 372 132 388 160 Z" fill="#EE6A1F"/>
  <path d="M352 166 L340 122 C352 130 364 142 374 160 Z" fill="#4A2C24"/>
  <path d="M448 176 L470 104 C452 112 428 132 412 160 Z" fill="#EE6A1F"/>
  <path d="M448 166 L460 122 C448 130 436 142 426 160 Z" fill="#4A2C24"/>
  <path d="M336 206 C334 160 364 140 400 140 C436 140 466 160 464 206 C476 214 474 226 462 230 C446 254 424 262 400 262 C376 262 354 254 338 230 C326 226 324 214 336 206 Z" fill="url(#fur)"/>
  <path d="M340 216 C356 208 380 212 400 230 C420 212 444 208 460 216 C454 244 430 260 400 260 C370 260 346 244 340 216 Z" fill="#FFF6EA"/>
  <ellipse cx="358" cy="228" rx="11" ry="6" fill="#FF8A8A" opacity=".4"/>
  <ellipse cx="442" cy="228" rx="11" ry="6" fill="#FF8A8A" opacity=".4"/>
  <path d="M362 204 a13 11 0 0 0 26 0 z" fill="#2B1E1E"/>
  <path d="M360 203 h30" stroke="#B9501A" stroke-width="3.4" stroke-linecap="round"/>
  <circle cx="381" cy="207" r="2.2" fill="#fff"/>
  <path d="M412 204 a13 11 0 0 0 26 0 z" fill="#2B1E1E"/>
  <path d="M410 203 h30" stroke="#B9501A" stroke-width="3.4" stroke-linecap="round"/>
  <circle cx="431" cy="207" r="2.2" fill="#fff"/>
  <ellipse cx="400" cy="230" rx="7" ry="5" fill="#2B1E1E"/>
  <path d="M392 239 q4 4 8 0 q4 4 8 0" fill="none" stroke="#2B1E1E" stroke-width="2.6" stroke-linecap="round"/>`;

function appIconSvg(variant) {
  // mac：按 Big Sur 规范留白 + 投影；win：几乎铺满
  const box = variant === 'mac' ? { x: 100, y: 100, s: 824, r: 186 } : { x: 24, y: 24, s: 976, r: 210 };
  const cx = box.x + box.s / 2;
  const k = (box.s / 824) * 3.3;
  const tx = cx - 400 * k;
  const ty = box.y + box.s * 0.6 - 196 * k;
  const water = box.y + box.s * 0.66;
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5DB6EC"/><stop offset="1" stop-color="#CDEBFA"/></linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5DB3E0"/><stop offset="1" stop-color="#2A74B4"/></linearGradient>
    <linearGradient id="fur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9E4A"/><stop offset="1" stop-color="#EC661C"/></linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF9E0"/><stop offset=".6" stop-color="#FFF1B8" stop-opacity=".5"/><stop offset="1" stop-color="#FFF1B8" stop-opacity="0"/></radialGradient>
    <clipPath id="clip"><rect x="${box.x}" y="${box.y}" width="${box.s}" height="${box.s}" rx="${box.r}"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0A2A50" flood-opacity=".32"/></filter>
  </defs>
  <g filter="${variant === 'mac' ? 'url(#shadow)' : 'none'}">
    <rect x="${box.x}" y="${box.y}" width="${box.s}" height="${box.s}" rx="${box.r}" fill="url(#sky)"/>
  </g>
  <g clip-path="url(#clip)">
    <circle cx="${box.x + box.s * 0.78}" cy="${box.y + box.s * 0.2}" r="${box.s * 0.16}" fill="url(#sun)"/>
    <circle cx="${box.x + box.s * 0.78}" cy="${box.y + box.s * 0.2}" r="${box.s * 0.07}" fill="#FFF8DA"/>
    <path d="M${box.x} ${water - box.s * 0.05} Q${box.x + box.s * 0.25} ${water - box.s * 0.12} ${box.x + box.s * 0.5} ${water - box.s * 0.06} T${box.x + box.s} ${water - box.s * 0.07} V${water + 10} H${box.x}Z" fill="#78AE88"/>
    <rect x="${box.x}" y="${water}" width="${box.s}" height="${box.s}" fill="url(#lake)"/>
    <path d="M${box.x + box.s * 0.1} ${water + box.s * 0.12} h${box.s * 0.14} M${box.x + box.s * 0.7} ${water + box.s * 0.2} h${box.s * 0.18}" stroke="#fff" stroke-width="${box.s * 0.014}" stroke-linecap="round" opacity=".5"/>
    <g transform="translate(${tx} ${ty}) scale(${k})">${FOX_HEAD}</g>
  </g>
  <rect x="${box.x + 1}" y="${box.y + 1}" width="${box.s - 2}" height="${box.s - 2}" rx="${box.r - 1}" fill="none" stroke="#FFFFFF" stroke-opacity=".35" stroke-width="2"/>
</svg>`;
}

/* macOS 菜单栏模板图：纯黑 + 透明，系统自动适配深浅色 */
const TRAY_TEMPLATE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path fill="#000" fill-rule="evenodd" d="
    M4.8 14 L3.2 1.8 L12 8.2 C13.3 7.9 14.6 7.8 16 7.8 C17.4 7.8 18.7 7.9 20 8.2 L28.8 1.8 L27.2 14
    C29.4 15.6 29.4 18 27.8 19 C25.4 23.4 20.8 26.4 16 30 C11.2 26.4 6.6 23.4 4.2 19 C2.6 18 2.6 15.6 4.8 14 Z
    M9.2 15.6 h5.2 a2.6 2.2 0 0 1 -5.2 0 Z
    M17.6 15.6 h5.2 a2.6 2.2 0 0 1 -5.2 0 Z
    M14.6 21.4 h2.8 a1.4 1.1 0 0 1 -2.8 0 Z"/>
</svg>`;

/* ---------- 渲染 ---------- */
let win;
async function render(svg, size) {
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
  win.setContentSize(size, size);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 150));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const s = img.getSize();
  if (s.width !== size) img = img.resize({ width: size, height: size, quality: 'best' });
  return img;
}

/* ---------- ICO 编码：≤48px 用 32 位 BMP，更大尺寸用 PNG ---------- */
function bmpEntry(img) {
  const { width: w, height: h } = img.getSize();
  const bgra = img.toBitmap();
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(w, 4);
  header.writeInt32LE(h * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(w * h * 4, 20);
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = ((h - 1 - y) * w + x) * 4;
      const a = bgra[src + 3];
      const un = (c) => (a === 0 ? 0 : Math.min(255, Math.round((c * 255) / a)));
      pixels[dst] = un(bgra[src]);
      pixels[dst + 1] = un(bgra[src + 1]);
      pixels[dst + 2] = un(bgra[src + 2]);
      pixels[dst + 3] = a;
    }
  }
  const maskRow = Math.ceil(w / 32) * 4;
  const mask = Buffer.alloc(maskRow * h);
  return Buffer.concat([header, pixels, mask]);
}

function encodeIco(images) {
  const entries = images.map((img) => {
    const size = img.getSize().width;
    return { size, data: size <= 48 ? bmpEntry(img) : img.toPNG() };
  });
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.data)]);
}

async function main() {
  fs.mkdirSync(ASSETS, { recursive: true });
  fs.mkdirSync(BUILD, { recursive: true });
  win = new BrowserWindow({
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    width: 1024, height: 1024, useContentSize: true, enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });

  // macOS .icns
  const macSvg = appIconSvg('mac');
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'moyu-')) + '/icon.iconset';
  fs.mkdirSync(iconset);
  for (const s of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${s}x${s}.png`), (await render(macSvg, s)).toPNG());
    fs.writeFileSync(path.join(iconset, `icon_${s}x${s}@2x.png`), (await render(macSvg, s * 2)).toPNG());
  }
  const mac1024 = await render(macSvg, 1024);
  fs.writeFileSync(path.join(BUILD, 'icon.png'), mac1024.toPNG());
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')]);
  }

  // Windows .ico
  const winSvg = appIconSvg('win');
  const icoImages = [];
  for (const s of [16, 24, 32, 48, 64, 128, 256]) icoImages.push(await render(winSvg, s));
  const ico = encodeIco(icoImages);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), (await render(winSvg, 512)).toPNG());

  // 托盘
  fs.writeFileSync(path.join(ASSETS, 'trayTemplate.png'), (await render(TRAY_TEMPLATE_SVG, 16)).toPNG());
  fs.writeFileSync(path.join(ASSETS, 'trayTemplate@2x.png'), (await render(TRAY_TEMPLATE_SVG, 32)).toPNG());

  console.log('图标已生成：build/icon.icns, build/icon.ico, build/icon.png, assets/*');
}

app.whenReady().then(main).then(() => app.quit(), (e) => { console.error(e); app.exit(1); });
