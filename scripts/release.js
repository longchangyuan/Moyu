/*
 * 一键发布：npm run release            （已打好安装包时：npm run release -- --skip-build）
 * 1. 打 Windows 安装包、mac 安装包（Apple 芯片 / Intel 各一个）
 * 2. 打包源码
 * 3. 按版本复制到 releases/v<版本>/，文件名改成好认的中文名
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const out = path.join(root, 'dist', version);
const dest = path.join(root, 'releases', `v${version}`);

function step(title, cmd, args) {
  console.log(`\n▶ ${title}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`✖ ${title} 失败`);
    process.exit(r.status || 1);
  }
}

const isMac = process.platform === 'darwin';
const skipBuild = process.argv.includes('--skip-build');
if (!skipBuild) {
  step('打包 Windows', process.execPath, ['scripts/build.js', 'win']);
  if (isMac) step('打包 macOS', process.execPath, ['scripts/build.js', 'mac']);
  else console.log('\n（当前不是 macOS，跳过 mac 安装包）');
}
step('打包源码', process.execPath, ['scripts/pack-source.js']);

const files = [
  [`MoyuFox-${version}-win-x64-setup.exe`, `摸鱼小狐-${version}-Windows.exe`],
  [`MoyuFox-${version}-mac-arm64.dmg`, `摸鱼小狐-${version}-mac-苹果芯片.dmg`],
  [`MoyuFox-${version}-mac-x64.dmg`, `摸鱼小狐-${version}-mac-Intel芯片.dmg`],
  [`MoyuFox-${version}-source.zip`, `摸鱼小狐-${version}-源码.zip`],
];
fs.mkdirSync(dest, { recursive: true });
console.log(`\n✔ 发布文件 → releases/v${version}/`);
for (const [from, to] of files) {
  const src = path.join(out, from);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(dest, to));
  const mb = (fs.statSync(src).size / 1024 / 1024).toFixed(1);
  console.log(`  ${to.padEnd(32)} ${mb} MB`);
}
