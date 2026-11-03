/* 摸鱼小狐 · 计算核心（浏览器与 Node 通用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoyuCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;
  const WEEK_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const LEGAL_PAY_DAYS = 21.75;

  const DEFAULTS = Object.freeze({
    restMode: 'double', // double 双休 | single 单休 | bigsmall 大小周 | custom 自定义
    customRestDays: [0, 6],
    bigSmallAnchor: null, // 某个“双休周”的周一，YYYY-MM-DD
    workStart: '09:00',
    workEnd: '18:00',
    lunchEnabled: true,
    lunchStart: '12:00',
    lunchEnd: '13:00',
    monthlySalary: 10000,
    payDaysMode: 'legal', // legal 21.75 | actual 当月实际工作日 | custom
    customPayDays: 22,
    payday: 10,
    specialDates: {}, // { 'YYYY-MM-DD': 'rest' | 'work' }
  });

  /* ---------- 日期工具 ---------- */
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const secondsOfDay = (d) =>
    d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;

  function parseDateKey(k) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function parseHM(str) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
    if (!m) return null;
    const h = +m[1];
    const mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 3600 + mi * 60;
  }

  function mondayOf(d) {
    const wd = d.getDay();
    return addDays(d, wd === 0 ? -6 : 1 - wd);
  }

  function at(day, sec) {
    return new Date(
      day.getFullYear(), day.getMonth(), day.getDate(),
      Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), Math.floor(sec % 60)
    );
  }

  /* ---------- 设置 ---------- */
  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalize(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    s.customRestDays = Array.isArray(s.customRestDays)
      ? [...new Set(s.customRestDays.map(Number).filter((d) => d >= 0 && d <= 6))]
      : DEFAULTS.customRestDays.slice();
    s.specialDates = s.specialDates && typeof s.specialDates === 'object' ? Object.assign({}, s.specialDates) : {};
    s.monthlySalary = Math.max(0, Number(s.monthlySalary) || 0);
    s.customPayDays = Number(s.customPayDays) || 0;
    s.payday = clampInt(s.payday, 1, 31, DEFAULTS.payday);
    s.lunchEnabled = !!s.lunchEnabled;
    if (!['double', 'single', 'bigsmall', 'custom'].includes(s.restMode)) s.restMode = 'double';
    if (!['legal', 'actual', 'custom'].includes(s.payDaysMode)) s.payDaysMode = 'legal';
    if (s.restMode === 'bigsmall' && !parseDateKey(s.bigSmallAnchor)) s.bigSmallAnchor = dateKey(mondayOf(new Date()));
    return s;
  }

  function validate(s) {
    const errors = [];
    const start = parseHM(s.workStart);
    const end = parseHM(s.workEnd);
    if (start == null) errors.push({ field: 'workStart', msg: '请填写上班时间' });
    if (end == null) errors.push({ field: 'workEnd', msg: '请填写下班时间' });
    if (start != null && end != null && end <= start) {
      errors.push({ field: 'workEnd', msg: '下班时间需要晚于上班时间（暂不支持跨天夜班）' });
    }
    if (s.lunchEnabled) {
      const ls = parseHM(s.lunchStart);
      const le = parseHM(s.lunchEnd);
      if (ls == null || le == null) errors.push({ field: 'lunchEnd', msg: '请填写完整的午休时间' });
      else if (le <= ls) errors.push({ field: 'lunchEnd', msg: '午休结束需要晚于午休开始' });
      else if (start != null && end != null && end > start && le - ls >= end - start) {
        errors.push({ field: 'lunchEnd', msg: '午休时长不能覆盖整个工作时间' });
      }
    }
    if (!(Number(s.monthlySalary) > 0)) errors.push({ field: 'monthlySalary', msg: '请填写大于 0 的月薪' });
    if (s.payDaysMode === 'custom') {
      const d = Number(s.customPayDays);
      if (!(d > 0 && d <= 31)) errors.push({ field: 'customPayDays', msg: '计薪天数需在 1 ~ 31 之间' });
    }
    const pd = Number(s.payday);
    if (!(Number.isInteger(pd) && pd >= 1 && pd <= 31)) errors.push({ field: 'payday', msg: '发薪日需在 1 ~ 31 号之间' });
    if (s.restMode === 'custom' && (s.customRestDays || []).length >= 7) {
      errors.push({ field: 'customRestDays', msg: '至少保留一个工作日' });
    }
    return errors;
  }

  /* ---------- 休息日 / 工作日 ---------- */
  function isDoubleRestWeek(date, s) {
    const anchor = parseDateKey(s.bigSmallAnchor) || mondayOf(new Date());
    const weeks = Math.round(diffDays(mondayOf(anchor), mondayOf(date)) / 7);
    return ((weeks % 2) + 2) % 2 === 0;
  }

  function isRestDay(date, s) {
    const sp = s.specialDates[dateKey(date)];
    if (sp === 'rest') return true;
    if (sp === 'work') return false;
    const wd = date.getDay();
    switch (s.restMode) {
      case 'single':
        return wd === 0;
      case 'custom':
        return s.customRestDays.includes(wd);
      case 'bigsmall':
        if (wd === 0) return true;
        if (wd !== 6) return false;
        return isDoubleRestWeek(date, s);
      default:
        return wd === 0 || wd === 6;
    }
  }

  function workdaysInMonth(s, y, m) {
    const total = daysInMonth(y, m);
    let n = 0;
    for (let d = 1; d <= total; d++) if (!isRestDay(new Date(y, m, d), s)) n++;
    return n;
  }

  /* ---------- 工时 / 薪资 ---------- */
  function schedule(s) {
    const start = parseHM(s.workStart);
    const end = parseHM(s.workEnd);
    if (start == null || end == null || end <= start) return { valid: false };
    let lunch = null;
    if (s.lunchEnabled) {
      const ls = parseHM(s.lunchStart);
      const le = parseHM(s.lunchEnd);
      if (ls != null && le != null && le > ls) {
        const a = Math.max(ls, start);
        const b = Math.min(le, end);
        if (b > a) lunch = { start: a, end: b };
      }
    }
    const workSeconds = end - start - (lunch ? lunch.end - lunch.start : 0);
    return { valid: workSeconds > 0, start, end, lunch, workSeconds };
  }

  function workedAt(sch, t) {
    const c = Math.min(Math.max(t, sch.start), sch.end);
    let w = c - sch.start;
    if (sch.lunch) w -= Math.max(0, Math.min(c, sch.lunch.end) - sch.lunch.start);
    return Math.max(0, w);
  }

  function payDaysFor(s, ref) {
    if (s.payDaysMode === 'custom') return s.customPayDays > 0 ? s.customPayDays : LEGAL_PAY_DAYS;
    if (s.payDaysMode === 'actual') {
      const n = workdaysInMonth(s, ref.getFullYear(), ref.getMonth());
      return n > 0 ? n : LEGAL_PAY_DAYS;
    }
    return LEGAL_PAY_DAYS;
  }

  function rates(s, ref) {
    const sch = schedule(s);
    const payDays = payDaysFor(s, ref || new Date());
    const daily = s.monthlySalary > 0 ? s.monthlySalary / payDays : 0;
    const hours = sch.valid ? sch.workSeconds / 3600 : 0;
    return {
      sch,
      payDays,
      daily,
      hours,
      hourly: hours ? daily / hours : 0,
      perSecond: sch.valid ? daily / sch.workSeconds : 0,
    };
  }

  function daysToRest(s, today) {
    if (isRestDay(today, s)) return 0;
    for (let i = 1; i <= 400; i++) if (isRestDay(addDays(today, i), s)) return i;
    return null;
  }

  function nextPayday(s, today) {
    const base = startOfDay(today);
    for (let k = 0; k < 3; k++) {
      const y = base.getFullYear();
      const m = base.getMonth() + k;
      const d = new Date(y, m, Math.min(s.payday, daysInMonth(y, m)));
      if (d >= base) return d;
    }
    return null;
  }

  function nextWorkStart(s, now, sch) {
    for (let i = 0; i <= 400; i++) {
      const day = addDays(now, i);
      if (isRestDay(day, s)) continue;
      const t = at(day, sch.start);
      if (t > now) return t;
    }
    return null;
  }

  function paletteFor(now) {
    const m = now.getHours() * 60 + now.getMinutes();
    if (m < 330) return 'night';
    if (m < 450) return 'dawn';
    if (m < 1020) return 'day';
    if (m < 1170) return 'sunset';
    return 'night';
  }

  function moodFor(status, now) {
    const h = now.getHours();
    const lateNight = h >= 23 || h < 6;
    if (status === 'lunch') return 'sleep';
    if (lateNight && status !== 'working') return 'sleep';
    if (status === 'off' || status === 'rest') return 'happy';
    return 'lazy';
  }

  function snapshot(s, now) {
    now = now || new Date();
    const today = startOfDay(now);
    const r = rates(s, now);
    const sch = r.sch;
    const t = secondsOfDay(now);
    const payday = nextPayday(s, today);
    const snap = {
      now,
      sch,
      daily: r.daily,
      hourly: r.hourly,
      perSecond: r.perSecond,
      payDays: r.payDays,
      isRestDay: isRestDay(today, s),
      daysToRest: daysToRest(s, today),
      nextPayday: payday,
      daysToPayday: payday ? diffDays(today, payday) : null,
      palette: paletteFor(now),
      status: 'invalid',
      countdown: 0,
      progress: 0,
      earned: 0,
      worked: 0,
      lunchLeft: 0,
      nextWorkStart: null,
    };

    if (sch.valid) {
      if (snap.isRestDay) {
        snap.status = 'rest';
      } else if (t < sch.start) {
        snap.status = 'before';
        snap.countdown = sch.start - t;
      } else if (t >= sch.end) {
        snap.status = 'off';
        snap.progress = 1;
        snap.worked = sch.workSeconds;
        snap.earned = r.daily;
      } else {
        snap.worked = workedAt(sch, t);
        snap.progress = snap.worked / sch.workSeconds;
        snap.earned = snap.worked * r.perSecond;
        snap.countdown = sch.end - t;
        if (sch.lunch && t >= sch.lunch.start && t < sch.lunch.end) {
          snap.status = 'lunch';
          snap.lunchLeft = sch.lunch.end - t;
        } else {
          snap.status = 'working';
        }
      }
      if (snap.status === 'rest' || snap.status === 'off') {
        snap.nextWorkStart = nextWorkStart(s, now, sch);
        snap.countdown = snap.nextWorkStart ? (snap.nextWorkStart - now) / 1000 : 0;
      }
    }
    snap.mood = moodFor(snap.status, now);
    return snap;
  }

  /* ---------- 格式化 ---------- */
  function formatHMS(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${pad2(h)}:${pad2(m)}:${pad2(sec % 60)}`;
  }

  function formatCountdown(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 86400) return formatHMS(sec);
    const d = Math.floor(sec / 86400);
    return `${d}天 ${formatHMS(sec % 86400)}`;
  }

  function formatMoney(n, digits) {
    digits = digits == null ? 2 : digits;
    const f = Math.pow(10, digits);
    const v = Math.floor((Number(n) || 0) * f + 1e-6) / f;
    return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatClock(sec) {
    return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}`;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h && m) return `${h} 小时 ${m} 分`;
    if (h) return `${h} 小时`;
    return `${m} 分钟`;
  }

  function relativeDay(date, now) {
    const d = diffDays(now, date);
    if (d === 0) return '今天';
    if (d === 1) return '明天';
    if (d === 2) return '后天';
    return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEK_NAMES[date.getDay()]}`;
  }

  function describe(snap) {
    const cd = formatCountdown(snap.countdown);
    const night = snap.mood === 'sleep' && snap.status !== 'lunch';
    switch (snap.status) {
      case 'working':
        return { title: '距离下班还有', short: '距离下班', big: cd, badge: '摸鱼中…', tray: cd };
      case 'lunch':
        return { title: '午休中 · 距离下班还有', short: '午休中 · 距离下班', big: cd, badge: '午休打盹 Zzz', tray: `午休 ${cd}` };
      case 'before':
        return { title: '距离上班还有', short: '距离上班', big: cd, badge: night ? '晚安 Zzz' : '还没上班', tray: `上班 ${cd}` };
      case 'off':
        return { title: '今日已下班', short: '已下班', big: '下班啦！', badge: night ? '晚安 Zzz' : '下班啦！', tray: '已下班' };
      case 'rest':
        return { title: '休息日 · 距离上班还有', short: '休息日', big: cd, badge: night ? '晚安 Zzz' : '休息日', tray: '休息日' };
      default:
        return { title: '请先完善工作时间', short: '待设置', big: '--:--:--', badge: '等待设置', tray: '摸鱼小狐' };
    }
  }

  return {
    DEFAULTS,
    WEEK_NAMES,
    LEGAL_PAY_DAYS,
    pad2,
    dateKey,
    parseDateKey,
    parseHM,
    startOfDay,
    addDays,
    diffDays,
    mondayOf,
    normalize,
    validate,
    isRestDay,
    isDoubleRestWeek,
    workdaysInMonth,
    schedule,
    rates,
    snapshot,
    describe,
    formatHMS,
    formatCountdown,
    formatMoney,
    formatClock,
    formatDuration,
    relativeDay,
  };
});
