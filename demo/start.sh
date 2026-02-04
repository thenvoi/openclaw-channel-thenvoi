#!/usr/bin/env bash
#
# OpenClaw + Thenvoi Demo Launcher
# Uses official OpenClaw Docker setup from GitHub
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OPENCLAW_DIR="$SCRIPT_DIR/openclaw"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  OpenClaw + Thenvoi Channel - Official Docker Setup"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check for .env file
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    log_error ".env file not found!"
    echo "  cp .env.example .env && edit .env"
    exit 1
fi

source "$SCRIPT_DIR/.env"

# Validate required env vars
log_info "Validating environment variables..."
MISSING_VARS=()
[[ -z "${ANTHROPIC_API_KEY:-}" ]] && MISSING_VARS+=("ANTHROPIC_API_KEY")
[[ -z "${THENVOI_API_KEY:-}" ]] && MISSING_VARS+=("THENVOI_API_KEY")
[[ -z "${THENVOI_AGENT_ID:-}" ]] && MISSING_VARS+=("THENVOI_AGENT_ID")

if [[ ${#MISSING_VARS[@]} -gt 0 ]]; then
    log_error "Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    exit 1
fi
log_success "Environment validated"

# Build Thenvoi plugin
log_info "Building Thenvoi channel plugin..."
cd "$PROJECT_ROOT"
npm run build
log_success "Plugin built"

# Clone official OpenClaw repo if needed
if [[ ! -d "$OPENCLAW_DIR" ]]; then
    log_info "Cloning official OpenClaw repository..."
    git clone https://github.com/openclaw/openclaw.git "$OPENCLAW_DIR"
    log_success "OpenClaw cloned"
else
    log_info "Updating OpenClaw repository..."
    cd "$OPENCLAW_DIR" && git pull
    log_success "OpenClaw updated"
fi

# Build OpenClaw Docker image
log_info "Building OpenClaw Docker image (this may take a few minutes)..."
cd "$OPENCLAW_DIR"
docker build -t openclaw:local .
log_success "OpenClaw image built"

# Create directories and copy plugin
log_info "Setting up directories..."
cd "$SCRIPT_DIR"
mkdir -p openclaw-config/workspace plugins/thenvoi
cp -r "$PROJECT_ROOT"/dist/* plugins/thenvoi/
cp "$PROJECT_ROOT"/openclaw.plugin.json plugins/thenvoi/
log_success "Directories ready"

# Start with our docker-compose (includes Thenvoi plugin mount)
log_info "Starting OpenClaw with Thenvoi plugin..."
cd "$SCRIPT_DIR"
docker compose up -d

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  OpenClaw is starting!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Gateway:   http://localhost:18789"
echo "  Logs:      docker logs -f openclaw-thenvoi-agent"
echo "  Stop:      ./stop.sh"
echo ""
