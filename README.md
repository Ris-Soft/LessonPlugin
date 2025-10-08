# LessonPlugin

基于 Electron 的以 JavaScript 为核心的插件化大屏课堂辅助工具。

> [!IMPORTANT]
> 本项目仍在开发中，功能与接口可能会有变动。
> 插件安装/依赖管理 等未经测试，当前版本仅供尝鲜

## 功能特性

- 精美启动页：展示插件加载状态日志。
- 系统托盘：支持从托盘打开设置窗口、退出应用。
- 插件管理：
  - 通过 `src/plugins/插件名称/plugin.json` 定义插件清单。
  - 支持本地插件加载与独立窗口创建。
  - 支持清单定义 NPM 包（未测试因此暂不显示）。
- 打包配置：使用 `electron-builder` 并禁用 ASAR（便于插件动态加载）。

## 插件清单格式（`src/plugins/插件名称/plugin.json`）

```json
{
  "name": "ExamplePlugin",
  "icon": "ri-puzzle-line",
  "description": "示例插件，演示窗口与接口",
  "actions": [
    { "id": "openWindow", "icon": "ri-window-line", "text": "打开窗口" }
  ]
}
```

- `name`: 插件名称（唯一）。
- `npm`: 可选，NPM 包名称（例如 `@org/plugin-name`）。
- `local`: 可选，本地插件路径相对于 `plugins.json`。
- `enabled`: 是否启用。

## 插件接口（示例）

本地或 NPM 插件需导出 `openWindow` 方法：

```js
module.exports = {
  name: 'MyPlugin',
  version: '1.0.0',
  async openWindow({ BrowserWindow, app, path }) {
    const win = new BrowserWindow({ width: 800, height: 600 });
    win.loadURL('https://example.com');
  }
};
```

设置页中点击“打开窗口”即会调用该方法。

## 常见问题

- 如果在 Windows 上安装 `electron` 失败：
  - 尝试清理缓存并重试：
    ```powershell
    Remove-Item -Recurse -Force node_modules; if (Test-Path package-lock.json) { Remove-Item -Force package-lock.json }; npm cache clean --force
    npm install
    ```
  - 检查网络代理或公司防火墙是否阻止 Electron 二进制下载。

## 项目概览

- 渲染层：`src/renderer` 包含设置页、样式与交互逻辑。
- 主进程：`src/main` 负责窗口、托盘、IPC、自动化与配置存储。
- 预加载：`src/preload` 暴露设置页可调用的 API（如配置读写、系统信息）。
- 插件：`src/plugins` 放置本地插件与配置清单。

## 开发与预览

要求：Node.js ≥ 18。

- 安装依赖：
  ```bash
  npm install
  ```
- 启动程序：
  ```bash
  npm run start

## 统一配置存储

- 路径：用户数据目录下 `LessonPlugin/config`（主进程 `store.js` 管理）。
- `system.json`：通用设置（如 `splashEnabled`、`preciseTimeEnabled`、`timeOffset`、`autoOffsetDaily`、`offsetBaseDate`、`semesterStart` 等）。
- `plugins/*.json`：插件私有配置。

`semesterStart` 用于自动化条件的单双周（biweek）判断；缺省时回退到 `offsetBaseDate`。

## 自动化

- 触发器：时间（HH:MM）、协议（`LessonPlugin://task/<text>`）。
- 条件组：AND/OR；支持时间等值、星期/月/日集合、单双周（基于 `semesterStart`）。
- 动作：
  - 插件功能：选择插件与事件；参数数组通过模态框结构化编辑（字符串/数字/布尔/对象JSON/数组JSON）。
  - 电源功能：关机/重启/注销。
  - 打开应用程序：指定可执行文件路径。
  - CMD：在 Shell 中执行命令。
- 执行前确认：可启用确认与超时（秒）。

## 贡献者

- PYLXU — 主程序开发
- 风吟残歌 — 主程序开发
- 小震 — LOGO设计

欢迎通过 Issue 或 Pull Request 参与贡献。

## 许可

本项目采用开源许可协议，详见 `LICENSE` 文件。