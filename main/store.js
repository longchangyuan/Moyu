'use strict';
const fs = require('fs');
const path = require('path');

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * 配置文件存储：按分区（work / app / look / meta …）保存。
 * - 读取时与默认值合并，缺失的新分区自动补齐（老版本配置可直接升级）。
 * - 不认识的分区原样保留（新版本写入的数据被旧版本打开后再升级也不会丢）。
 * - 写入采用“临时文件 + 重命名”，避免写到一半断电导致配置损坏。
 */
class Store {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.existed = fs.existsSync(file);
    this.data = this._read();
    this._timer = null;
  }

  _read() {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!isObj(raw)) raw = {};
    } catch (e) {
      if (this.existed) {
        try { fs.copyFileSync(this.file, this.file + '.broken'); } catch (_) { /* ignore */ }
      }
      raw = {};
    }
    const out = Object.assign({}, raw);
    for (const [key, def] of Object.entries(this.defaults)) {
      out[key] = Object.assign(clone(def), isObj(raw[key]) ? raw[key] : {});
    }
    return out;
  }

  get(section) {
    return this.data[section];
  }

  set(section, value) {
    this.data[section] = value;
    this._scheduleWrite();
  }

  patch(section, patch) {
    this.data[section] = Object.assign({}, this.data[section], patch);
    this._scheduleWrite();
    return this.data[section];
  }

  _scheduleWrite() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] 写入失败', e);
    }
  }
}

module.exports = Store;
