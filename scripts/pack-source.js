/*
 * 打包源码：node scripts/pack-source.js → dist/<version>/MoyuFox-<version>-source.zip
 * 排除 node_modules、dist 等可再生成内容。macOS / Windows 10+ 自带的 bsdtar 均可用。
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const out = path.join(root, 'dist', pkg.version, `MoyuFox-${pkg.version}-source.zip`);
const include = ['main', 'src', 'scripts', 'assets', 'build', 'package.json', 'package-lock.json', '.npmrc', '.gitignore', 'README.md'];

fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) fs.unlinkSync(out);
const items = include.filter((p) => fs.existsSync(path.join(root, p)));
const r = spawnSync('tar', ['--format', 'zip', '-cf', out, '--exclude', '.DS_Store', ...items], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('源码包已生成：' + path.relative(root, out));
