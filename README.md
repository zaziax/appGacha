<p align="center">
  <img src="assets/icon.png" alt="AppGacha" width="128" height="128" />
</p>

<h1 align="center">AppGacha</h1>
<h3 align="center">Gacha Machine for Desktop Apps</h3>

<p align="center">
  <a href="README.md">EN</a>
  &nbsp;·&nbsp;
  <a href="README.zh-CN.md">CN</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-37.2-blue?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4.3-blue?logo=tailwindcss" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Three.js-0.185-blue?logo=three.js" alt="Three.js" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## What is this?

AppGacha is a desktop app that turns natural language wishes into real, runnable desktop applications — called **eggs** (`.gacha` folder). You describe what you want, an AI agent pipeline builds it, and the egg runs in a sandboxed environment with its own database, file system, and AI capabilities. Copy the egg folder to another device with AppGacha installed, and it just works.

> 🥚 **What is an egg?** One `.gacha` folder = one complete desktop app. It contains `manifest.json` (identity + permissions), HTML/CSS/JS (functionality), and `data/` (persistent storage). Pure web technologies, zero Node.js dependencies, zero build steps. Migration is copy-paste.

### Why "Gacha"?

The gacha metaphor sets the right expectation: results have an element of randomness, and if you're not happy with what you get, you can always spin again. It's a product decision that acknowledges AI generation isn't perfect — and that's okay.

## Features

### For Users

- **Wishing Well** — Describe the app you want in natural language. The AI asks clarifying questions, then builds it.
- **Shelf** — All your eggs in one place. 3D capsule previews with idle animations, one-click open, drag-to-reorder.
- **GachaSpace** — Pin eggs into a multi-tab workspace inside the shelf window. No taskbar clutter.
- **Widget Mode** — Transparent, frameless, always-on-top desktop widgets. Pomodoro timers, sticky notes, countdowns — real desktop presence.
- **Cloud Sync (Pro)** — Per-egg sync with independent status. Open an egg → auto-pull latest. Close it → auto-push changes. Toggle sync on/off per egg.
- **LAN Multiplayer** — Eggs auto-discover each other on the local network. Real-time P2P battles, collaboration, data sharing — no server needed.
- **System Tray & Notifications** — Eggs can schedule reminders via cron. Notifications survive app restart. Click a notification to open the egg.
- **Import / Export** — `.gacha` files (ZIP) for sharing. Double-click to install. Export with or without data.

### For Developers

- **Open `.gacha` Specification** — Pure HTML/CSS/JS (ES Modules). No build tools. Anyone can hand-craft an egg. See [egg-spec.md](docs/egg-spec.md).
- **Bridge API v1** — 8 permissioned capability domains + 2 permissionless UI ops, all async, all type-declared in `egg.d.ts`:

  | Domain | Permission | API |
  |---|---|---|
  | AI | `ai` | `egg.ai.chat()` / `egg.ai.extract()` |
  | Database | `db` | `egg.db.query()` / `egg.db.exec()` (SQLite) |
  | Storage | `storage` | `egg.storage.get()` / `set()` / `delete()` (JSON KV) |
  | Files | `fs` | `egg.fs.read()` / `write()` / `list()` (sandboxed to `data/`) |
  | Notifications | `notify` | `egg.notify.send()` |
  | Scheduler | `schedule` | `egg.schedule.set()` / `cancel()` / `list()` (cron, max 20) |
  | Window | `window` | `egg.window.setAlwaysOnTop()` / `setSize()` |
  | Network | `network` | `egg.net.createRoom()` / `findRooms()` / `joinRoom()` (WebRTC P2P) |
  | UI (no perm) | — | `egg.ui.toast()` / `confirm()` / `pickFile()` / `saveFile()` |
  | Shell (no perm) | — | `egg.minimize()` / `maximize()` / `close()` |

- **Template + Scaffolding** — Eggs start from a template with a desktop-app-shell design system (`base.css`), Lucide icon sprite (~2,000 icons), and pre-installed vendor ESM libraries:
  - Three.js — 3D rendering
  - Chart.js — charts and graphs
  - marked — Markdown parsing
  - qrcode — QR code generation
  - canvas-confetti — celebration effects
  - dayjs — date utilities

- **Dual Validation** — `validate_egg` (static: manifest schema, forbidden APIs, emoji ban, external URL detection, CSP check, JS syntax check) → `test_egg` (headless run + screenshot + console error collection). Up to 3 repair rounds before failing.

- **Function-Calling Driver** — Custom `fcDriver` with 6 tools (`list_files`, `read_file`, `read_guide`, `write_file`, `check_egg`, `finish`), SSE streaming with stall detection, context window compaction, and budget guardrails (60 turns / 300k tokens / 15 min).

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Windows 10+**

### Install & Run

```powershell
git clone https://github.com/appgacha/appgacha.git
cd appgacha
npm install
npm start              # Full build (tsc + vite) → launch Electron
```

### Dev Mode

```powershell
npm run dev:ui         # Terminal 1: Vite dev server (hot reload for shelf UI)
npm run dev            # Terminal 2: Electron connected to dev server
```

### Smoke Test

```powershell
npm run smoke
# Headless verification: egg bridge pipeline + shelf + failure/upgrade pipelines
```

### Package

```powershell
npm run dist           # NSIS installer (Windows)
```

### China Mirror Setup

If npm installs fail on native binaries in mainland China:

```powershell
# Electron binary — download manually and skip download in install.js:
# https://npmmirror.com/mirrors/electron/37.2.0/electron-v37.2.0-win32-x64.zip

# better-sqlite3 (needs Electron ABI 136) — download and extract:
# https://registry.npmmirror.com/-/binary/better-sqlite3/v<ver>/better-sqlite3-v<ver>-electron-v136-win32-x64.tar.gz
```

## Architecture

```
┌────────────────── AppGacha (Electron) ───────────────────────────┐
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Shelf UI        │  │  GachaSpace      │  │  Egg Windows    │  │
│  │  React + Vite    │  │  (multi-tab)     │  │  (standalone)   │  │
│  │                  │  │  WebContentsView │  │  BrowserWindow  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │
│           │                     │                      │          │
│  ┌────────┴─────────────────────┴──────────────────────┴────────┐ │
│  │                    preload + Bridge API                        │ │
│  │  ai · db (SQLite) · storage · fs · notify · schedule          │ │
│  │  window · network (WebRTC P2P) · ui (toast/dialogs)           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  Gacha Core     │  │  Egg Manager   │  │  Auth + Sync       │  │
│  │  fcDriver       │  │  install       │  │  Google OAuth      │  │
│  │  validate_egg   │  │  export/import │  │  Email login       │  │
│  │  test_egg       │  │  upgrade       │  │  Per-egg cloud     │  │
│  │  pipeline       │  │  rollback      │  │  Pro billing       │  │
│  └────────────────┘  └────────────────┘  └───────────────────┘  │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  Scheduler      │  │  Widget Ctrl    │  │  Auto Updater      │  │
│  │  cron reminders │  │  satellite win  │  │  electron-updater  │  │
│  │  click-to-open  │  │  drag/pin/close │  │  GitHub Releases   │  │
│  └────────────────┘  └────────────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
         │                                                   │
         ▼                                                   ▼
   ┌──────────┐                                  ┌──────────────────┐
   │  .gacha dir│                                  │  AppGacha Server  │
   │  Local FS │                                  │  FastAPI + PG 16  │
   └──────────┘                                  │  api.appgacha.com │
                                                 └──────────────────┘
```

### Generation Pipeline

```
Wish (natural language)
   │
   ▼
① Coin (投币)      Copy template scaffold → staging/<eggId>/
   │                Pipeline writes protected manifest fields
   ▼
② Crank (旋钮)     fcDriver: custom function-calling loop
   │                Tools: list_files / read_file / read_guide /
   │                       write_file / check_egg / finish
   │                Budget: 60 turns / 300k tokens / 15 min
   ▼
③ Clack (咔咔)     validate_egg (static checks) →
   │                test_egg (headless run + screenshot + console)
   │                Failures fed back to agent, max 3 rounds
   ▼
④ Pop (咔哒)       Pass → atomic move to eggs/<name>.gacha/
                    Exceeded → archive to staging/failed/
```

### AI Model Path

Egg generation and egg AI calls support two channels:

| Channel | How It Works |
|---|---|
| **Direct** | User provides their own OpenAI-compatible API key (DeepSeek, Kimi, Qwen, etc.). Key encrypted via Windows DPAPI (`safeStorage`). |
| **Proxy** | Platform backend proxies requests, deducting credits from user's account. No key needed on device. |

Both channels use the same `AiEndpoint` abstraction — the rest of the system doesn't care which path is active.

## Project Structure

```
appGacha/
├── src/
│   ├── main/                    # Electron main process (35 .ts files)
│   │   ├── index.ts             #   Entry, single-instance lock, CLI routing, quit sync
│   │   ├── pipeline.ts          #   Gacha pipeline (coin→crank→clack→pop)
│   │   ├── fcDriver.ts          #   Custom function-calling loop (6 tools, SSE, context compaction)
│   │   ├── validate.ts          #   Static egg validation (schema, forbidden APIs, emoji, CSP)
│   │   ├── test.ts              #   Runtime egg testing (headless + screenshot + console)
│   │   ├── aiChannel.ts         #   AI dual-channel: direct API key vs platform proxy
│   │   ├── sync.ts              #   Per-egg cloud sync (hash→plan→upload/download/skip)
│   │   ├── auth.ts              #   Google OAuth + email code + password login, JWT mgmt
│   │   ├── api.ts               #   Unified HTTP client with auto token refresh
│   │   ├── eggs.ts              #   Egg registry (discover, register, remove, loadManifest)
│   │   ├── eggWindow.ts         #   Egg window factory (frameless, sandboxed, per-egg partition)
│   │   ├── space.ts             #   GachaSpace: WebContentsView-based multi-tab workspace
│   │   ├── shelf.ts             #   Shelf IPC handlers (50+ operations)
│   │   ├── shelfWindow.ts       #   Shelf window lifecycle (dev server vs built dist)
│   │   ├── protocol.ts          #   egg:// custom protocol + session lockdown
│   │   ├── settings.ts          #   Persistent settings (AI keys, per-egg flags, categories, space)
│   │   ├── gachaPkg.ts          #   .gacha ZIP pack/unpack with path traversal protection
│   │   ├── schedule.ts          #   Cron-based egg reminders (cron-parser, max 20/egg)
│   │   ├── widgetControls.ts    #   Widget satellite control window (grip/pin/close)
│   │   ├── tray.ts              #   System tray icon + context menu
│   │   ├── updater.ts           #   Auto-updater (electron-updater, GitHub Releases)
│   │   ├── smoke.ts             #   Smoke tests (bridge + shelf + pipeline + upgrade)
│   │   ├── wishGuide.ts         #   Wish chat AI prompt assembly
│   │   ├── assoc.ts             #   File association + protocol registration (Windows)
│   │   ├── registry.ts          #   WebContents → egg mapping for permission checks
│   │   ├── log.ts               #   Logging + crash reporter
│   │   ├── i18n.ts              #   Main-process i18n (tray menu, window title: en/zh)
│   │   ├── paths.ts             #   Path helpers (dataRoot, appRoot)
│   │   ├── fsutil.ts            #   copyDir (avoids Node 22 fs.cpSync emoji-path crash)
│   │   ├── ico.ts               #   ICO encoding for egg-specific icons
│   │   ├── capabilities/        #   Bridge API implementations
│   │   │   ├── index.ts         #     IPC handler registration + permission checks
│   │   │   ├── storage.ts       #     JSON KV store (file-backed)
│   │   │   ├── db.ts            #     SQLite via better-sqlite3
│   │   │   ├── ai.ts            #     AI chat + extract (rate-limited: 20/min/egg)
│   │   │   └── fsx.ts           #     Sandboxed file I/O (data/ only)
│   │   └── net/                 #   LAN multiplayer (P2P WebRTC)
│   │       ├── coordinator.ts   #     Room management (create/join/broadcast/close)
│   │       ├── discovery.ts     #     UDP multicast discovery
│   │       ├── rtcHost.ts       #     Hidden BrowserWindow hosting WebRTC connections
│   │       └── signaling.ts     #     Signaling protocol
│   ├── preload/                 # Preload scripts (bridge injection + UI chrome)
│   │   ├── index.ts             #   Bridge API exposure, titlebar injection, toast/confirm UI
│   │   └── shelf.ts             #   Shelf-specific bridge
│   ├── shared/                  # Types shared between main ↔ renderer
│   └── ui/                      # Shelf UI (React + Vite + Tailwind CSS)
│       ├── src/
│       │   ├── App.tsx          #   Root: state management, cloud sync, i18n
│       │   ├── config/          #   Constants
│       │   ├── i18n/            #   i18next resources (zh / en)
│       │   └── components/      #   18 components
│       │       ├── EggCard.tsx          # Egg card with 3D capsule + cloud status
│       │       ├── Capsule3D.tsx        # Three.js gacha capsule scene
│       │       ├── GachaMachine3D.tsx   # 3D gacha machine (wishing interface)
│       │       ├── MachineView.tsx      # Machine view layout
│       │       ├── GachaVisual.tsx      # Generation progress visualization
│       │       ├── GachaCapsule.tsx     # Animated capsule during generation
│       │       ├── GachaOrb.tsx         # Decorative orb element
│       │       ├── SpaceView.tsx        # GachaSpace multi-tab workspace
│       │       ├── ShelfToolbar.tsx     # Toolbar (search, filter, settings)
│       │       ├── LoginDialog.tsx      # OAuth + email login
│       │       ├── SettingsDialog.tsx   # AI keys, app preferences
│       │       ├── ExportDialog.tsx     # Export egg as .gacha
│       │       ├── ConfirmDialog.tsx    # Styled confirmation modal
│       │       ├── ClosePromptDialog.tsx # Close behavior prompt (tray vs quit)
│       │       ├── Toast.tsx            # Toast notification
│       │       ├── TitleBar.tsx         # Custom frameless titlebar
│       │       ├── UserPanel.tsx        # User account panel
│       │       └── GachaMachineV5.tsx   # Gacha machine variant
│       └── vite.config.ts
├── template/                    # Egg scaffold (copied to staging/ for each generation)
│   ├── manifest.json            #   Placeholder manifest
│   ├── index.html               #   Entry HTML shell
│   ├── app.js                   #   Blank entry module
│   ├── style.css                #   Custom styles placeholder
│   ├── base.css                 #   Desktop app-shell design system (CSS variables, components)
│   ├── egg.d.ts                 #   Bridge API TypeScript declarations
│   ├── EGG_GUIDE.md             #   Agent handbook: rules, layout, icon spec, vendor libs
│   ├── icons.svg                #   Lucide SVG sprite (1000+ icons)
│   ├── icons-manifest.json      #   Available icon names catalog
│   └── vendor/                  #   Pre-installed ESM libraries (no network needed)
│       ├── three.module.js      #     Three.js
│       ├── chart.esm.js         #     Chart.js
│       ├── marked.esm.js        #     Markdown parser
│       ├── qrcode.esm.js        #     QR code generator
│       ├── canvas-confetti.esm.js #   Confetti effects
│       └── dayjs.esm.js         #     Date utilities
│   └── guides/                   #   Topic guides loaded by read_guide tool
│       └── net-lan/              #     LAN multiplayer patterns for AI agent
├── assets/                      # App icon + static resources
├── docs/                        # Design documents
│   ├── design.md                #   Architecture decisions & trade-offs
│   ├── egg-spec.md              #   .gacha format specification & Bridge API
│   ├── gacha-core.md            #   Gacha engine design
│   ├── runtime.md               #   Egg runtime: sandbox, protocol, security
│   ├── desktop-value.md         #   Desktop value proposition
│   └── server-architecture.md   #   Server architecture (not open source)
├── package.json
└── LICENSE
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Shell | Electron 37 |
| Shelf UI | React 19 + TypeScript 5.5 + Vite 8 + Tailwind CSS 4 |
| 3D Rendering | Three.js + @react-three/fiber + @react-three/drei |
| Animation | Motion (Framer Motion) |
| Local Database | better-sqlite3 |
| i18n | i18next + react-i18next |
| Cron Parser | cron-parser |
| Archiving | yazl + yauzl (ZIP) |
| Updater | electron-updater |
| Icons | Lucide React |
| Server (private) | Python FastAPI + PostgreSQL 16 + Docker Compose |

## Egg Window Types

Eggs declare their window type in `manifest.json` (`window.type`). The manifest supports two values:

| Type | Description | Titlebar | Use Case |
|---|---|---|---|
| **standard** | Frameless window with injected custom titlebar | ✅ Auto-injected | Most eggs |
| **widget** | Transparent, frameless, always-on-top. Satellite control window for drag/pin/close. | ❌ None | Pomodoro, sticky notes, clocks |

Additionally, eggs pinned to the **GachaSpace** are rendered as embedded `WebContentsView` inside the shelf window — this is a host-level feature, not a manifest `window.type` value.

## Roadmap

| Milestone | Status | Description |
|---|---|---|
| **M1** Egg Runtime | ✅ Done | egg:// protocol, sandbox, permission model, sample egg |
| **M2** Capabilities + Shelf | ✅ Done | 8 bridge API domains, basic shelf UI, model config (direct + proxy) |
| **M3** Gacha Core | ✅ Done | Custom fcDriver, dual validation (validate + test), live progress, background pending |
| **M3.5** Wish Upgrade | ✅ Done | Full backup, incremental evolution, data migration, atomic swap, rollback |
| **M4** Shelf Polish | ✅ Done | 3D gacha machine (4th-gen), spring animations, HSL color picker, drag-drop space, sound effects, i18n (zh/en, 344 keys each) |
| **M5** Golden Wishes | 🔜 Next | ~10 standard wishes as regression benchmark for egg quality |
| **M6** Cross-platform | 📋 Planned | macOS / Linux support |

## Documentation

| Document | Description |
|---|---|
| [Design Overview](docs/design.md) | Architecture decisions, trade-offs, decision records (D1–D10) |
| [.gacha Spec & Bridge API](docs/egg-spec.md) | The contract anchor — runtime, generator, and manager all conform to this |
| [Egg Runtime](docs/runtime.md) | Sandbox isolation, egg:// protocol, permission enforcement |
| [Gacha Core](docs/gacha-core.md) | Generation pipeline, fcDriver, validation tools |
| [Desktop Value](docs/desktop-value.md) | Product direction: why desktop-native is the moat |
| [Server Architecture](docs/server-architecture.md) | Backend design (not open source) |

## FAQ

<details>
<summary><b>Why independent BrowserWindow instead of iframe/webview?</b></summary>

Independent windows give each egg its own taskbar icon, Alt-Tab, and window controls — this is the "real desktop app" promise. Separate render processes provide natural isolation. See [runtime.md](docs/runtime.md).
</details>

<details>
<summary><b>Why a custom function-calling loop instead of an Agent SDK?</b></summary>

Hard constraint: all capabilities must be self-contained. Users cannot be expected to have any runtime pre-installed. Agent SDKs require a local Node/CLI environment. The custom `fcDriver` runs entirely inside Electron's main process. See [design.md D2'](docs/design.md#d2-修订自研微型机芯自建-function-calling-循环agent-sdk-出局).
</details>

<details>
<summary><b>Can eggs access the internet?</b></summary>

No by default. Each egg's session is locked after load — only `egg://` protocol and bridge API calls are allowed. External HTTP requests are blocked. Vendor libraries (`template/vendor/`) are pre-installed so eggs can use Three.js, Chart.js, etc. without network access.
</details>

<details>
<summary><b>How do I hand-craft an egg?</b></summary>

See [egg-spec.md](docs/egg-spec.md). The short version: create a folder `my-app.gacha/`, write `manifest.json` (declare permissions), write `index.html` (use `egg.*` bridge APIs), drop it into the eggs directory. No build tools needed.
</details>

<details>
<summary><b>What AI models are supported?</b></summary>

Any OpenAI-compatible API: DeepSeek, Kimi, Qwen, GPT-4, etc. Configure base URL + model name + API key in Settings. The platform also offers a proxy channel with managed billing.
</details>

## Contributing

Contributions welcome. The project is in early stage. Key areas:

- 🐛 Bug reports & fixes
- 📝 Documentation improvements
- 🧪 Golden wish set (standard test cases for regression)
- 🌐 i18n contributions
- 🎨 Egg template & `base.css` design system

Please open an issue before submitting a PR.

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Made with 🥚 by AppGacha</sub>
</p>
