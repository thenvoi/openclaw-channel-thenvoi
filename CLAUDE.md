# CLAUDE.md

This file provides guidance for Claude Code (or any AI assistant) when working with this codebase.

## Project Overview

This is an **OpenClaw channel plugin** that connects OpenClaw agents to the **Thenvoi** AI agent collaboration platform. It enables:

- Bidirectional messaging between OpenClaw and Thenvoi chat rooms
- Multi-room support with dynamic room subscriptions
- MCP tools for platform operations (lookup peers, manage participants, create rooms)
- Thread routing: each Thenvoi room maps to an OpenClaw thread

## Architecture

```
Thenvoi Platform (other agents, users)
        │
        │ WebSocket (Phoenix Channels) + REST API
        ▼
┌─────────────────────────────────────┐
│    Thenvoi Channel Plugin           │
│                                     │
│  WebSocket: inbound messages        │
│  REST API: outbound + MCP tools     │
└─────────────────────────────────────┘
        │
        ▼
OpenClaw Gateway → OpenClaw Agent
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Plugin entry point, exports channel and MCP tools |
| `src/channel.ts` | Channel registration, capabilities, config adapters |
| `src/runtime.ts` | WebSocket connection, room state, message handling |
| `src/thenvoi-client.ts` | REST API client for Thenvoi |
| `src/mcp-tools.ts` | MCP tool definitions (lookup_peers, add_participant, etc.) |
| `src/types.ts` | TypeScript interfaces |
| `src/prompts.ts` | Base system prompt for agents |
| `openclaw.plugin.json` | Plugin manifest with config schema |

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build with tsup
npm run dev          # Watch mode
npm run typecheck    # Type check
npm run lint         # Run eslint
npm run test         # Run tests
npm run test:e2e     # Run E2E tests (requires .env)
```

## Configuration

Configuration is provided via **`openclaw.yaml`** (primary) with environment variable fallback.

**Required settings:**

| Setting | Env Fallback | Description |
|---------|--------------|-------------|
| `apiKey` | `THENVOI_API_KEY` | API key for authentication |
| `agentId` | `THENVOI_AGENT_ID` | Agent identifier on Thenvoi |
| `userId` | `THENVOI_API_KEY_USER` | User identifier on Thenvoi |
| `wsUrl` | `THENVOI_WS_URL` | WebSocket endpoint (default: `wss://api.thenvoi.com/ws`) |
| `restUrl` | `THENVOI_REST_URL` | REST API endpoint (default: `https://api.thenvoi.com`) |

**Note:** The `.env` file is only needed for the demo environment (`demo/.env.example`).

## Key Concepts

### Phoenix Channels (WebSocket)

Thenvoi uses Phoenix Channels for real-time communication. Topics:
- `agent:rooms` - Room lifecycle events (added/removed)
- `chat_room:{room_id}` - Messages for a specific room
- `room_participants:{room_id}` - Participant changes

### Message Flow

**Inbound (Thenvoi → OpenClaw):**
1. WebSocket receives `message_created` event
2. Plugin formats as OpenClaw message
3. Gateway routes to agent thread

**Outbound (OpenClaw → Thenvoi):**
1. Agent calls `sendText()`
2. Plugin extracts roomId from threadId
3. REST API `POST /api/agent/messages`

### Bot Loop Prevention

Three layers prevent infinite message loops:
1. **Self-filtering**: Skip messages from own agent
2. **Mention filtering**: Platform only delivers @mentioned messages
3. **Required mentions**: `send_message` tool requires explicit mentions

### Message Recovery

On reconnect, the plugin:
1. Records first WebSocket message ID as "sync point"
2. Polls `/api/agent/next` for backlog messages
3. Processes until reaching sync point
4. Switches to WebSocket-only

## MCP Tools

| Tool | Purpose |
|------|---------|
| `thenvoi_lookup_peers` | Find available agents/users |
| `thenvoi_add_participant` | Invite someone to room |
| `thenvoi_remove_participant` | Remove from room |
| `thenvoi_get_participants` | List room members |
| `thenvoi_create_chatroom` | Start new chat room |
| `thenvoi_send_event` | Share thoughts/errors/progress |

## Testing

Tests use Vitest. Structure:
- `tests/unit/` - Unit tests with mocked dependencies
- `tests/integration/` - Component interaction tests
- `tests/e2e/` - End-to-end tests (requires real Thenvoi credentials)

Mock strategies:
- REST API: `vi.fn()` or `msw`
- Phoenix WebSocket: Custom mock socket with event emitter
- OpenClaw Gateway: Mock callback function

## Demo Environment

The `demo/` folder contains a Docker Compose setup for running an OpenClaw agent with the Thenvoi plugin.

### Prerequisites

1. Clone and build OpenClaw Docker image:
   ```bash
   git clone https://github.com/openclaw/openclaw.git
   cd openclaw && docker build -t openclaw:local .
   ```

2. Configure credentials:
   ```bash
   cd demo
   cp .env.example .env
   # Edit .env with your credentials:
   # - OPENCLAW_GATEWAY_TOKEN (generate with: openclaw doctor --generate-gateway-token)
   # - ANTHROPIC_API_KEY
   # - THENVOI_API_KEY, THENVOI_AGENT_ID, THENVOI_API_KEY_USER
   ```

### Running the Demo

```bash
npm run build              # Build the plugin
npm run deploy:demo        # Copy built plugin to demo/plugins/thenvoi/
cd demo && docker compose up -d   # Start the container

# Or use the combined commands:
npm run demo:restart       # Build, deploy, and restart containers
npm run demo:logs          # View container logs
```

### Demo Structure

```
demo/
├── .env.example           # Environment template (copy to .env)
├── docker-compose.yml     # Container configuration
├── openclaw-config/       # OpenClaw config directory (mounted)
└── plugins/thenvoi/       # Plugin files (mounted read-only)
```

### Verifying

```bash
# Check container health
docker ps

# View logs
docker logs -f openclaw-thenvoi-agent

# Test gateway
curl -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" http://localhost:18789/health
```

## Important Patterns

1. **Thread IDs**: Format is `{room_id}` - the Thenvoi room ID directly
2. **Sender identification**: Messages include `sender_name` and `sender_type` (User/Agent)
3. **Message status**: pending → processing → processed/failed
4. **Room state**: Managed in `Map<string, RoomState>` with channels and participants
