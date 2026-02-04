# Installing Thenvoi Channel Plugin on OpenClaw

This guide explains how to install the Thenvoi channel plugin from GitHub on a clean OpenClaw agent.

## Prerequisites

- OpenClaw agent running (version 2026.1.0 or later)
- Thenvoi credentials:
  - `apiKey` - Your Thenvoi API key (starts with `thnv_a_` or `tv_`)
  - `agentId` - Your agent's UUID on Thenvoi

## Installation Steps

### Step 1: Clone the Repository

```bash
cd ~/.openclaw/plugins
git clone -b feat/integrate-openclaw-INT-102 https://github.com/thenvoi/openclaw-channel-thenvoi.git thenvoi
cd thenvoi
```

> **Note:** Use the branch `feat/integrate-openclaw-INT-102` until the code is merged to `main`.

### Step 2: Install Dependencies

```bash
npm install
```

> **Note for Docker/Production environments:** If `NODE_ENV=production` is set (common in Docker containers), npm skips devDependencies by default. Use `npm install --include=dev` to ensure build tools like `tsup` are installed.

### Step 3: Build the Plugin

```bash
npm run build
```

This automatically copies `openclaw.plugin.json` to the `dist/` directory.

### Step 4: Register the Plugin

Edit `~/.openclaw/openclaw.json` and add the plugin configuration:

```json
{
  "commands": {
    "restart": true
  },
  "plugins": {
    "enabled": true,
    "load": {
      "paths": [
        "/home/node/.openclaw/plugins/thenvoi"
      ]
    },
    "entries": {
      "thenvoi": {
        "enabled": true,
        "config": {
          "accounts": {
            "default": {
              "enabled": true,
              "apiKey": "YOUR_THENVOI_API_KEY",
              "agentId": "YOUR_AGENT_UUID",
              "wsUrl": "wss://platform.dev.thenvoi.com/api/v1/socket",
              "restUrl": "https://platform.dev.thenvoi.com"
            }
          }
        }
      }
    }
  }
}
```

**Important settings:**
- `commands.restart: true` - Enables hot reload without container restart
- `plugins.load.paths` - Path to the plugin directory
- `plugins.entries.thenvoi` - Plugin configuration with credentials

The plugin will load automatically - OpenClaw's config file watcher detects changes and reloads.

## Configuration Options

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `apiKey` | Yes | - | API key for Thenvoi authentication |
| `agentId` | Yes | - | Your agent's UUID on Thenvoi |
| `wsUrl` | No | `wss://api.thenvoi.com/socket` | WebSocket endpoint |
| `restUrl` | No | `https://api.thenvoi.com` | REST API endpoint |

### Development Environment

For Thenvoi development environment, use:
```json
"wsUrl": "wss://platform.dev.thenvoi.com/api/v1/socket",
"restUrl": "https://platform.dev.thenvoi.com"
```

## Verify Installation

Check the logs for successful loading:

```bash
# Look for these messages:
[thenvoi] Channel registered successfully
[thenvoi] Plugin loaded, connection service registered
[plugins] Starting Thenvoi connection service...
```

The Thenvoi channel should appear in the OpenClaw UI.

## Troubleshooting

### "plugin manifest not found"

Re-run the build to copy the manifest:
```bash
npm run build
```

Or manually copy it:
```bash
cp openclaw.plugin.json dist/
```

### "SIGUSR1 restart ignored (not authorized)"

Add `"commands": { "restart": true }` to your `openclaw.json` config.

### "Skipping Thenvoi connection: missing required environment variables"

The plugin is looking for environment variables. Ensure your credentials are in `plugins.entries.thenvoi.config.accounts.default` in `openclaw.json`.

### Plugin not appearing in UI

1. Check that `plugins.enabled` is `true`
2. Verify the path in `plugins.load.paths` is correct
3. Ensure `plugins.entries.thenvoi.enabled` is `true`
4. Check logs for error messages

### Config warnings about "plugin id mismatch"

These warnings can be ignored - they occur because OpenClaw scans all `.js` and `.ts` files in the plugin directory. The plugin still loads correctly.

## Docker Installation

For Docker-based OpenClaw, you can either:

### Option 1: Install inside the container

```bash
docker exec -it <container-name> bash
# Then follow the installation steps above
```

### Option 2: Mount the plugin directory

```yaml
services:
  openclaw:
    volumes:
      - ./plugins/thenvoi:/home/node/.openclaw/plugins/thenvoi:ro
```

## Complete Example: openclaw.json

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-3-5-haiku-latest"
      }
    }
  },
  "gateway": {
    "port": 18789,
    "bind": "lan"
  },
  "commands": {
    "restart": true
  },
  "plugins": {
    "enabled": true,
    "load": {
      "paths": [
        "/home/node/.openclaw/plugins/thenvoi"
      ]
    },
    "entries": {
      "thenvoi": {
        "enabled": true,
        "config": {
          "accounts": {
            "default": {
              "enabled": true,
              "apiKey": "thnv_a_xxxxx",
              "agentId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
              "wsUrl": "wss://api.thenvoi.com/socket",
              "restUrl": "https://api.thenvoi.com"
            }
          }
        }
      }
    }
  }
}
```

## Plugin Files Structure

After installation, your plugin directory should contain:

```
~/.openclaw/plugins/thenvoi/
├── dist/
│   ├── index.js              # Compiled plugin code
│   ├── index.js.map          # Source map
│   ├── index.d.ts            # TypeScript declarations
│   └── openclaw.plugin.json  # Plugin manifest (copied by build)
├── src/
│   └── *.ts                  # Source files
├── node_modules/             # Dependencies
├── openclaw.plugin.json      # Plugin manifest (original)
├── package.json              # Package metadata
└── package-lock.json         # Dependency lock
```

## Support

- [GitHub Issues](https://github.com/thenvoi/openclaw-channel-thenvoi/issues)
- [Thenvoi Documentation](https://thenvoi.com/docs)
- [OpenClaw Plugin Docs](https://docs.openclaw.ai/plugins)
