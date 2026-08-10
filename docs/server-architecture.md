# AppGacha Server 架构方案

> 独立后端项目，承载所有增值业务：登录、计费、模型代理、云同步、管理运维。
> 本项目不开源。

---

## 1. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 后端框架 | Python FastAPI | 异步原生、自动 OpenAPI 文档、SSE 流式转发自然 |
| 管理面板 | Vite + React + TypeScript | 与客户端 UI 技术栈一致，复用经验 |
| 数据库 | PostgreSQL 16 | 结构化关系数据、Alembic 迁移、JSON 字段灵活 |
| ORM | SQLAlchemy 2.0 (async) | 成熟生态、配合 asyncpg |
| 迁移 | Alembic | SQLAlchemy 官方配套 |
| 反向代理 | Nginx | SSL 终止、静态文件、路径分发 |
| SSL | Let's Encrypt + certbot | 自动续期 |
| 容器化 | Docker Compose | 一键部署 backend + admin + db + nginx |
| 文件存储 | 本地磁盘（初期）→ MinIO（量大后） | 蛋同步文件 |

---

## 2. 域名规划

| 子域名 | 用途 | 备注 |
|---|---|---|
| `appgacha.com` | 产品官网 / 落地页 | 未来 |
| `api.appgacha.com` | FastAPI 后端 API | Electron 客户端调用 |
| `admin.appgacha.com` | 管理运维面板 | IP 白名单 + 独立鉴权 |

Electron 客户端硬编码 `https://api.appgacha.com` 为 API base URL。

---

## 3. 项目目录结构

```
appgacha-server/
├── backend/                      # FastAPI 后端
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py               # FastAPI 实例、路由挂载、CORS、lifespan
│   │   ├── config.py             # pydantic-settings，读 .env
│   │   ├── deps.py               # 依赖注入（DB session、当前用户）
│   │   ├── models/               # SQLAlchemy 模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py           # 用户（google_id, email, avatar, created_at）
│   │   │   ├── subscription.py   # 订阅（plan, status, expires_at）
│   │   │   ├── usage.py          # 用量记录（user_id, date, count, tokens）
│   │   │   └── egg_sync.py       # 蛋同步元数据（egg_id, version, size, path）
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py           # OAuth callback / me / refresh / logout
│   │   │   ├── proxy.py          # 模型代理（SSE 流式转发）
│   │   │   ├── sync.py           # 蛋云同步 CRUD
│   │   │   ├── billing.py        # 订阅状态 / 用量查询
│   │   │   └── webhook.py        # Lemon Squeezy 支付回调
│   │   ├── services/             # 业务逻辑层
│   │   │   ├── __init__.py
│   │   │   ├── google_oauth.py   # token exchange、用户信息获取
│   │   │   ├── jwt_service.py    # session JWT 签发/验证
│   │   │   ├── billing_service.py# 额度计算、免费层逻辑
│   │   │   └── sync_service.py   # 文件存储、冲突处理
│   │   └── middleware/
│   │       ├── __init__.py
│   │       ├── auth.py           # JWT 验证中间件
│   │       └── rate_limit.py     # 限流
│   ├── alembic/                  # 数据库迁移
│   │   ├── versions/
│   │   └── env.py
│   ├── alembic.ini
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── admin/                        # Vite + React 管理面板
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx     # 总览（用户数、日活、收入）
│   │   │   ├── Users.tsx         # 用户列表、搜索、封禁
│   │   │   ├── Usage.tsx         # 用量统计、图表
│   │   │   ├── Subscriptions.tsx # 订阅管理
│   │   │   └── System.tsx        # 服务状态、日志
│   │   ├── components/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── nginx/
│   ├── default.conf              # 反向代理配置
│   └── ssl/                      # 证书目录（certbot 挂载）
├── docker-compose.yml
├── .env.example                  # 全局环境变量模板
├── .gitignore
└── README.md                     # 内部部署文档
```

---

## 4. Google OAuth 登录流程（PKCE）

### 4.1 时序

```
┌─ Electron ─┐       ┌─ 系统浏览器 ─┐      ┌─ FastAPI ─┐       ┌─ Google ─┐
│            │ 1.open │              │      │           │       │          │
│  登录按钮  │──────→│ Google 同意页 │      │           │       │          │
│            │       │ (PKCE)       │      │           │       │          │
│            │       │── 2.同意 ──────────────────────────────→│ 授权     │
│            │       │              │      │           │       │          │
│ 3. appgacha://callback?code=xxx   │      │           │       │          │
│←──────────────────────────────────│      │           │       │          │
│            │       │              │      │           │       │          │
│ 4. POST /auth/callback {code, code_verifier}        │       │          │
│──────────────────────────────────────────→│           │       │          │
│            │       │              │      │ 5. code+secret 换 token     │
│            │       │              │      │──────────────────→│          │
│            │       │              │      │ 6. userinfo     │          │
│            │       │              │      │──────────────────→│          │
│            │       │              │      │ 7. 创建/查找用户 │          │
│            │       │              │      │ 8. 签发 JWT     │          │
│ 9. { access_token, refresh_token, user } │           │       │          │
│←──────────────────────────────────────────│           │       │          │
│            │       │              │      │           │       │          │
│ 10. 存入 Electron safeStorage    │      │           │       │          │
└────────────┘       └──────────────┘      └───────────┘       └──────────┘
```

### 4.2 关键约束

- Electron 是 **public client**，不持有 client_secret
- 使用 PKCE（code_verifier + code_challenge）保护授权码
- `client_secret` 仅存于服务器 `.env`，由 FastAPI 在 token exchange 时使用
- Google Cloud Console：OAuth Client 类型 = **Desktop app**，redirect_uri = `appgacha://callback`
- 自铸 JWT（HS256），有效期 7 天 + refresh token 30 天

### 4.3 Electron 侧新增模块

| 文件 | 职责 |
|---|---|
| `src/main/auth.ts` | PKCE 发起（生成 verifier → 打开系统浏览器）+ 协议回调监听 + token 存储 |
| `src/main/api.ts` | HTTP 客户端（httpx 对应 axios），带 Authorization header，自动 refresh |
| `shelf.ts` IPC | `auth:login` / `auth:logout` / `auth:status` |
| UI 设置面板 | 登录/登出、用户头像、订阅状态 |

---

## 5. API 路由设计

### 5.1 认证

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | `/auth/callback` | 接收 code+verifier，换 token，返回 JWT | 无 |
| GET | `/auth/me` | 当前用户信息 + 订阅状态 + 剩余额度 | Bearer |
| POST | `/auth/refresh` | 刷新 JWT | refresh_token |
| POST | `/auth/logout` | 吊销 refresh token | Bearer |

### 5.2 模型代理

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | `/proxy/chat` | 转发 OpenAI 兼容请求，SSE 流式 | Bearer |
| GET | `/proxy/models` | 可用模型列表 | Bearer |

### 5.3 蛋云同步

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/sync/eggs` | 用户蛋列表（元数据） | Bearer |
| PUT | `/sync/eggs/{egg_id}` | 上传蛋（multipart） | Bearer |
| GET | `/sync/eggs/{egg_id}` | 下载蛋 | Bearer |
| DELETE | `/sync/eggs/{egg_id}` | 删除云端蛋 | Bearer |

### 5.4 计费

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/billing/usage` | 当月用量 | Bearer |
| GET | `/billing/subscription` | 订阅详情 | Bearer |
| POST | `/webhook/lemonsqueezy` | 支付回调 | HMAC 签名 |

### 5.5 管理面板（admin 前缀，独立鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/users` | 用户列表（分页、搜索） |
| GET | `/admin/stats` | 统计概览 |
| PUT | `/admin/users/{id}/ban` | 封禁/解封 |
| GET | `/admin/usage` | 全局用量报表 |

---

## 6. 数据库模型（核心表）

```sql
-- 用户
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id     VARCHAR(64) UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    name          VARCHAR(128),
    avatar_url    TEXT,
    is_banned     BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 订阅
CREATE TABLE subscriptions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id),
    plan          VARCHAR(32) NOT NULL,        -- 'free' | 'pro'
    status        VARCHAR(32) NOT NULL,        -- 'active' | 'expired' | 'cancelled'
    provider      VARCHAR(32),                 -- 'lemonsqueezy' | 'paddle'
    provider_sub_id VARCHAR(128),              -- 支付平台订阅 ID
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 用量（按天聚合）
CREATE TABLE usage_daily (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id),
    date          DATE NOT NULL,
    gacha_count   INT DEFAULT 0,              -- 扭蛋次数
    tokens_used   BIGINT DEFAULT 0,           -- token 消耗
    UNIQUE(user_id, date)
);

-- 蛋同步元数据
CREATE TABLE egg_syncs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id),
    egg_id        VARCHAR(64) NOT NULL,        -- 蛋目录名 / UUID
    egg_name      VARCHAR(128),
    version       INT DEFAULT 1,
    size_bytes    BIGINT,
    storage_path  TEXT NOT NULL,               -- 磁盘/MinIO 路径
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, egg_id)
);

-- Refresh tokens
CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id),
    token_hash    VARCHAR(128) UNIQUE NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. 计费模型

| 层 | 条件 | 额度 |
|---|---|---|
| 匿名（自配 key） | 无需登录 | 无限（用自己的 API key） |
| 免费（登录） | Google 登录即享 | 终身 2 次扭蛋 + 每日 1 次 |
| Pro 订阅 | $2.99~4.99/月 | 每月 50 次 + 云同步 + 优先队列 |
| 超出按次 | Pro 用户超额 | $0.19/次 微交易 |

---

## 8. 部署架构

```
                    ┌─────────────────────────────────┐
                    │         自有服务器               │
                    │                                 │
  Internet ──→ Nginx (443)                           │
                    │                                 │
                    ├── api.appgacha.com              │
                    │   └── → FastAPI :8000           │
                    │                                 │
                    ├── admin.appgacha.com            │
                    │   └── → React 静态文件           │
                    │                                 │
                    └── PostgreSQL :5432              │
                        + 磁盘存储（蛋文件）           │
                    └─────────────────────────────────┘
```

### docker-compose.yml 概要

```yaml
version: "3.9"
services:
  api:
    build: ./backend
    restart: unless-stopped
    env_file: .env
    depends_on: [db]
    volumes:
      - egg_storage:/data/eggs

  admin:
    build: ./admin
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: appgacha
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
    volumes:
      - pgdata:/var/lib/postgresql/data

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf
      - ./nginx/ssl:/etc/nginx/ssl
    depends_on: [api, admin]

volumes:
  pgdata:
  egg_storage:
```

---

## 9. 环境变量模板 (.env.example)

```env
# === Database ===
DATABASE_URL=postgresql+asyncpg://user:pass@db:5432/appgacha

# === JWT ===
JWT_SECRET=change-me-to-random-64-chars
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080   # 7 days
REFRESH_TOKEN_EXPIRE_DAYS=30

# === Google OAuth ===
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx
GOOGLE_REDIRECT_URI=appgacha://callback

# === AI Model Proxy ===
UPSTREAM_API_BASE=https://api.openai.com/v1
UPSTREAM_API_KEY=sk-xxxxx

# === Lemon Squeezy ===
LS_WEBHOOK_SECRET=xxxxx
LS_STORE_ID=xxxxx

# === Admin ===
ADMIN_SECRET=change-me              # 管理面板独立鉴权
```

---

## 10. 开发阶段

### Phase 1：骨架 + Google OAuth 闭环
- [ ] 初始化项目（FastAPI + SQLAlchemy + Alembic + Docker Compose）
- [ ] 实现 `/auth/callback` + JWT 签发
- [ ] Electron `auth.ts`：PKCE 发起 + 协议回调 + safeStorage
- [ ] 联调：点登录 → 浏览器授权 → 回到应用 → 显示已登录

### Phase 2：模型代理 + 计量
- [ ] `/proxy/chat` SSE 流式转发
- [ ] `usage_daily` 计量（每次调用 +1）
- [ ] Electron `fcDriver` 切换为走代理（登录用户）/ 直连（自配 key）

### Phase 3：支付 + 订阅
- [ ] Lemon Squeezy 商品创建
- [ ] `/webhook/lemonsqueezy` 回调处理
- [ ] 免费层 / Pro 层额度逻辑
- [ ] 客户端订阅状态展示

### Phase 4：云同步
- [ ] 蛋上传/下载 API
- [ ] 冲突策略（last-write-wins + 版本号）
- [ ] 客户端自动同步 / 手动同步

### Phase 5：管理面板
- [ ] 用户管理、用量统计、订阅概览
- [ ] 系统健康监控
- [ ] 运营操作（封禁、额度调整）

---

## 11. 与 Electron 客户端的接口约定

客户端新增常量：

```typescript
// src/main/config.ts 或 settings
const API_BASE = 'https://api.appgacha.com'
```

所有后端通信走 `src/main/api.ts` 统一封装：
- 自动附加 `Authorization: Bearer <jwt>`
- 401 时自动 refresh，失败则触发重新登录
- 网络错误优雅降级（离线模式 = 自配 key 直连）
