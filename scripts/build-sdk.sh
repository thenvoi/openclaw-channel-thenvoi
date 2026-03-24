#!/usr/bin/env bash
# Build @thenvoi/sdk if its dist/ is missing.
# This is needed because the SDK is installed from GitHub without a prepare script.
set -e

SDK_DIR="node_modules/@thenvoi/sdk"

if [ -f "$SDK_DIR/dist/index.js" ]; then
  echo "[build-sdk] @thenvoi/sdk dist already exists, skipping"
  exit 0
fi

echo "[build-sdk] @thenvoi/sdk dist not found, building from source..."

# Clone the SDK source (the npm install only includes files from the "files" field)
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Get the git commit hash from the installed package
SDK_RESOLVED=$(node -e "const p=require('./$SDK_DIR/package.json'); console.log(p._resolved || '')")
SDK_COMMIT=$(echo "$SDK_RESOLVED" | grep -o '[a-f0-9]\{40\}' || true)

echo "[build-sdk] Cloning thenvoi-sdk-typescript${SDK_COMMIT:+ at $SDK_COMMIT}..."
git clone --depth 1 ${SDK_COMMIT:+--branch dev} https://github.com/thenvoi/thenvoi-sdk-typescript.git "$TEMP_DIR/sdk" 2>/dev/null

cd "$TEMP_DIR/sdk"

echo "[build-sdk] Installing SDK dependencies..."
npm install --legacy-peer-deps --ignore-scripts 2>/dev/null

echo "[build-sdk] Building SDK..."
npx tsup --config tsup.config.ts 2>/dev/null

echo "[build-sdk] Copying dist to $SDK_DIR..."
cp -r dist "$OLDPWD/$SDK_DIR/"

echo "[build-sdk] Done"
