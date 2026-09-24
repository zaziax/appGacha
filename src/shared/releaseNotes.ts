export const releases = [
  {
    version: '0.1.2',
    en: [
      'Experimental local MCP support: connect your own agent to build, check and preview new capsules. Authorized connections can install verified apps directly to the shelf. Enable it in Settings → External agents; it is off by default.',
      'Choose where your capsules and their data are stored. Directory changes take effect after a full restart, with an option to copy existing capsules while keeping the originals.',
      'Improved generation and repair with up-to-date project context, targeted file edits, isolated runtime checks and final delivery verification. Interrupted builds can retain progress for resuming; submitted regression checks cannot be removed or weakened.',
      'Clearer build progress: model explanations and file operations share one timeline, with elapsed time and waiting feedback.',
      'Safer cross-volume cloud replacement and directory recovery. Unavailable storage no longer blocks access to Settings or silently switches to the default library; build-related AI requests are blocked until storage is restored.',
      'Draft cleanup confirmations and storage warnings now use in-app dialogs, with improved keyboard focus and Escape behavior. System file and folder pickers are unchanged.',
    ],
    zh: [
      '新增实验性本地 MCP：连接自己的智能体，创建、检查和预览新扭蛋。授权连接可将验证通过的应用直接入柜；在设置 → 外部智能体中开启，默认关闭。',
      '支持自定义扭蛋及其数据的存储目录，完整重启后生效；可复制已有扭蛋并保留原目录。',
      '改进生成与修复链路：更新项目上下文、精准编辑文件、隔离运行检查并验证最终交付产物。中断时可保留进度用于续建，已提交的回归检查不能被删除或削弱。',
      '优化构建进度展示：模型说明与文件操作合并到同一时间线，展示已用时间和等待状态。',
      '加强跨盘云同步替换和目录恢复。目录不可用时仍可进入设置，不会静默切回默认库，并在恢复前阻止构建相关 AI 请求。',
      '草稿清理确认和目录警告统一使用应用内弹窗，改善键盘焦点及 Esc 行为；系统文件和目录选择器保持不变。',
    ],
  },
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
