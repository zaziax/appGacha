#!/usr/bin/env bash
# macOS 打包 + 签名 + 公证 + 发布到 GitHub Release。用法：npm run dist:mac
# 凭证从 .env 读（APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_ID 用于公证；GH_TOKEN 用于发布），.env 已被 gitignore
set -euo pipefail
cd "$(dirname "$0")/.."

# 载入 .env（若存在）
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# node/npm（nvm）
export PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"

# 国内镜像加速（可被已存在值覆盖）
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

# 校验凭证齐全，缺则立即报错
: "${APPLE_API_KEY:?请在 .env 配置 APPLE_API_KEY=.p8 文件路径}"
: "${APPLE_API_ISSUER:?请在 .env 配置 APPLE_API_ISSUER=Issuer ID}"
: "${APPLE_API_KEY_ID:?请在 .env 配置 APPLE_API_KEY_ID=Key ID}"
: "${GH_TOKEN:?请在 .env 配置 GH_TOKEN=GitHub PAT（需要 repo 权限，用于发布到 Release）}"

echo "==> 清理 release/"
rm -rf release

echo "==> 构建（tsc + vite）"
npm run build

echo "==> 打包 + 签名 + 公证 + 发布（mac）"
npx electron-builder --mac --publish always

echo "==> 完成，dmg/zip/latest-mac.yml 已发布到 GitHub Release，产物备份在 release/"
echo "    验证签名: codesign --verify --deep --strict --verbose=2 release/mac-arm64/AppGacha.app"
echo "    验证公证: spctl --assess --type execute --verbose=4 release/mac-arm64/AppGacha.app"
