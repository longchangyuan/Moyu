'use strict';
/*
 * 自定义背景素材库
 * - 导入：按文件头识别真实格式（不信任扩展名），内容哈希去重，复制到用户数据目录
 * - 缩略图：系统缩略图服务（macOS QuickLook / Windows Shell），失败时前端直接渲染素材
 * - 访问：通过 moyu-bg:// 协议只读访问素材目录，支持 Range（视频循环/拖动进度）
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { nativeImage } = require('electron');

const SCHEME = 'moyu-bg';
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_ITEMS = 60;
const THUMB = { width: 360, height: 240 };

const FORMATS = {
  png: { kind: 'image', mime: 'image/png', label: '图片' },
  jpg: { kind: 'image', mime: 'image/jpeg', label: '图片' },
  gif: { kind: 'image', mime: 'image/gif', label: 'GIF' },
  webp: { kind: 'image', mime: 'image/webp', label: '图片' },
  bmp: { kind: 'image', mime: 'image/bmp', label: '图片' },
  mp4: { kind: 'video', mime: 'video/mp4', label: '视频' },
  webm: { kind: 'video', mime: 'video/webm', label: '视频' },
  mov: { kind: 'video', mime: 'video/quicktime', label: '视频' },
};
const PICK_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'm4v', 'webm', 'mov'];
const NAME_RE = /^([a-f0-9]{16})(\.thumb\.png|\.(png|jpg|gif|webp|bmp|mp4|webm|mov))$/;

function sniff(head) {
  if (head.length < 12) return null;
  const ascii = (a, b) => head.toString('latin1', a, b);
  if (head[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(0, 2) === 'BM') return 'bmp';
  if (head.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^(avif|avis|heic|heix|hevc|mif1|msf1)/.test(brand)) return null;
    return brand === 'qt  ' ? 'mov' : 'mp4';
  }
  return null;
}

function isAnimated(ext, head) {
  if (ext === 'gif') return true;
  const s = head.toString('latin1');
  if (ext === 'png') return s.includes('acTL');
  if (ext === 'webp') return s.includes('ANIM');
  return false;
}

async function readHead(file, n) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex').slice(0, 16)));
  });
}

function displayName(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '').trim() || '未命名';
  return base.length > 40 ? base.slice(0, 40) + '…' : base;
}

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB';
}

class Backgrounds {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, name);
  }

  mediaFile(item) {
    return this.file(`${item.id}.${item.ext}`);
  }

  exists(item) {
    return !!item && FORMATS[item.ext] && fs.existsSync(this.mediaFile(item));
  }

  async import(src, library) {
    const name = path.basename(src);
    let st;
    try {
      st = await fsp.stat(src);
    } catch (e) {
      return { ok: false, name, error: '文件不存在或无法读取' };
    }
    if (!st.isFile()) return { ok: false, name, error: '不是文件' };
    if (st.size === 0) return { ok: false, name, error: '文件是空的' };
    if (st.size > MAX_BYTES) return { ok: false, name, error: `文件 ${formatSize(st.size)}，超过 ${MAX_BYTES / 1024 / 1024} MB 上限` };

    const head = await readHead(src, 64 * 1024);
    const ext = sniff(head);
    if (!ext) return { ok: false, name, error: '不支持的格式（支持 PNG/JPG/WebP/GIF/BMP/MP4/WebM/MOV）' };

    const id = await hashFile(src);
    const dup = library.find((x) => x.id === id);
    if (dup && this.exists(dup)) return { ok: true, duplicate: true, item: dup };
    if (library.length >= MAX_ITEMS) return { ok: false, name, error: `素材库最多 ${MAX_ITEMS} 个，请先删除一些` };

    const dest = this.file(`${id}.${ext}`);
    const tmp = dest + '.part';
    await fsp.copyFile(src, tmp);
    await fsp.rename(tmp, dest);

    const thumb = await this._thumbnail(dest, id, FORMATS[ext].kind);
    const item = {
      id,
      ext,
      kind: FORMATS[ext].kind,
      animated: FORMATS[ext].kind === 'video' || isAnimated(ext, head),
      name: displayName(src),
      size: st.size,
      thumb,
      addedAt: Date.now(),
    };
    return { ok: true, item };
  }

  /**
   * 只用真实解码生成缩略图（不用系统缩略图服务：遇到不认识的格式会返回“默认打开程序”的图标）。
   * 解码失败（如 Windows 上的 GIF/WebP、所有视频）时返回 false，前端直接显示素材本身的首帧。
   */
  async _thumbnail(file, id, kind) {
    if (kind !== 'image') return false;
    let img = null;
    try {
      const full = nativeImage.createFromPath(file);
      if (!full.isEmpty()) {
        const s = full.getSize();
        const k = Math.min(1, THUMB.width / s.width, THUMB.height / s.height);
        img = full.resize({ width: Math.max(1, Math.round(s.width * k)), quality: 'good' });
      }
    } catch (e) {
      img = null;
    }
    if (!img || img.isEmpty()) return false;
    try {
      await fsp.writeFile(this.file(`${id}.thumb.png`), img.toPNG());
      return true;
    } catch (e) {
      return false;
    }
  }

  async remove(item) {
    for (const name of [`${item.id}.${item.ext}`, `${item.id}.thumb.png`]) {
      try { await fsp.unlink(this.file(name)); } catch (e) { /* 已不存在 */ }
    }
  }

  /** moyu-bg://media/<id>.<ext> 或 moyu-bg://media/<id>.thumb.png */
  async handle(request) {
    let name;
    try {
      name = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    } catch (e) {
      return new Response('bad request', { status: 400 });
    }
    const m = NAME_RE.exec(name);
    if (!m) return new Response('not found', { status: 404 });
    const file = this.file(name);
    let st;
    try {
      st = await fsp.stat(file);
    } catch (e) {
      return new Response('not found', { status: 404 });
    }
    const mime = m[2] === '.thumb.png' ? 'image/png' : FORMATS[m[3]].mime;
    const headers = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    };
    const range = request.headers.get('range');
    if (range) {
      const r = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start;
      let end;
      if (r && r[1] !== '') {
        start = Number(r[1]);
        end = r[2] !== '' ? Math.min(Number(r[2]), st.size - 1) : st.size - 1;
      } else if (r && r[2] !== '') {
        start = Math.max(0, st.size - Number(r[2]));
        end = st.size - 1;
      }
      if (start === undefined || start > end || start >= st.size) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` } });
      }
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(st.size) },
    });
  }
}

module.exports = { Backgrounds, SCHEME, FORMATS, PICK_EXTENSIONS, MAX_BYTES, sniff };
