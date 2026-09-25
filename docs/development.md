# Development guide

[← Product overview](../README.md) · [简体中文](development.zh-CN.md)

Build commands below run from the repository root. This guide keeps the technical reference separate from the product introduction. The source tree is an orientation map, not an exhaustive inventory; see [MCP](mcp.md), [storage](egg-storage.md) and [generation quality](generation-quality.md) for newer subsystems.

## Capsule capabilities

- **Open `.gacha` Specification** — Pure HTML/CSS/JS (ES Modules). No build tools. Anyone can hand-craft an egg. See [egg-spec.md](egg-spec.md).
- **Bridge API v1** — 9 permissioned capability domains + 2 permissionless UI ops, all async, all type-declared in `egg.d.ts`:

  | Domain | Permission | API |
  |---|---|---|
  | AI | `ai` | `egg.ai.chat()` / `egg.ai.extract()` |
  | Database | `db` | `egg.db.query()` / `egg.db.exec()` (SQLite) |
  | Storage | `storage` | `egg.storage.get()` / `set()` / `delete()` (JSON KV) |
  | Files | `fs` | `egg.fs.read()` / `write()` / `list()` / `readBytes()` / `writeBytes()` (sandboxed to `data/`) |
  | ZIP | `zip` | `egg.zip.create()` / `egg.zip.extract()` |
  | Notifications | `notify` | `egg.notify.send()` |
  | Scheduler | `schedule` | `egg.schedule.set()` / `cancel()` / `list()` (cron, max 20) |
  | Window | `window` | `egg.window.setAlwaysOnTop()` / `setSize()` |
  | Network | `network` | `egg.net.createRoom()` / `findRooms()` / `joinRoom()` / `broadcast()` / `close()` (WebRTC P2P) |
  | UI (no perm) | — | `egg.ui.toast()` / `confirm()` / `pickFile()` / `saveFile()` / `pickBinary()` / `saveBinary()` |
  | Shell (no perm) | — | `egg.minimize()` / `maximize()` / `close()` |

- **Template + Scaffolding** — Eggs start from a template with a desktop-app-shell design system (`base.css`), a Lucide icon sprite, and pre-installed vendor ESM libraries (no network needed):

  | Category | Libraries |
  |---|---|
  | 3D / Graphics | Three.js, p5.js, matter.js |
  | Charts / Documents | Chart.js, KaTeX, ExcelJS, pdfmake |
  | Utilities | marked, qrcode, canvas-confetti, dayjs, anime.js, js-yaml, jsdiff, Tone.js |

- **Validation** — Static checks and isolated runtime checks cover structure, startup and submitted interaction scenarios. Final delivery is revalidated after resource pruning. Passing these checks is not a guarantee of complete business correctness. See [generation quality](generation-quality.md).

- **Function-Calling Driver** — The built-in generator uses `fcDriver` for planning, indexed file reads, search, writes, hash-checked edits, checks and completion. It supports streaming, context compaction, checkpoints and bounded truncation recovery. The current per-run guardrails are 60 turns, 300,000 cumulative output tokens and 15 minutes; input tokens are not part of that output guardrail. See [generation quality](generation-quality.md) for accounting and recovery boundaries.

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Windows 10/11 x64** or **macOS on Apple silicon**

### Install & Run

```powershell
git clone https://github.com/zaziax/appGacha.git
cd appGacha
npm install
npm start              # Full build (tsc + vite) → launch Electron (Windows)
npm run start:mac      # macOS
```

### Dev Mode

```powershell
npm run dev:ui         # Terminal 1: Vite dev server (hot reload for shelf UI)
npm run dev            # Terminal 2: Electron connected to dev server
```

### Smoke Test & Golden Wishes

```powershell
npm run smoke          # Headless verification: egg bridge pipeline + shelf + failure/upgrade pipelines
npm run test           # Unit tests (Vitest)
npm run typecheck      # Main process, UI and test TypeScript checks
npm run test:runtime   # Isolated Electron runtime checks
npm run test:dialogs   # In-app confirmation dialog interactions
npm run test:mcp       # Real stdio MCP authoring, checks and installation
npm run golden:fake    # Golden wish regression — full gacha→probe run (fake AI)
npm run golden         # Golden wish regression (real AI)
```

### Package

```powershell
npm run pack           # Unpacked build (Windows)
npm run dist           # Unsigned NSIS installer (Windows x64)
npm run dist:mac       # Local signed + notarized DMG/ZIP (macOS Apple silicon)
```

`dist:mac` requires a Developer ID Application certificate in the macOS Keychain and the Apple notarization API credentials configured in `.env`. It creates local artifacts in `release/` and does not upload them to GitHub automatically.

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
│  │  ai · db (SQLite) · storage · fs · zip · notify · schedule    │ │
│  │  window · network (WebRTC P2P) · ui (toast/dialogs)           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  Gacha Core     │  │  Egg Manager   │  │  Auth              │  │
│  │  fcDriver       │  │  install       │  │  Google OAuth      │  │
│  │  validate_egg   │  │  export/import │  │  Email login       │  │
│  │  test_egg       │  │  upgrade       │  │                    │  │
│  │  pipeline       │  │  rollback      │  │                    │  │
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

1. Copy the template into an isolated staging workspace.
2. Use the live project index and workspace tools to build the requested app.
3. Run static, startup and submitted interaction checks; feed diagnostics back for repair.
4. Prune resources and revalidate the final delivery directory before installation.
5. Preserve recoverable interrupted work as a checkpoint rather than reporting success.

External MCP authoring has a separate orchestrator but shares workspace safety and validation. See [MCP](mcp.md) and [generation quality](generation-quality.md) for the current behavior and limits.

### AI Model Path

AppGacha offers two AI paths: managed AI through the optional account service, or bring-your-own-key access to OpenAI-compatible providers such as DeepSeek, OpenAI, Kimi, and Qwen. BYOK credentials are encrypted on-device with Electron `safeStorage` (Windows DPAPI / macOS Keychain) and are not uploaded to AppGacha.

## Project Structure

```
appGacha/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             #   Entry, single-instance lock, CLI routing, quit sync
│   │   ├── pipeline.ts          #   Gacha pipeline (coin→crank→clack→pop)
│   │   ├── fcDriver.ts          #   Custom function-calling loop (workspace tools, SSE, context compaction)
│   │   ├── validate.ts          #   Static egg validation (schema, forbidden APIs, emoji, CSP)
│   │   ├── test.ts              #   Runtime egg testing (headless + screenshot + console)
│   │   ├── aiChannel.ts         #   Managed AI + BYOK channel (safeStorage-encrypted credentials)
│   │   ├── auth.ts              #   Google OAuth + email code + password login, JWT mgmt
│   │   ├── api.ts               #   Unified HTTP client with auto token refresh
│   │   ├── eggs.ts              #   Egg registry (discover, register, remove, loadManifest)
│   │   ├── eggWindow.ts         #   Egg window factory (frameless, sandboxed, per-egg partition)
│   │   ├── eggDoc.ts            #   Egg structure snapshot (Markdown) for upgrade
│   │   ├── space.ts             #   GachaSpace: WebContentsView-based multi-tab workspace
│   │   ├── shelf.ts             #   IPC registration barrel — re-exports domain registrars from channels/
│   │   ├── shelfWindow.ts       #   Shelf window lifecycle (dev server vs built dist)
│   │   ├── protocol.ts          #   egg:// custom protocol + session lockdown
│   │   ├── settings.ts          #   Persistent settings (AI keys, per-egg flags, categories, space)
│   │   ├── gachaPkg.ts          #   .gacha ZIP pack/unpack with path traversal protection
│   │   ├── schedule.ts          #   Cron-based egg reminders (cron-parser, max 20/egg)
│   │   ├── widgetControls.ts    #   Widget satellite control window (grip/pin/close)
│   │   ├── widgetPlacement.ts   #   Widget window placement / persistence
│   │   ├── tray.ts              #   System tray icon + context menu
│   │   ├── menu.ts              #   macOS minimal native menu
│   │   ├── updater.ts           #   Auto-updater (electron-updater, GitHub Releases)
│   │   ├── smoke.ts             #   Smoke tests (bridge + shelf + pipeline + upgrade)
│   │   ├── golden.ts            #   Golden wishes regression benchmark
│   │   ├── wishGuide.ts         #   Wish chat AI prompt assembly
│   │   ├── assoc.ts             #   File association + protocol registration (Windows)
│   │   ├── registry.ts          #   WebContents → egg mapping for permission checks
│   │   ├── log.ts               #   Logging + crash reporter
│   │   ├── i18n.ts              #   Main-process i18n (tray menu, window title: en/zh)
│   │   ├── paths.ts             #   Path helpers (dataRoot, appRoot)
│   │   ├── fsutil.ts            #   copyDir (avoids Node 22 fs.cpSync emoji-path crash)
│   │   ├── ico.ts               #   ICO encoding for egg-specific icons
│   │   ├── channels/            #   Shelf IPC registrars, split by domain
│   │   │   ├── ipc.ts           #     Shared handle() wrapper (sender gate + {ok,value}/{ok,error})
│   │   │   ├── eggChannels.ts   #     Egg list/open/import/export/trash/rollback
│   │   │   ├── gachaChannels.ts #     Wish/upgrade/cancel/resume + wishChat AI
│   │   │   ├── settingsChannels.ts #  AI settings / models / app settings / categories
│   │   │   ├── spaceChannels.ts #     Space add/remove/reorder/activate/bounds
│   │   │   ├── authChannels.ts  #     Auth status/login/logout/code/password
│   │   │   ├── updateChannels.ts #    Check/status/install update
│   │   │   └── windowChannels.ts #    Window controls + state events
│   │   ├── capabilities/        #   Bridge API implementations
│   │   │   ├── index.ts         #     IPC handler registration + permission checks
│   │   │   ├── storage.ts       #     JSON KV store (file-backed)
│   │   │   ├── db.ts            #     SQLite via better-sqlite3
│   │   │   ├── dbGuard.ts       #     SQL safety guardrails (forbidden SQL, row/byte caps)
│   │   │   ├── dbWorker.ts      #     SQLite worker thread
│   │   │   ├── ai.ts            #     AI chat + extract (rate-limited: 20/min/egg)
│   │   │   ├── fsx.ts           #     Sandboxed file I/O (data/ only)
│   │   │   └── zip.ts           #     In-memory ZIP create/extract
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
│       │   ├── App.tsx          #   Root: state management, i18n
│       │   ├── config/          #   Constants (provider icons)
│       │   ├── i18n/            #   i18next resources (zh / en)
│       │   └── components/
│       │       ├── EggCard.tsx          # Egg card with 3D capsule
│       │       ├── Capsule3D.tsx        # Three.js gacha capsule scene
│       │       ├── GachaMachine3D.tsx   # 3D gacha machine (wishing interface)
│       │       ├── GachaMachineV5.tsx   # Gacha machine variant
│       │       ├── MachineView.tsx      # Machine view layout
│       │       ├── GachaShowcase3D.tsx  # 3D showcase scene
│       │       ├── AppAssemblyStage.tsx # App assembly progress stage
│       │       ├── SpaceView.tsx        # GachaSpace multi-tab workspace
│       │       ├── ShelfToolbar.tsx     # Toolbar (search, filter, settings)
│       │       ├── LoginDialog.tsx      # OAuth + email login
│       │       ├── SettingsDialog.tsx   # AI keys, app preferences
│       │       ├── ExportDialog.tsx     # Export egg as .gacha
│       │       ├── UpdateDialog.tsx     # Update available / progress
│       │       ├── ConfirmDialog.tsx    # Styled confirmation modal
│       │       ├── ClosePromptDialog.tsx # Close behavior prompt (tray vs quit)
│       │       ├── ErrorBoundary.tsx    # Render error boundary
│       │       ├── Toast.tsx            # Toast notification
│       │       ├── TitleBar.tsx         # Custom frameless titlebar
│       │       └── UserPanel.tsx        # User account panel
│       └── vite.config.ts
├── template/                    # Egg scaffold (copied to staging/ for each generation)
│   ├── manifest.json            #   Placeholder manifest
│   ├── index.html               #   Entry HTML shell
│   ├── app.js                   #   Blank entry module
│   ├── style.css                #   Custom styles placeholder
│   ├── base.css                 #   Desktop app-shell design system (CSS variables, components)
│   ├── widget.css               #   Widget-mode styles
│   ├── widget.js                #   Widget-mode entry
│   ├── egg.d.ts                 #   Bridge API TypeScript declarations
│   ├── EGG_GUIDE.md             #   Agent handbook: rules, layout, icon spec, vendor libs
│   ├── icons.svg                #   Icon sprite
│   ├── icons-manifest.json      #   Available icon names catalog
│   ├── vendor/                  #   Pre-installed ESM libraries (no network needed)
│   │   ├── three.module.js      #     Three.js
│   │   ├── chart.esm.js         #     Chart.js
│   │   ├── marked.esm.js        #     Markdown parser
│   │   ├── qrcode.esm.js        #     QR code generator
│   │   ├── canvas-confetti.esm.js #   Confetti effects
│   │   ├── dayjs.esm.js         #     Date utilities
│   │   ├── anime.esm.js         #     Anime.js
│   │   ├── jsyaml.esm.js        #     YAML parser
│   │   ├── p5.esm.js            #     p5.js
│   │   ├── katex.esm.js         #     KaTeX math rendering
│   │   ├── exceljs.esm.js       #     ExcelJS
│   │   ├── math.esm.js          #     Math.js
│   │   ├── pdfmake.esm.js       #     pdfmake
│   │   ├── jsdiff.esm.js        #     Text diff
│   │   ├── matter.esm.js        #     Matter.js physics
│   │   └── tone.esm.js          #     Tone.js audio
│   └── guides/                  #   Topic guides loaded by read_guide tool
│       └── net-lan/             #     LAN multiplayer patterns for AI agent
├── assets/                      # App icon + static resources
├── docs/                        # Design documents
│   ├── design.md                #   Architecture decisions & trade-offs
│   ├── egg-spec.md              #   .gacha format specification & Bridge API
│   ├── gacha-core.md            #   Gacha engine design
│   ├── runtime.md               #   Egg runtime: sandbox, protocol, security
│   ├── desktop-value.md         #   Desktop value proposition
│   ├── server-architecture.md   #   Server architecture (not open source)
│   ├── threat-model.md          #   Security threat model & mitigations
│   ├── vendor-roadmap.md        #   Vendor library roadmap
│   └── project-assessment-report.md # Project assessment report
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
| Testing | Vitest |
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

## Further reading

- [Design decisions](design.md)
- [Capsule specification and bridge API](egg-spec.md)
- [Runtime](runtime.md) and [threat model](threat-model.md)
- [Gacha core](gacha-core.md) and [generation quality](generation-quality.md)
- [Desktop value](desktop-value.md)
- [Hosted server architecture](server-architecture.md) (backend not open source)
- [Vendor roadmap](vendor-roadmap.md)
- [Project assessment](project-assessment-report.md)
- [Release checklist](release-manual-checklist.md)
