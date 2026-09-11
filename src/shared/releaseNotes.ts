export const releases = [
  {
    version: '0.1.1',
    en: [
      'Desktop shortcuts open the selected egg without bringing up the main window, including when AppGacha is not running.',
      'Egg windows display their own icons. Missing icons use a fallback.',
      'Version history is available in Settings, and update prompts include release notes. Restarting to update is blocked during a build.',
      'Minimal usage statistics help diagnose first builds and return visits. They are enabled by default after the announced effective date and can be disabled at any time; no prompts, code, API keys or egg data are sent.',
    ],
    zh: [
      '通过桌面快捷方式打开扭蛋时，不再同时弹出主窗口，包括程序尚未运行的情况。',
      '扭蛋窗口显示自己的图标；缺失图标时自动回退。',
      '设置中可查看版本历史，更新提示展示改动内容，构建期间禁止重启安装。',
      '新增最小化使用统计，帮助了解首次构建与回访。公告生效日后默认开启，可随时关闭；不发送提示词、代码、API 密钥或扭蛋数据。',
    ],
  },
  {
    version: '0.1.0',
    en: ['Initial public release for Windows x64 and macOS Apple Silicon.', 'Build local desktop apps and widgets with your own AI provider or optional platform credits.'],
    zh: ['首次公开发布，支持 Windows x64 和 macOS Apple Silicon。', '使用自带 AI 服务或可选的平台积分，构建本地桌面应用和悬浮组件。'],
  },
]
