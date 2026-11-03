/*
 * 生成 core.rs 一致性测试的期望值（以现有 core.js 为金标准）。
 * 用法：node scripts/gen-core-fixture.js > src-tauri/tests/fixtures/core.json
 */
'use strict';
const Core = require('../src/js/core.js');

// mo 为 1 起始月份，构成本地时区的时间
const local = (y, mo, d, h, mi, s) => new Date(y, mo - 1, d, h, mi, s);

const defaultWork = Core.normalize(null);

const cases = [
  { name: 'working', work: defaultWork, now: local(2026, 11, 2, 17, 40, 24) },
  { name: 'before', work: defaultWork, now: local(2026, 11, 2, 8, 0, 0) },
  { name: 'lunch', work: defaultWork, now: local(2026, 11, 2, 12, 30, 0) },
  { name: 'off', work: defaultWork, now: local(2026, 11, 2, 19, 0, 0) },
  { name: 'rest', work: defaultWork, now: local(2026, 11, 7, 10, 0, 0) },
];

const out = [];
for (const c of cases) {
  const snap = Core.snapshot(Core.normalize(c.work), c.now);
  const d = Core.describe(snap);
  out.push({
    name: c.name,
    now: [c.now.getFullYear(), c.now.getMonth() + 1, c.now.getDate(), c.now.getHours(), c.now.getMinutes(), c.now.getSeconds()],
    status: snap.status,
    countdown: Math.floor(snap.countdown),
    title: d.title,
    short: d.short,
    big: d.big,
    badge: d.badge,
    tray: d.tray,
    earned: Core.formatMoney(snap.earned, 2),
    daily: Core.formatMoney(snap.daily, 2),
    daysToRest: snap.daysToRest,
    daysToPayday: snap.daysToPayday,
  });
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
