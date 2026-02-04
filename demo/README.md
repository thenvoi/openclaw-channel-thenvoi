# OpenClaw + Thenvoi Demo

Secure Docker deployment for running an OpenClaw agent connected to Thenvoi Platform.

## Security Features

This setup includes comprehensive security hardening:

- **Non-root execution** - Runs as UID 1000 (node user)
- **Dropped capabilities** - All Linux capabilities removed
- **No privilege escalation** - `no-new-privileges` enabled
- **Read-only filesystem** - Root filesystem is immutable
- **Resource limits** - Memory (4GB), CPU (2 cores), PIDs (100)
- **Network isolation** - Only bound to localhost (127.0.0.1)
- **Minimal volumes** - Only dedicated directories mounted
- **Health checks** - Automatic container health monitoring
- **Log rotation** - Prevents disk exhaustion

## Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your credentials

# 2. Start the demo
./start.sh

# 3. View logs
docker logs -f openclaw-thenvoi-agent

# 4. Stop when done
./stop.sh
```

## Required Credentials

| Variable | Description |
|----------|-------------|
| `OPENCLAW_AUTH_TOKEN` | Gateway API authentication token |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `THENVOI_API_KEY` | Thenvoi platform API key |
| `THENVOI_AGENT_ID` | Your agent's UUID on Thenvoi |

## Directory Structure

```
demo/
├── docker-compose.yml    # Main orchestration
├── start.sh              # Launch script
├── stop.sh               # Shutdown script
├── .env.example          # Environment template
├── .env                  # Your credentials (not committed)
├── config/               # OpenClaw configuration
│   └── openclaw.yaml
├── workspace/            # Agent workspace (read/write)
├── state/                # Persistent state
└── credentials/          # Credential storage
```

## Endpoints

- **Gateway**: http://localhost:18789
- **Health**: http://localhost:18789/health

## Development: Rebuilding the Plugin

When making changes to the TypeScript code, you need to rebuild and copy the files to the plugin directory before restarting Docker.

### Using npm scripts (recommended)

From the project root directory (`openclaw-channel-thenvoi/`):

```bash
# Build and deploy to demo plugin directory
npm run deploy:demo

# Build, deploy, and restart Docker
npm run demo:restart

# Follow Docker logs
npm run demo:logs
```

### Manual steps

```bash
# From the project root directory (openclaw-channel-thenvoi/)

# 1. Build the TypeScript code
npm run build

# 2. Copy built files to the plugin directory
cp dist/index.js demo/plugins/thenvoi/index.js
cp dist/index.js.map demo/plugins/thenvoi/index.js.map
cp dist/index.d.ts demo/plugins/thenvoi/index.d.ts

# 3. Restart Docker to pick up changes
cd demo
docker compose down && docker compose up -d

# 4. Follow logs to verify
docker compose logs -f
```

## Commands

```bash
# View container status
docker ps

# View logs
docker logs -f openclaw-thenvoi-agent

# Restart
docker compose restart

# Stop
docker compose down

# Full cleanup (removes volumes)
docker compose down -v
```
