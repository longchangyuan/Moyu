# 摸鱼小狐 · Electron → Tauri 迁移进度

> 更新日期：2026-11-03 · 状态：**核心迁移已完成，mac 包已出成品**

## 目标回顾

把「摸鱼小狐」从 Electron 45 迁移到 Tauri 2.x：**全量功能对等**，复用现有 `src/` 前端（SVG 场景、CSS 动画、设置表单原样保留），仅用 Rust 重写主进程与系统集成，包体从约 100 MB 降至约 10 MB。**数据用新目录、不迁移旧配置。**

---

## 总进度

| # | 阶段 | 状态 |
|---|---|---|
| 1 | 环境 + 骨架 | ✅ 完成 |
| 2 | core / store / AppState + 一致性测试 | ✅ 完成 |
| 3 | 系统集成（窗口/托盘/通知/自启/单实例/ticker） | ✅ 完成 |
| 4 | 自定义背景 + `moyu-bg://` 协议 | ✅ 完成 |
| 5 | 专注识别 | ✅ 完成 |
| 6 | 前端桥接（bridge.js + commands + events） | ✅ 完成 |
| 7 | 打包发布 | ✅ mac 双架构已完成；Windows 走 CI |

---

## 各阶段落地情况

- **环境**：Rust 1.99.1 + Tauri CLI 2.12.4，配了 cargo 国内镜像（rsproxy）。
- **核心**：`core.rs` 复刻 `core.js`（倒计时/收入/休息日/大小周/发薪日/格式化），并用 `core.js` 生成夹具、`core.rs` 断言的一致性测试锁住口径（working/before/lunch/off/rest 五类状态）。
- **存储**：`store.rs`（config.json 分区存储、默认值合并、原子写）、`state.rs`（`AppState(Mutex<AppStateInner>)` 共享状态）。
- **系统集成**：`window.rs`（主窗口 + 无边框透明置顶小组件）、`tray.rs`（mac 菜单栏倒计时 / win 托盘 tooltip + 菜单）、`ticker.rs`（每秒心跳 + 通知）、三个插件（notification / autostart / single-instance）。
- **背景**：`backgrounds.rs`（格式嗅探、sha256 去重、复制）+ `protocol.rs`（`moyu-bg://` 只读协议、Range 支持）；`sniff` 有单元测试。
- **专注**：`focus.rs`（mac `lsappinfo` 轮询 / win Win32 前台识别 + 空闲检测 + 按天统计持久化）。
- **桥接**：`commands.rs`（1:1 对应 preload.js 的 IPC 全集）+ `events.rs`（事件发射）+ 前端 `bridge.js`（封装 `window.__TAURI__` 为 `window.moyu`），`app.js`/`widget.js` 零改动。
- **编译**：`cargo check` / `cargo build` / `cargo test`（2 项）全部通过，0 警告 0 错误。

---

## 打包结果（成品）

| 产物 | 大小 | 位置 |
|---|---|---|
| mac Apple 芯片 dmg | **4.3 MB** | `src-tauri/target/release/bundle/dmg/摸鱼小狐_1.2.0_aarch64.dmg` |
| mac Intel dmg | **4.4 MB** | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/摸鱼小狐_1.2.0_x64.dmg` |
| mac .app | ~13 MB | 各 target 的 `bundle/macos/` 下 |

**体积对比：Electron ~103–109 MB → Tauri 4.3 MB（约降 96%）**

---

## 剩余事项

1. **Windows 包**：走 GitHub Actions（`.github/workflows/build.yml` 已写好）。项目 push 到 GitHub 后，手动触发或打 tag 即可自动出 `nsis` 安装包（x64）。
   - 注意：`focus.rs` 里 `#[cfg(windows)]` 的 Win32 前台识别是盲写的，第一次在 Windows 编译可能报 API 名/feature 错误，需按报错微调。
2. **运行自测**：GUI 交互（小组件拖动、菜单栏倒计时、自定义背景、专注识别）需真机验证。
3. **清理**：原 Electron 代码（`main/`、`package.json` 的 electron-builder 部分、`scripts/` 里的 electron 脚本）待 Tauri 版验证通过后再删。

---

## 打包命令速查

```bash
# mac Apple 芯片
npx tauri build
# mac Intel
rustup target add x86_64-apple-darwin && npx tauri build --target x86_64-apple-darwin
# Windows（在 Windows 机器或 CI）
npx tauri build
```

详见 `打包说明.md`。
