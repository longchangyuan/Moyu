/* 摸鱼小狐 · 自定义背景渲染层（图片 / GIF / 视频） */
(function (root) {
  'use strict';

  const mediaUrl = (item) => `moyu-bg://media/${item.id}.${item.ext}`;
  const thumbUrl = (item) => `moyu-bg://media/${item.id}.thumb.png`;

  /** 根据外观设置解析出某个位置（main / widget）实际使用的素材，null 表示内置小狐狸场景 */
  function resolve(look, target) {
    if (!look) return null;
    let id = look[target];
    if (target === 'widget' && id === 'same') id = look.main;
    if (!id || id === 'builtin') return null;
    return look.library.find((x) => x.id === id) || null;
  }

  function createMediaElement(item, opts) {
    let el;
    if (item.kind === 'video') {
      el = document.createElement('video');
      el.muted = true;
      el.defaultMuted = true;
      el.loop = true;
      el.autoplay = !opts.paused;
      el.playsInline = true;
      el.preload = opts.paused ? 'metadata' : 'auto';
      el.disablePictureInPicture = true;
    } else {
      el = document.createElement('img');
      el.decoding = 'async';
      el.draggable = false;
      el.alt = '';
    }
    el.crossOrigin = 'anonymous';
    el.src = mediaUrl(item) + (opts.paused && item.kind === 'video' ? '#t=0.1' : '');
    return el;
  }

  /** 取一帧画面缩小到小画布：用作模糊底图、完整显示时的边缘填充，并估算亮度 */
  function snapshot(el, w, h) {
    const sw = el.videoWidth || el.naturalWidth;
    const sh = el.videoHeight || el.naturalHeight;
    if (!sw || !sh) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const k = Math.max(w / sw, h / sh);
    const dw = sw * k;
    const dh = sh * k;
    ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    let luma = 0.5;
    try {
      const d = ctx.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      luma = sum / (d.length / 4) / 255;
    } catch (e) { /* 画布被污染时保持默认亮度 */ }
    return { canvas: c, luma };
  }

  class MediaLayer {
    /**
     * @param {HTMLElement} host
     * @param {{ onFrame?: Function, onError?: Function }} [hooks]
     */
    constructor(host, hooks) {
      this.host = host;
      this.hooks = hooks || {};
      this.key = '';
      this.item = null;
      this.el = null;
      this.frame = null;
      host.classList.add('media-layer');
      host.hidden = true;
      this._onVisibility = () => this._syncPlayback();
      document.addEventListener('visibilitychange', this._onVisibility);
    }

    show(item, look) {
      const fit = (look && look.fit) || 'cover';
      const dim = look ? look.dim : 0;
      this.host.dataset.fit = fit;
      this.host.style.setProperty('--dim', String((dim || 0) / 100));
      const key = item ? item.id : '';
      if (key === this.key) return;
      this.key = key;
      this.item = item;
      this._render();
    }

    _render() {
      const item = this.item;
      this.host.innerHTML = '';
      this.el = null;
      this.frame = null;
      this.host.hidden = !item;
      this.host.classList.remove('ready');
      if (!item) {
        if (this.hooks.onFrame) this.hooks.onFrame(null);
        return;
      }
      const fill = document.createElement('canvas');
      fill.className = 'media-fill';
      const el = createMediaElement(item, {});
      el.classList.add('media-main');
      const shade = document.createElement('div');
      shade.className = 'media-dim';
      this.host.append(fill, el, shade);
      this.el = el;

      const ready = () => {
        if (this.el !== el) return;
        this.host.classList.add('ready');
        const snap = snapshot(el, 96, 60);
        if (snap) {
          fill.width = snap.canvas.width;
          fill.height = snap.canvas.height;
          fill.getContext('2d').drawImage(snap.canvas, 0, 0);
          this.frame = snap;
        }
        if (this.hooks.onFrame) this.hooks.onFrame(snap);
      };
      const fail = () => {
        if (this.el !== el) return;
        this.host.hidden = true;
        if (this.hooks.onError) this.hooks.onError(item);
        if (this.hooks.onFrame) this.hooks.onFrame(null);
      };
      if (item.kind === 'video') {
        el.addEventListener('loadeddata', ready, { once: true });
        el.addEventListener('error', fail, { once: true });
        this._syncPlayback();
      } else {
        el.addEventListener('load', ready, { once: true });
        el.addEventListener('error', fail, { once: true });
      }
    }

    _syncPlayback() {
      const v = this.el;
      if (!v || v.tagName !== 'VIDEO') return;
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    }
  }

  root.MoyuMedia = { MediaLayer, resolve, mediaUrl, thumbUrl, createMediaElement, snapshot };
})(window);
