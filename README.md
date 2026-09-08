# Wordverse

Wordverse 是一款本地优先的三维词网工具。它把知识压缩成“词眼”，通过空间、连接和子词网帮助回忆与继续探索。

## 开发运行

需要 Node.js 20+。桌面开发还需要 Rust stable 与 Windows WebView2。

```powershell
npm install
npm run dev
npm run desktop:dev
```

浏览器开发地址默认为 `http://127.0.0.1:5173/`。浏览器模式使用 IndexedDB；桌面模式使用正式文件存储。

## 数据与恢复

桌面词库保存在：

```text
%USERPROFILE%\.Wordverse\settings.json
%USERPROFILE%\.Wordverse\词网\主词网.json
%USERPROFILE%\.Wordverse\词网\学习.json
%USERPROFILE%\.Wordverse\备份\workspace.backup-1.json
```

每个主词网使用一个独立、可读文件名的 JSON，子词网跟随所属主词网保存。`settings.json` 只保存全局属性、修订号与文件索引。每次有效保存会在 `备份` 目录轮换最近三份完整快照。旧 `workspace*.json` 会在首次保存时迁移到备份目录。同步冲突时，Wordverse 不会直接覆盖外部版本，并可先把当前内存版本写入 `.Wordverse\conflicts`。

桌面版图片保存在 `.Wordverse\assets`，日常 JSON 只记录相对引用，避免每份备份重复复制图片。导出完整 JSON 时会自动将图片内联，因此单个导出文件可独立导入另一台设备。

- 自动保存：桌面修改停止约 900ms 后；浏览器约 350ms 后。
- 手动保存：`Ctrl+S`。
- 窗口关闭或进入后台前会尝试刷新待保存数据。
- 删除的词与连接进入应用内废纸篓，可恢复。

建议同步整个 `.Wordverse` 文件夹。不要只同步临时文件，也不要同时让多个设备持续编辑同一份词库。

## 常用操作

| 操作 | 快捷键或手势 |
|---|---|
| 新建词 | 双击场景空白 / 工具栏 `+` |
| 重命名 | `F2` / 右键 |
| 连接 | `L`，点击目标词 |
| 连续连接 | `Shift+L` |
| 移动词 | 选中后拖动三轴 Gizmo |
| 聚焦所选或全图 | `F` |
| 进入子词网 | 双击词 |
| 返回或取消 | `Esc` |
| 空间游走 | `W/A/S/D` |
| 场景最大化 | `Space` |
| 删除所选 | `Delete` / `Backspace` |
| 撤销、重做 | `Ctrl+Z` / `Ctrl+Shift+Z` |
| 检索 | `Ctrl+K` |
| 快捷键设置 | `?`（也可在 Settings 分页中修改） |

## 验证与发布

```powershell
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
npm run desktop:build
```

`--no-bundle` 生成 `src-tauri\target\release\wordverse.exe`。完整构建使用 NSIS，安装器输出到 `src-tauri\target\release\bundle\nsis`。首次生成安装器需要从 Tauri 官方发布源下载 NSIS 工具链。

目前版本为早期本地预览版。正式发布前仍需完成大词网压力测试、安装器验证、签名与升级策略。
