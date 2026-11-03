/* 摸鱼小狐 · 主界面逻辑 */
(async function () {
  'use strict';
  const C = window.MoyuCore;
  const api = window.moyu;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const canon = (w) => JSON.stringify(C.normalize(w));

  const state = await api.getState();
  document.body.classList.add(state.platform);

  let saved = state.work;
  let draft = clone(saved);
  let prefs = state.app;
  let showErrors = false;

  const scene = new FoxScene($('#scene'));
  const bgScene = new FoxScene($('#bgScene'), { static: true });

  /* ================= 设置表单 ================= */
  const form = $('#form');
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function segValue(seg, value) {
    $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.value === String(value)));
  }

  function thisWeekType() {
    return C.isDoubleRestWeek(new Date(), C.normalize(draft)) ? 'double' : 'single';
  }

  function renderWeekdays() {
    const box = $('#weekdays');
    box.innerHTML = '';
    WEEK_ORDER.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = C.WEEK_NAMES[d].slice(1);
      b.title = (draft.customRestDays || []).includes(d) ? '休息日（点击改为工作日）' : '工作日（点击改为休息日）';
      b.classList.toggle('on', (draft.customRestDays || []).includes(d));
      b.addEventListener('click', () => {
        const set = new Set(draft.customRestDays || []);
        set.has(d) ? set.delete(d) : set.add(d);
        draft.customRestDays = [...set].sort();
        renderWeekdays();
        onDraftChange();
      });
      box.appendChild(b);
    });
  }

  function renderSpecial() {
    const list = $('#specialList');
    list.innerHTML = '';
    const today = C.dateKey(new Date());
    Object.keys(draft.specialDates || {}).sort().forEach((k) => {
      const type = draft.specialDates[k];
      const d = C.parseDateKey(k);
      const li = document.createElement('li');
      li.className = type + (k < today ? ' past' : '');
      li.innerHTML = `<span></span><button type="button" title="删除">×</button>`;
      li.firstChild.textContent = `${d.getMonth() + 1}/${d.getDate()} ${C.WEEK_NAMES[d.getDay()]} · ${type === 'rest' ? '放假' : '补班'}`;
      if (d.getFullYear() !== new Date().getFullYear()) li.title = k;
      li.lastChild.addEventListener('click', () => {
        delete draft.specialDates[k];
        renderSpecial();
        onDraftChange();
      });
      list.appendChild(li);
    });
  }

  function refreshVisibility() {
    $$('[data-show]').forEach((el) => {
      const [key, val] = el.dataset.show.split('=');
      const cur = draft[key];
      el.hidden = val === undefined ? !cur : String(cur) !== val;
    });
  }

  function fillForm() {
    $$('.segmented[data-name]').forEach((seg) => {
      const name = seg.dataset.name;
      segValue(seg, name === 'bigSmallThisWeek' ? thisWeekType() : draft[name]);
    });
    ['workStart', 'workEnd', 'lunchStart', 'lunchEnd', 'monthlySalary', 'customPayDays', 'payday'].forEach((n) => {
      form.elements[n].value = draft[n] == null ? '' : draft[n];
    });
    form.elements.payDaysMode.value = draft.payDaysMode;
    form.elements.lunchEnabled.checked = !!draft.lunchEnabled;
    updateActualOption();
    renderWeekdays();
    renderSpecial();
    refreshVisibility();
    renderErrors();
    renderSaveState();
  }

  function updateActualOption() {
    const now = new Date();
    const n = C.workdaysInMonth(C.normalize(draft), now.getFullYear(), now.getMonth());
    form.elements.payDaysMode.querySelector('option[value="actual"]').textContent = `当月实际工作日（本月 ${n} 天）`;
  }

  function isDirty() {
    return canon(draft) !== canon(saved);
  }

  function renderSaveState() {
    const dirty = isDirty();
    const el = $('#saveState');
    el.classList.toggle('dirty', dirty);
    $('#tabs').classList.toggle('dirty', dirty);
    setText(el, dirty ? '有未保存的修改（⌘/Ctrl + S 快速保存）' : '设置已是最新');
    $('#saveBtn').disabled = !dirty;
  }

  function renderErrors() {
    const errors = showErrors ? C.validate(C.normalize(draft)) : [];
    $$('.row-error').forEach((el) => {
      const e = errors.find((x) => x.field === el.dataset.error);
      el.textContent = e ? e.msg : '';
      el.classList.toggle('show', !!e);
    });
    $$('.invalid').forEach((el) => el.classList.remove('invalid'));
    errors.forEach((e) => {
      const input = form.elements[e.field];
      if (!input) return;
      (input.closest('.time-input') || input).classList.add('invalid');
    });
    return errors;
  }

  function onDraftChange() {
    updateActualOption();
    refreshVisibility();
    renderErrors();
    renderSaveState();
  }

  $$('.segmented[data-name]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const name = seg.dataset.name;
      if (name === 'bigSmallThisWeek') {
        const monday = C.mondayOf(new Date());
        draft.bigSmallAnchor = C.dateKey(b.dataset.value === 'double' ? monday : C.addDays(monday, 7));
      } else {
        draft[name] = b.dataset.value;
        if (name === 'restMode' && b.dataset.value === 'bigsmall' && !draft.bigSmallAnchor) {
          draft.bigSmallAnchor = C.dateKey(C.mondayOf(new Date()));
        }
      }
      fillSegments();
      onDraftChange();
    });
  });

  function fillSegments() {
    $$('.segmented[data-name]').forEach((seg) => {
      const name = seg.dataset.name;
      segValue(seg, name === 'bigSmallThisWeek' ? thisWeekType() : draft[name]);
    });
  }

  /* 时间输入：支持 930 / 9:30 / 0930，方向键 ±15 分钟（Shift ±1 小时） */
  function normalizeTime(raw) {
    const s = String(raw || '').trim().replace(/[：.\s]/g, ':');
    let h;
    let m;
    if (/^\d{1,2}:\d{1,2}$/.test(s)) [h, m] = s.split(':').map(Number);
    else if (/^\d{3,4}$/.test(s)) { h = Number(s.slice(0, s.length - 2)); m = Number(s.slice(-2)); }
    else if (/^\d{1,2}$/.test(s)) { h = Number(s); m = 0; }
    else return null;
    if (h > 23 || m > 59) return null;
    return `${C.pad2(h)}:${C.pad2(m)}`;
  }

  $$('.time-input input').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^\d:：]/g, '').replace('：', ':');
      draft[input.name] = normalizeTime(input.value) || input.value;
      onDraftChange();
    });
    input.addEventListener('blur', () => {
      const v = normalizeTime(input.value);
      if (v) {
        input.value = v;
        draft[input.name] = v;
        onDraftChange();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const cur = C.parseHM(normalizeTime(input.value) || '09:00');
      const step = (e.shiftKey ? 60 : 15) * 60 * (e.key === 'ArrowUp' ? 1 : -1);
      const next = (cur + step + 86400) % 86400;
      input.value = C.formatClock(next);
      draft[input.name] = input.value;
      onDraftChange();
    });
  });

  ['monthlySalary', 'customPayDays', 'payday'].forEach((n) => {
    form.elements[n].addEventListener('input', (e) => {
      draft[n] = e.target.value === '' ? '' : Number(e.target.value);
      onDraftChange();
    });
  });
  form.elements.payDaysMode.addEventListener('change', (e) => {
    draft.payDaysMode = e.target.value;
    if (draft.payDaysMode === 'custom' && !(draft.customPayDays > 0)) {
      draft.customPayDays = 22;
      form.elements.customPayDays.value = 22;
    }
    onDraftChange();
  });
  form.elements.lunchEnabled.addEventListener('change', (e) => {
    draft.lunchEnabled = e.target.checked;
    onDraftChange();
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  /* 节假日 / 调休 */
  let spType = 'rest';
  $('#spType').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    spType = b.dataset.value;
    segValue($('#spType'), spType);
  });
  $('#spDate').value = C.dateKey(new Date());
  $('#spAdd').addEventListener('click', () => {
    const k = $('#spDate').value;
    if (!C.parseDateKey(k)) return toast('请先选择日期', true);
    draft.specialDates = Object.assign({}, draft.specialDates, { [k]: spType });
    renderSpecial();
    onDraftChange();
  });

  /* 保存 */
  async function save() {
    showErrors = true;
    const errors = renderErrors();
    if (errors.length) {
      toast(errors[0].msg, true);
      return;
    }
    const res = await api.saveWork(draft);
    if (!res.ok) {
      renderErrors();
      toast(res.errors[0].msg, true);
      return;
    }
    saved = res.work;
    draft = clone(saved);
    showErrors = false;
    monthCache.key = '';
    fillForm();
    tick(true);
    toast('设置已保存');
    scene.say('收到！按新设置开始摸鱼~', 2200);
  }
  $('#saveBtn').addEventListener('click', save);
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (isDirty()) save();
    }
  });

  api.onWorkChanged((w) => {
    const wasDirty = isDirty();
    saved = w;
    monthCache.key = '';
    if (!wasDirty) {
      draft = clone(saved);
      fillForm();
    } else {
      renderSaveState();
    }
  });

  /* ================= 应用设置（即时生效） ================= */
  function fillPrefs() {
    $$('[data-pref]').forEach((el) => { el.checked = !!prefs[el.dataset.pref]; });
    segValue($('#widgetScale'), String(prefs.widgetScale || 1));
    const auto = $('#prefAuto');
    const autoInput = $('[data-pref="autoLaunch"]');
    autoInput.disabled = !state.packaged;
    auto.classList.toggle('disabled', !state.packaged);
    auto.title = state.packaged ? '' : '安装打包后的应用才可设置开机自启';
    $('#widgetScale').closest('.pref').classList.toggle('disabled', !prefs.widgetVisible);
  }
  $$('[data-pref]').forEach((el) => {
    el.addEventListener('change', async () => {
      prefs = await api.setApp({ [el.dataset.pref]: el.checked });
      fillPrefs();
    });
  });
  $('#widgetScale').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    prefs = await api.setApp({ widgetScale: Number(b.dataset.value) });
    fillPrefs();
  });
  api.onAppChanged((p) => { prefs = p; fillPrefs(); });

  /* ================= 仪表盘 ================= */
  const el = {
    cdTitle: $('#cdTitle'), cdValue: $('#cdValue'), cdFoot: $('#cdFoot'),
    progressRow: $('#progressRow'), progressFill: $('#progressFill'), progressText: $('#progressText'),
    earnNum: $('#earnNum'), rate: $('#rateText'), month: $('#monthValue'), coins: $('#coinLayer'),
    daily: $('#statDaily'), hourly: $('#statHourly'),
    rest: $('#statRest'), restLabel: $('#statRestLabel'),
    pay: $('#statPay'), payLabel: $('#statPayLabel'),
    badge: $('#sceneBadge'),
  };
  const monthCache = { key: '', before: 0, total: 0 };
  let lastYuan = null;

  /* 本月累计 = 月薪 × 本月已过工作日进度（含今天的实时进度），月底恰好等于月薪 */
  function monthEarned(s, snap) {
    const now = snap.now;
    const key = C.dateKey(now) + canon(s);
    if (monthCache.key !== key) {
      let before = 0;
      for (let d = 1; d < now.getDate(); d++) if (!C.isRestDay(new Date(now.getFullYear(), now.getMonth(), d), s)) before++;
      monthCache.key = key;
      monthCache.before = before;
      monthCache.total = C.workdaysInMonth(s, now.getFullYear(), now.getMonth());
    }
    if (!monthCache.total) return 0;
    const elapsed = monthCache.before + (snap.isRestDay ? 0 : snap.progress);
    return Math.min(s.monthlySalary, (s.monthlySalary * elapsed) / monthCache.total);
  }

  function footText(s, snap) {
    const sch = snap.sch;
    if (!sch.valid) return '在右侧填写上下班时间后开始计时';
    const st = C.formatClock(sch.start);
    const en = C.formatClock(sch.end);
    const lunch = sch.lunch ? ` · 午休 ${C.formatClock(sch.lunch.start)}-${C.formatClock(sch.lunch.end)}` : '';
    const next = snap.nextWorkStart ? `下次上班：${C.relativeDay(snap.nextWorkStart, snap.now)} ${st}` : '';
    switch (snap.status) {
      case 'working': return `${st} - ${en}${lunch} · 已工作 ${C.formatDuration(snap.worked)}`;
      case 'lunch': return `午休还剩 ${C.formatDuration(snap.lunchLeft)} · ${en} 下班`;
      case 'before': return `今天 ${st} 上班 · 今日可赚 ¥${C.formatMoney(snap.daily)}`;
      case 'off': return `今日工作 ${C.formatDuration(sch.workSeconds)} · ${next}`;
      case 'rest': return `今天休息，好好放松 · ${next}`;
      default: return '';
    }
  }

  function spawnCoin(text) {
    const c = document.createElement('span');
    c.className = 'coin';
    c.textContent = text;
    const box = el.earnNum.getBoundingClientRect();
    const host = el.coins.getBoundingClientRect();
    c.style.left = box.right - host.left + 8 + 'px';
    c.style.top = box.top - host.top - 4 + 'px';
    el.coins.appendChild(c);
    setTimeout(() => c.remove(), 1500);
  }

  function tick(force) {
    const s = C.normalize(saved);
    const snap = C.snapshot(s, new Date());
    const d = C.describe(snap);

    setText(el.cdTitle, d.title);
    setText(el.cdValue, d.big);
    el.cdValue.classList.toggle('text', !/\d/.test(d.big));

    const showBar = snap.status !== 'rest' && snap.status !== 'invalid';
    el.progressRow.style.visibility = showBar ? 'visible' : 'hidden';
    const pct = Math.min(100, snap.progress * 100);
    el.progressFill.style.width = pct.toFixed(2) + '%';
    setText(el.progressText, Math.floor(pct) + '%');
    setText(el.cdFoot, footText(s, snap));

    setText(el.earnNum, C.formatMoney(snap.earned));
    setText(el.rate, `≈ ¥${snap.perSecond.toFixed(4)} / 秒`);
    setText(el.month, '¥' + C.formatMoney(monthEarned(s, snap)));

    const yuan = Math.floor(snap.earned);
    if (!force && lastYuan != null && yuan > lastYuan && snap.status === 'working' && !document.hidden) spawnCoin('+¥1');
    lastYuan = yuan;

    setText(el.daily, '¥' + C.formatMoney(snap.daily));
    setText(el.hourly, '¥' + C.formatMoney(snap.hourly));
    if (snap.daysToRest === 0) { setText(el.rest, '今天'); setText(el.restLabel, '休息日'); }
    else { setText(el.rest, snap.daysToRest == null ? '-' : `${snap.daysToRest} 天`); setText(el.restLabel, '距离休息'); }
    el.rest.classList.toggle('hot', snap.daysToRest === 0 || snap.daysToRest === 1);
    if (snap.daysToPayday === 0) { setText(el.pay, '今天'); setText(el.payLabel, '发薪日'); }
    else { setText(el.pay, snap.daysToPayday == null ? '-' : `${snap.daysToPayday} 天`); setText(el.payLabel, '距离发薪'); }
    el.pay.classList.toggle('hot', snap.daysToPayday === 0);
    if (snap.nextPayday) el.pay.parentElement.title = `下次发薪：${snap.nextPayday.getMonth() + 1}月${snap.nextPayday.getDate()}日`;

    scene.setStatus(snap.status);
    scene.setMood(snap.mood);
    scene.setPalette(snap.palette);
    bgScene.setPalette(snap.palette);
    bgScene.setMood(snap.mood);
    document.body.classList.toggle('night', snap.palette === 'night');
    el.badge.dataset.status = snap.status;
    setText(el.badge.lastElementChild, focusBadge(snap) || d.badge);
    lastPerSecond = snap.perSecond;
  }
  let lastPerSecond = 0;

  /* ================= Toast ================= */
  let toastTimer;
  function toast(msg, isError, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  /* ================= 标签页 ================= */
  const TAB_DESC = {
    work: '合理安排工作与休息，让生活更有节奏',
    focus: '分清是在认真工作，还是在带薪摸鱼',
    look: '换成你喜欢的图片、GIF 动图或视频',
    app: '常规选项、版本信息与更新日志',
  };
  let currentTab = 'work';
  function switchTab(name) {
    currentTab = name;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    setText($('#tabDesc'), TAB_DESC[name]);
    if (name === 'look') renderLook();
    if (name === 'focus') refreshFocusPane();
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) switchTab(b.dataset.tab);
  });

  /* ================= 外观：自定义背景 ================= */
  const M = window.MoyuMedia;
  let look = state.look;
  let lookTarget = 'main';
  let importing = false;
  const BUILTIN_NAME = '小狐钓鱼';
  const sceneMedia = new M.MediaLayer($('#sceneMedia'), {
    onError: (item) => toast(`背景「${item.name}」无法播放，已显示默认场景`, true, 3200),
    onFrame: (snap) => paintBackdrop(snap),
  });
  const bgCanvas = $('#bgCanvas');
  const backdropMedia = { key: '', timer: null };

  function paintBackdrop(snap) {
    if (!snap) {
      bgCanvas.hidden = true;
      document.body.classList.remove('custom-bg', 'custom-scene', 'dark-bg');
      return;
    }
    bgCanvas.hidden = false;
    bgCanvas.width = snap.canvas.width;
    bgCanvas.height = snap.canvas.height;
    bgCanvas.getContext('2d').drawImage(snap.canvas, 0, 0);
    document.body.classList.toggle('dark-bg', snap.luma < 0.45);
  }

  /** 主界面背景：卡片里显示素材，窗口底图用素材的模糊画面（视频/动图每隔几秒刷新一次） */
  function applyMainLook() {
    const item = M.resolve(look, 'main');
    document.body.classList.toggle('custom-scene', !!item);
    document.body.classList.toggle('custom-bg', !!item);
    if (!item) paintBackdrop(null);
    sceneMedia.show(item, look);
    const key = item ? item.id : '';
    if (backdropMedia.key === key) return;
    backdropMedia.key = key;
    clearInterval(backdropMedia.timer);
    backdropMedia.timer = null;
    if (!item || !item.animated) return;
    backdropMedia.timer = setInterval(() => {
      const node = sceneMedia.el;
      if (!node || document.hidden || !sceneMedia.host.classList.contains('ready')) return;
      const s = M.snapshot(node, 96, 60);
      if (s) paintBackdrop(s);
    }, 4000);
  }

  /* 预览 */
  let previewScene = null;
  let previewLayer = null;
  let previewKey = null;
  function renderPreview() {
    const box = $('#lookPreview');
    const host = $('.look-preview-media', box);
    box.classList.toggle('widget', lookTarget === 'widget');
    const item = M.resolve(look, lookTarget);
    const key = item ? item.id : 'builtin';
    if (key !== previewKey) {
      previewKey = key;
      host.innerHTML = '';
      previewScene = null;
      previewLayer = null;
      if (item) {
        const div = document.createElement('div');
        div.style.cssText = 'position:absolute;inset:0';
        host.appendChild(div);
        previewLayer = new M.MediaLayer(div);
      } else {
        const div = document.createElement('div');
        div.style.cssText = 'position:absolute;inset:0';
        host.appendChild(div);
        previewScene = new FoxScene(div, { interactive: false });
        previewScene.speech && previewScene.speech.remove();
      }
    }
    if (previewLayer) previewLayer.show(item, look);
    const sel = look[lookTarget];
    const label = lookTarget === 'main' ? '主界面' : '桌面小组件';
    let name = item ? item.name : BUILTIN_NAME;
    if (lookTarget === 'widget' && sel === 'same') name = `跟随主界面 · ${name}`;
    setText($('#lookPreviewTag'), `${label} · ${name}`);
  }

  function kindBadge(item) {
    if (item.kind === 'video') return { cls: 'video', text: '视频' };
    if (item.ext === 'gif') return { cls: 'gif', text: 'GIF' };
    if (item.animated) return { cls: 'gif', text: '动图' };
    return null;
  }

  function usedTags(id) {
    const tags = [];
    if (look.main === id) tags.push('主');
    const w = look.widget === 'same' ? look.main : look.widget;
    if (w === id) tags.push('组件');
    return tags;
  }

  function makeTile(opts) {
    const tile = document.createElement('div');
    tile.className = 'bg-tile' + (opts.className ? ' ' + opts.className : '');
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    if (opts.title) tile.title = opts.title;
    tile.classList.toggle('on', !!opts.on);
    tile.addEventListener('click', opts.onPick);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onPick(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && opts.onDelete) { e.preventDefault(); opts.onDelete(); }
    });
    return tile;
  }

  function tagsHtml(tags) {
    return tags.length ? `<div class="bg-tags">${tags.map((t) => `<i>${t}</i>`).join('')}</div>` : '';
  }

  let builtinThumb = null;
  function renderGrid() {
    const grid = $('#bgGrid');
    grid.innerHTML = '';
    const sel = look[lookTarget];

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'bg-tile add' + (importing ? ' busy' : '');
    add.innerHTML = importing ? '<b>…</b>导入中' : '<b>＋</b>添加背景';
    add.disabled = importing;
    add.addEventListener('click', pickFiles);
    grid.appendChild(add);

    if (lookTarget === 'widget') {
      const same = makeTile({
        className: 'same',
        on: sel === 'same',
        title: '小组件使用和主界面相同的背景',
        onPick: () => chooseBg('same'),
      });
      same.innerHTML = '跟随主界面<small>与主界面保持一致</small>';
      grid.appendChild(same);
    }

    const builtin = makeTile({ on: sel === 'builtin', title: '内置场景：小狐狸钓鱼（随时间和状态变化）', onPick: () => chooseBg('builtin') });
    builtin.innerHTML = `<div class="bg-thumb"></div><span class="bg-kind">内置</span>${tagsHtml(usedTags('builtin'))}<div class="bg-name">${BUILTIN_NAME}</div>`;
    if (!builtinThumb) {
      builtinThumb = document.createElement('div');
      builtinThumb.style.cssText = 'position:absolute;inset:0';
      new FoxScene(builtinThumb, { static: true }).svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    }
    $('.bg-thumb', builtin).appendChild(builtinThumb);
    grid.appendChild(builtin);

    look.library.forEach((item) => {
      const tile = makeTile({
        on: sel === item.id,
        title: `${item.name}\n${(item.size / 1024 / 1024).toFixed(1)} MB · 回车选中，Delete 删除`,
        onPick: () => chooseBg(item.id),
        onDelete: () => deleteBg(item),
      });
      const badge = kindBadge(item);
      tile.innerHTML = `<div class="bg-thumb"></div>${badge ? `<span class="bg-kind ${badge.cls}">${badge.text}</span>` : ''}${tagsHtml(usedTags(item.id))}<div class="bg-name"></div><button type="button" class="bg-del" title="删除">×</button>`;
      $('.bg-name', tile).textContent = item.name;
      const thumb = $('.bg-thumb', tile);
      if (item.thumb) {
        const img = document.createElement('img');
        img.src = M.thumbUrl(item);
        img.alt = '';
        img.draggable = false;
        img.onerror = () => { img.replaceWith(M.createMediaElement(item, { paused: true })); };
        thumb.appendChild(img);
      } else {
        thumb.appendChild(M.createMediaElement(item, { paused: true }));
      }
      $('.bg-del', tile).addEventListener('click', (e) => {
        e.stopPropagation();
        deleteBg(item);
      });
      grid.appendChild(tile);
    });
    setText($('#libCount'), look.library.length ? `${look.library.length} 个素材` : '');
  }

  function renderLookControls() {
    segValue($('#lookTarget'), lookTarget);
    segValue($('#lookFit'), look.fit);
    $('#lookDim').value = look.dim;
    setText($('#lookDimVal'), look.dim + '%');
    $('#addBg').disabled = importing;
  }

  function renderLook() {
    renderLookControls();
    renderPreview();
    renderGrid();
  }

  function onLook(next) {
    look = next;
    applyMainLook();
    if (currentTab === 'look') renderLook();
  }

  async function chooseBg(id) {
    onLook(await api.look.set({ [lookTarget]: id }));
  }

  async function deleteBg(item) {
    const used = usedTags(item.id).length ? '（正在使用，删除后会恢复为默认场景）' : '';
    if (!window.confirm(`删除背景「${item.name}」？${used}`)) return;
    onLook(await api.look.remove(item.id));
    toast('已删除');
  }

  function reportImport(res) {
    if (res.canceled) return;
    onLook(res.look);
    const parts = [];
    if (res.added.length) parts.push(`已添加 ${res.added.length} 个背景`);
    if (res.duplicates.length) parts.push(`${res.duplicates.length} 个已在素材库中`);
    if (res.errors.length) {
      const e = res.errors[0];
      parts.push(`${res.errors.length} 个失败：「${e.name}」${e.error}`);
    }
    if (parts.length) toast(parts.join('，'), res.errors.length > 0 && !res.added.length, res.errors.length ? 4200 : 2400);
  }

  async function runImport(fn) {
    if (importing) return;
    importing = true;
    if (currentTab === 'look') renderLook();
    try {
      reportImport(await fn());
    } catch (e) {
      toast('导入失败：' + e.message, true);
    } finally {
      importing = false;
      if (currentTab === 'look') renderLook();
    }
  }

  function pickFiles() {
    runImport(() => api.look.pick(lookTarget));
  }

  $('#addBg').addEventListener('click', pickFiles);
  $('#lookTarget').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    lookTarget = b.dataset.value;
    renderLook();
  });
  $('#lookFit').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (b) onLook(await api.look.set({ fit: b.dataset.value }));
  });
  let dimTimer;
  $('#lookDim').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setText($('#lookDimVal'), v + '%');
    look = Object.assign({}, look, { dim: v });
    sceneMedia.show(M.resolve(look, 'main'), look);
    if (previewLayer) previewLayer.show(M.resolve(look, lookTarget), look);
    clearTimeout(dimTimer);
    dimTimer = setTimeout(async () => { look = await api.look.set({ dim: v }); }, 120);
  });
  api.look.onChanged((l) => {
    if (JSON.stringify(l) !== JSON.stringify(look)) onLook(l);
  });

  /* 拖拽导入：拖到窗口任意位置 */
  let dragDepth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropTarget = () => (currentTab === 'look' ? lookTarget : 'main');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    setText($('#dropTarget'), dropTarget() === 'widget' ? '将应用到桌面小组件' : '将应用到主界面');
    $('#dropMask').classList.add('show');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#dropMask').classList.remove('show');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('#dropMask').classList.remove('show');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const target = dropTarget();
    runImport(() => api.look.importFiles(files, target));
  });

  /* ================= 应用：版本与更新日志 ================= */
  function renderAbout() {
    setText($('#aboutVer'), 'v' + state.version);
    const box = $('#changelog');
    box.innerHTML = '';
    state.changelog.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'log-item';
      const h = document.createElement('h4');
      h.textContent = 'v' + c.version;
      const small = document.createElement('small');
      small.textContent = c.date;
      h.appendChild(small);
      if (c.version === state.version) {
        const cur = document.createElement('span');
        cur.className = 'cur';
        cur.textContent = '当前版本';
        h.appendChild(cur);
      }
      const ul = document.createElement('ul');
      c.notes.forEach((n) => {
        const li = document.createElement('li');
        li.textContent = n;
        ul.appendChild(li);
      });
      div.append(h, ul);
      box.appendChild(div);
    });
  }
  $('#openData').addEventListener('click', () => api.openDataFolder());

  function showUpdateModal(info) {
    if (!info || !info.notes.length) return;
    setText($('#updateTitle'), `已更新到 v${info.to}`);
    setText($('#updateSub'), `从 v${info.from} 升级，原有设置和背景都已保留`);
    const body = $('#updateNotes');
    body.innerHTML = '';
    info.notes.forEach((c) => {
      const h = document.createElement('h4');
      h.textContent = `v${c.version}`;
      const ul = document.createElement('ul');
      c.notes.forEach((n) => {
        const li = document.createElement('li');
        li.textContent = n;
        ul.appendChild(li);
      });
      body.append(h, ul);
    });
    $('#updateModal').hidden = false;
    $('#updateOk').focus();
  }
  $('#updateOk').addEventListener('click', () => {
    $('#updateModal').hidden = true;
    api.ackUpdate();
  });

  /* ================= 专注：工作 / 摸鱼识别 ================= */
  const fmtDur = (s) => {
    s = Math.floor(s || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}时${m}分`;
    if (m) return `${m}分`;
    return s ? `${s}秒` : '0分';
  };
  const STATE_TEXT = {
    focus: '专注中',
    overtime: '加班中',
    slack: '摸鱼中',
    away: '离开中',
    outside: '不在工作时间',
    unavailable: '无法识别',
    off: '未开启',
  };
  let fsum = null; // 完整统计（专注页用）
  let flive = null; // 每秒推送的实时状态

  function focusBadge(snap) {
    if (!flive || !flive.enabled || !flive.show.main || snap.status !== 'working') return '';
    const st = flive.live.state;
    if (st === 'focus') return '认真工作中';
    if (st === 'slack') return '摸鱼中…';
    if (st === 'away') return '离开座位';
    return '';
  }

  function renderFocusCard() {
    const card = $('#focusCard');
    const show = !!flive && flive.enabled && flive.show.main;
    card.hidden = !show;
    if (!show) return;
    const st = flive.live.state;
    const noApps = !!fsum && fsum.cfg.apps.length === 0;
    card.dataset.state = st;
    card.classList.toggle('no-apps', noApps);
    $('#focusSetup').hidden = !noApps;
    setText($('#focusState'), flive.error ? '无法识别前台软件' : STATE_TEXT[st] || '');
    let sub = '';
    if (flive.error) sub = flive.error;
    else if (flive.live.app && !flive.live.app.self) sub = flive.live.app.name + (flive.live.isWork ? ' · 工作软件' : '');
    else if (flive.live.app && flive.live.app.self) sub = '正在看摸鱼小狐';
    if (st === 'outside') sub = '下班时间不统计' + (fsum && fsum.cfg.countOvertime ? '（使用工作软件计为加班）' : '');
    setText($('#focusApp'), sub);
    const focus = flive.focus + flive.overtime;
    setText($('#fFocus'), fmtDur(focus));
    setText($('#fSlack'), fmtDur(flive.slack));
    setText($('#fAway'), fmtDur(flive.away));
    setText($('#fSlackMoney'), lastPerSecond ? `摸鱼 ≈¥${C.formatMoney(flive.slack * lastPerSecond)}` : '摸鱼');
    const total = flive.focus + flive.slack + flive.away;
    setText($('#fRate'), total >= 60 ? Math.round((flive.focus / total) * 100) + '%' : '-');
    const all = Math.max(1, focus + flive.slack + flive.away);
    const bar = $('#focusBar');
    $('.f', bar).style.width = (focus / all) * 100 + '%';
    $('.s', bar).style.width = (flive.slack / all) * 100 + '%';
    $('.a', bar).style.width = (flive.away / all) * 100 + '%';
  }

  function renderFocusLive() {
    const box = $('#fLive');
    if (!fsum || !fsum.cfg.enabled) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    const tag = document.createElement('span');
    const text = document.createElement('span');
    const live = flive ? flive.live : fsum.live;
    const err = flive ? flive.error : fsum.error;
    if (err) {
      tag.className = 'tag err';
      tag.textContent = '异常';
      text.textContent = err;
    } else {
      const st = live.state;
      tag.className = 'tag ' + (st === 'focus' || st === 'overtime' ? 'focus' : st === 'slack' ? 'slack' : '');
      tag.textContent = STATE_TEXT[st] || '识别中';
      if (live.app && !live.app.self) {
        text.append('当前前台：');
        const b = document.createElement('b');
        b.textContent = live.app.name;
        text.append(b, live.isWork ? '（工作软件）' : '');
      } else if (live.app && live.app.self) {
        text.textContent = '当前前台是摸鱼小狐本身，切到其它软件试试';
      } else {
        text.textContent = '正在识别前台软件…';
      }
    }
    box.append(tag, text);
  }

  function renderFocusPane() {
    if (!fsum) return;
    const cfg = fsum.cfg;
    const pane = $('.pane[data-pane="focus"]');
    pane.classList.toggle('off', !cfg.enabled);
    $('#fEnabled').checked = cfg.enabled;
    $('#fIdle').value = String(cfg.idleMinutes);
    $('#fOvertime').checked = cfg.countOvertime;
    $$('[data-fshow]').forEach((i) => { i.checked = !!cfg[i.dataset.fshow]; });
    setText($('#fAppCount'), cfg.apps.length ? `${cfg.apps.length} 个` : '');
    $('#fPick').textContent = state.platform === 'darwin' ? '＋ 从「应用程序」选择' : '＋ 选择 .exe 程序';

    const list = $('#fApps');
    list.innerHTML = '';
    cfg.apps.forEach((a) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = a.name;
      li.title = a.id;
      const x = document.createElement('button');
      x.type = 'button';
      x.title = '移出工作软件';
      x.textContent = '×';
      x.addEventListener('click', async () => { await api.focus.remove(a.id); refreshFocusPane(); });
      li.append(span, x);
      list.appendChild(li);
    });

    const usage = $('#fUsage');
    usage.innerHTML = '';
    const work = new Set(cfg.apps.map((a) => a.id));
    fsum.recent.forEach((a) => {
      const li = document.createElement('li');
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = a.name;
      nm.title = a.id;
      if (work.has(a.id)) {
        const tagEl = document.createElement('small');
        tagEl.textContent = '工作';
        nm.appendChild(tagEl);
      }
      const tm = document.createElement('span');
      tm.className = 'tm';
      tm.textContent = a.secs ? fmtDur(a.secs) : '刚刚用过';
      const btn = document.createElement('button');
      btn.type = 'button';
      const on = work.has(a.id);
      btn.className = on ? 'on' : '';
      btn.textContent = on ? '✓ 工作' : '设为工作';
      btn.title = on ? '点击移出工作软件' : '点击设为工作软件';
      btn.addEventListener('click', async () => {
        if (on) await api.focus.remove(a.id);
        else await api.focus.add({ id: a.id, name: a.name });
        refreshFocusPane();
      });
      li.append(nm, tm, btn);
      usage.appendChild(li);
    });

    const week = $('#fWeek');
    week.innerHTML = '';
    const max = Math.max(3600, ...fsum.history.map((d) => d.focus + d.slack + d.away));
    const todayKey = C.dateKey(new Date());
    fsum.history.forEach((d) => {
      const col = document.createElement('div');
      col.className = 'col' + (d.date === todayKey ? ' today' : '');
      const total = d.focus + d.slack + d.away;
      col.title = `${d.date}\n专注 ${fmtDur(d.focus)} · 摸鱼 ${fmtDur(d.slack)} · 离开 ${fmtDur(d.away)}`;
      const stack = document.createElement('div');
      stack.className = 'stack';
      stack.style.height = Math.max(3, (total / max) * 86) + 'px';
      [['f', d.focus], ['s', d.slack], ['a', d.away]].forEach(([c, v]) => {
        const i = document.createElement('i');
        i.className = c;
        i.style.height = total ? (v / total) * 100 + '%' : '0';
        stack.appendChild(i);
      });
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      const dt = C.parseDateKey(d.date);
      lbl.textContent = d.date === todayKey ? '今天' : C.WEEK_NAMES[dt.getDay()].slice(1);
      col.append(stack, lbl);
      week.appendChild(col);
    });
    renderFocusLive();
  }

  async function refreshFocusPane() {
    fsum = await api.focus.get();
    renderFocusPane();
    renderFocusCard();
  }

  $('#fEnabled').addEventListener('change', async (e) => {
    await api.focus.set({ enabled: e.target.checked });
    if (e.target.checked && fsum && !fsum.cfg.apps.length) toast('已开启。先打开你的工作软件用一下，再回这里把它「设为工作」', false, 3600);
    refreshFocusPane();
  });
  $('#fIdle').addEventListener('change', async (e) => { await api.focus.set({ idleMinutes: Number(e.target.value) }); refreshFocusPane(); });
  $('#fOvertime').addEventListener('change', async (e) => { await api.focus.set({ countOvertime: e.target.checked }); refreshFocusPane(); });
  $$('[data-fshow]').forEach((i) => i.addEventListener('change', async () => {
    await api.focus.set({ [i.dataset.fshow]: i.checked });
    refreshFocusPane();
  }));
  $('#fPick').addEventListener('click', async () => {
    const r = await api.focus.pick();
    if (r.added.length) toast(`已添加：${r.added.join('、')}`);
    if (r.errors.length) toast(r.errors[0], true, 3200);
    refreshFocusPane();
  });
  $('#focusSetup').addEventListener('click', () => switchTab('focus'));

  api.focus.onLive((p) => {
    flive = p;
    renderFocusCard();
    if (currentTab === 'focus') renderFocusLive();
  });
  api.focus.onConfig(() => refreshFocusPane());
  setInterval(() => {
    if (currentTab === 'focus' && !document.hidden) refreshFocusPane();
  }, 5000);

  fillForm();
  fillPrefs();
  renderAbout();
  applyMainLook();
  tick(true);
  setInterval(tick, 100);
  refreshFocusPane();
  showUpdateModal(state.updateInfo);
})();
