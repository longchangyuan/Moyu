/* 摸鱼小狐 · 桌面小组件 */
(async function () {
  'use strict';
  const C = window.MoyuCore;
  const api = window.moyu;
  const $ = (s) => document.querySelector(s);
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

  const state = await api.getState();
  let work = state.work;
  const scene = new FoxScene($('#scene'));
  const widget = $('#widget');
  const el = { label: $('#wLabel'), time: $('#wTime'), earn: $('#wEarn'), bar: $('#wBar') };

  api.onWorkChanged((w) => { work = w; tick(); });

  /* 自定义背景：素材加载失败时自动回退到内置场景 */
  const M = window.MoyuMedia;
  let look = state.look;
  const media = new M.MediaLayer($('#media'), {
    onFrame: (snap) => widget.classList.toggle('custom', !!snap),
  });
  function applyLook() {
    const item = M.resolve(look, 'widget');
    if (!item) widget.classList.remove('custom');
    media.show(item, look);
  }
  api.look.onChanged((l) => { look = l; applyLook(); });
  applyLook();

  /* 专注状态小标签 */
  const fpill = $('#wFocus');
  const fmtShort = (s) => {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}分`;
  };
  api.focus.onLive((p) => {
    const st = p.live.state;
    const show = p.enabled && p.show.widget && !p.error && ['focus', 'slack', 'away', 'overtime'].includes(st);
    fpill.hidden = !show;
    if (!show) return;
    fpill.dataset.state = st;
    const label = { focus: '专注', overtime: '加班', slack: '摸鱼', away: '离开' }[st];
    const text = `${label}中 · 专注 ${fmtShort(p.focus + p.overtime)} · 摸鱼 ${fmtShort(p.slack)}`;
    if (fpill.lastChild.textContent !== text) fpill.lastChild.textContent = text;
  });

  /* 拖动：移动超过 3px 才算拖动，否则当作点击交给场景 */
  let down = null;
  let dragged = false;
  widget.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY };
    dragged = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!down || dragged) return;
    if (Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 3) {
      dragged = true;
      widget.classList.add('dragging');
      api.widget.dragStart();
    }
  });
  const endDrag = () => {
    if (dragged) api.widget.dragEnd();
    widget.classList.remove('dragging');
    down = null;
  };
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);
  widget.addEventListener('click', (e) => {
    if (dragged) {
      e.stopPropagation();
      e.preventDefault();
      dragged = false;
    }
  }, true);
  widget.addEventListener('dblclick', () => api.openMain());
  widget.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.widget.menu();
  });

  function tick() {
    const snap = C.snapshot(C.normalize(work), new Date());
    const d = C.describe(snap);
    setText(el.label, d.short);
    setText(el.time, d.big);
    el.time.classList.toggle('text', !/\d/.test(d.big));
    el.time.classList.toggle('long', d.big.length > 8);
    setText(el.earn, '¥' + C.formatMoney(snap.status === 'rest' ? 0 : snap.earned));
    const showBar = snap.status === 'working' || snap.status === 'lunch';
    el.bar.parentElement.classList.toggle('hidden', !showBar);
    el.bar.style.width = (snap.progress * 100).toFixed(2) + '%';
    scene.setStatus(snap.status);
    scene.setMood(snap.mood);
    scene.setPalette(snap.palette);
  }

  tick();
  setInterval(tick, 200);
})();
