/*
 * 打包入口：node scripts/build.js <mac|win|all>
 * 自动使用国内镜像下载 Electron 与 NSIS 等构建依赖。
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const target = process.argv[2] || 'all';
const flags = { mac: ['--mac'], win: ['--win'], all: ['--mac', '--win'] }[target];
if (!flags) {
  console.error('用法：node scripts/build.js <mac|win|all>');
  process.exit(1);
}
if (flags.includes('--mac') && process.platform !== 'darwin') {
  console.error('mac 安装包（dmg）只能在 macOS 上构建');
  process.exit(1);
}

const env = Object.assign({}, process.env, {
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
});

const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const r = spawnSync(bin, [...flags, '--publish', 'never'], { stdio: 'inherit', env, cwd: path.join(__dirname, '..'), shell: process.platform === 'win32' });
process.exit(r.status == null ? 1 : r.status);
