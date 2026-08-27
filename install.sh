#!/usr/bin/env bash
set -e

PLUGIN_NAME="opencode-runtime-fallback"
GITHUB_REPO="VastFuture/opencode-model-fallback"
INSTALL_DIR="${HOME}/.local/share/opencode/plugins/${PLUGIN_NAME}"

echo "🚀 Installing ${PLUGIN_NAME}..."

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm not found. Please install Node.js first."
    exit 1
fi

# Check if opencode is installed
if ! command -v opencode &> /dev/null; then
    echo "⚠️  Warning: opencode CLI not found. Make sure OpenCode is installed."
    echo "   Visit: https://github.com/sst/opencode"
fi

# Create plugin directory
mkdir -p "${INSTALL_DIR}"

echo "📦 Installing plugin via npm..."
cd "${INSTALL_DIR}"
npm install "${PLUGIN_NAME}" --save --loglevel error

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Add the plugin to your opencode.json:"
echo ""
echo '   {
     "plugin": ["opencode-runtime-fallback"]
   }'
echo ""
echo "2. Configure fallback models for your agents:"
echo ""
echo '   {
     "agent": {
       "coder": {
         "model": "anthropic/claude-opus-4-6",
         "fallback_models": ["openai/gpt-5.4", "google/gemini-2.5-pro"]
       }
     }
   }'
echo ""
echo "3. (Optional) Create a plugin config file:"
echo "   .opencode/opencode-fallback.jsonc"
echo ""
echo "📖 Full documentation:"
echo "   https://github.com/${GITHUB_REPO}#readme"
echo ""
