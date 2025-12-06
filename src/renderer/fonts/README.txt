将 Windows 独占字体以 WOFF2 文件形式放置于本目录：

- Segoe UI：文件名 `segoe-ui.woff2`
- 微软雅黑（Microsoft YaHei）：文件名 `microsoft-yahei.woff2`

注意事项：
- 这些字体通常为微软许可字体，请确认具备合法分发/嵌入授权后再随应用分发。
- 应用已在 `src/renderer/fonts-local.css` 声明 `@font-face`，若系统存在本地字体则优先使用本地；若无，则加载本目录内同名 WOFF2。
- 未提供字体文件时，应用将回退到 `system-ui/Roboto/Arial` 等通用字体，功能不受影响。
