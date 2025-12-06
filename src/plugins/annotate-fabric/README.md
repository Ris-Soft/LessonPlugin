# annotate-fabric 插件

该仓库包含 OrbiBoard 主程序的 annotate-fabric 插件源码。

用法
- 将本目录作为独立 Git 仓库管理。
- 依赖请在 `plugin.json` 的 `npmDependencies` 或 `dependencies` 中声明，由主程序在运行时通过插件依赖管理安装。

开发
- 页面入口：`whiteboard.html`
- 后端入口：`index.js`

发布
- 不需要包含 `node_modules`；主程序会在运行时解析依赖。
