#!/usr/bin/env bash
set -e

PLUGIN_NAME="opencode-runtime-fallback"
GITHUB_REPO="VastFuture/opencode-model-fallback"
INSTALL_DIR="${HOME}/.config/opencode"

echo "🚀 Installing ${PLUGIN_NAME}..."

# Check dependencies
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm not found. Please install Node.js first."
    exit 1
fi

if ! command -v opencode &> /dev/null; then
    echo "⚠️  Warning: opencode CLI not found."
    echo "   Visit: https://github.com/sst/opencode"
fi

# Install plugin to standard XDG location
echo "📦 Installing plugin to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"
npm install "${PLUGIN_NAME}" --save --loglevel error

# Add plugin to opencode.json if not already present
OPENCODE_JSON="${INSTALL_DIR}/opencode.json"
if [ ! -f "${OPENCODE_JSON}" ]; then
    echo "📝 Creating ${OPENCODE_JSON}..."
    cat > "${OPENCODE_JSON}" << 'JSONEOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-runtime-fallback"]
}
JSONEOF
elif ! grep -q "opencode-runtime-fallback" "${OPENCODE_JSON}"; then
    echo "⚠️  Please manually add the plugin to ${OPENCODE_JSON}:"
    echo '   "plugin": ["opencode-runtime-fallback"]'
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📁 Installed to: ${INSTALL_DIR}/node_modules/${PLUGIN_NAME}/"
echo "📝 Config file:  ${OPENCODE_JSON}"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Configure fallback models in ${OPENCODE_JSON}:"
echo ""
echo '   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["opencode-runtime-fallback"],
     "agent": {
       "coder": {
         "model": "anthropic/claude-sonnet-4-6",
         "fallback_models": ["openai/gpt-5.4", "google/gemini-2.5-pro"]
       }
     }
   }'
echo ""
echo "2. (Optional) Create plugin config at ${INSTALL_DIR}/opencode-fallback.jsonc"
echo ""
echo "📖 Full documentation:"
echo "   https://github.com/${GITHUB_REPO}#readme"
echo "   https://github.com/${GITHUB_REPO}/blob/main/HOW_IT_WORKS.md"
echo ""
