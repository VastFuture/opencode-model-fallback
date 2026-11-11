#!/usr/bin/env bash
set -e

PLUGIN_NAME="opencode-runtime-fallback"
PLUGIN_VERSION="${PLUGIN_VERSION:-1.0.4}"
GITHUB_REPO="VastFuture/opencode-model-fallback"
CONFIG_DIR="${HOME}/.config/opencode"
INSTALL_DIR="${CONFIG_DIR}/plugins/opencode-model-fallback"
BRIDGE_FILE="${CONFIG_DIR}/plugins/opencode-model-fallback.js"
ARCHIVE_URL="${ARCHIVE_URL:-https://github.com/${GITHUB_REPO}/releases/download/v${PLUGIN_VERSION}/${PLUGIN_NAME}-${PLUGIN_VERSION}.tgz}"

echo "🚀 Installing ${PLUGIN_NAME}..."

# Check dependencies
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm not found. Please install Node.js first."
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo "❌ Error: curl not found."
    exit 1
fi

if ! command -v opencode &> /dev/null; then
    echo "⚠️  Warning: opencode CLI not found."
    echo "   Visit: https://github.com/sst/opencode"
fi

# Install the maintained GitHub Release, not the upstream npm package with the same name.
echo "📦 Installing plugin to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
archive="$(mktemp)"
trap 'rm -f "${archive}"' EXIT
curl -fL "${ARCHIVE_URL}" -o "${archive}"
tar -xzf "${archive}" -C "${INSTALL_DIR}" --strip-components=1
npm install --omit=dev --ignore-scripts --legacy-peer-deps --prefer-offline \
    --prefix "${INSTALL_DIR}" --loglevel error

# Version probing avoids starting a service or relying on a cached plugin inventory.
if command -v opencode &> /dev/null && opencode --version 2>/dev/null | awk -F. '
    { sub(/^[^0-9]*/, "", $1); major = $1 + 0; minor = $2 + 0; patch = $3 + 0
      compatible = major > 2 || (major == 2 && (minor > 2 || (minor == 2 && patch >= 7))) }
    END { exit !compatible }'; then
    rm -f "${BRIDGE_FILE}"
    ENTRYPOINT="${INSTALL_DIR}"
else
    printf 'export { default } from "file://%s/dist/index.js"\n' "${INSTALL_DIR}" > "${BRIDGE_FILE}"
    ENTRYPOINT="${BRIDGE_FILE}"
fi

OPENCODE_JSON="${CONFIG_DIR}/opencode.json"
if [ -f "${OPENCODE_JSON}" ] && grep -q "opencode-runtime-fallback" "${OPENCODE_JSON}"; then
    echo "⚠️  Remove the opencode-runtime-fallback package entry from ${OPENCODE_JSON}."
    echo "   The local entrypoint ${ENTRYPOINT} is loaded automatically."
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📁 Installed to: ${INSTALL_DIR}/"
echo "🔗 OpenCode entrypoint: ${ENTRYPOINT}"
echo "📝 Config file:  ${OPENCODE_JSON}"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Configure fallback models in ${OPENCODE_JSON}:"
echo ""
printf '   {\n     "$schema": "https://opencode.ai/config.json",\n     "agent": {\n       "coder": {\n         "model": "anthropic/claude-sonnet-4-6",\n         "fallback_models": ["openai/gpt-5.4", "google/gemini-2.5-pro"]\n       }\n     }\n   }\n'
echo ""
echo "2. (Optional) Create plugin config at ${CONFIG_DIR}/opencode-fallback.jsonc"
echo ""
echo "📖 Full documentation:"
echo "   https://github.com/${GITHUB_REPO}#readme"
echo "   https://github.com/${GITHUB_REPO}/blob/main/HOW_IT_WORKS.md"
echo ""
