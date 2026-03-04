# @vibemap.ai/mcp-server

Connect your IDE agent to [VibeMap](https://vibemap.ai) via the [Model Context Protocol](https://modelcontextprotocol.io). Load project specs into any MCP-compatible AI coding agent, or reverse-engineer an existing codebase back into structured VibeMap assets.

## Quick Start

```json
{
  "mcpServers": {
    "vibemap": {
      "command": "npx",
      "args": ["-y", "@vibemap.ai/mcp-server"],
      "env": {
        "VIBEMAP_API_KEY": "vm_your_token_here",
        "VIBEMAP_BASE_URL": "https://vibemap.ai"
      }
    }
  }
}
```

Generate your API key at [vibemap.ai → Account → Developer → API Keys](https://vibemap.ai/account).

## What It Does

**Outbound (VibeMap → IDE):** Load your full project context — features, user stories, acceptance criteria, personas, pages, and DB schema — into your IDE agent. The agent builds to spec and updates your VibeMap kanban in real time as it works.

**Inbound (IDE → VibeMap):** Point the server at an existing codebase and VibeMap's AI will reverse-engineer it into a structured set of features, user stories, and acceptance criteria.

## Requirements

- Node.js ≥ 18
- A [VibeMap](https://vibemap.ai) account

## IDE Setup

### Claude Desktop

Config file: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "vibemap": {
      "command": "npx",
      "args": ["-y", "@vibemap.ai/mcp-server"],
      "env": {
        "VIBEMAP_API_KEY": "vm_your_token_here",
        "VIBEMAP_BASE_URL": "https://vibemap.ai"
      }
    }
  }
}
```

Fully restart Claude Desktop after saving. Confirm the 🔨 hammer icon appears in the chat input.

### Cursor

Open **Settings → MCP** and add:

```json
{
  "vibemap": {
    "command": "npx",
    "args": ["-y", "@vibemap.ai/mcp-server"],
    "env": {
      "VIBEMAP_API_KEY": "vm_your_token_here",
      "VIBEMAP_BASE_URL": "https://vibemap.ai"
    }
  }
}
```

### Windsurf

Same format as Cursor. Add to your Windsurf MCP settings file and restart.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VIBEMAP_API_KEY` | Your Personal Access Token (`vm_...`) | **Required** |
| `VIBEMAP_BASE_URL` | VibeMap instance URL | `http://localhost:3000` |

## Tools

The server exposes **15 tools** via the `vibemap_` prefix:

| Tool | Description |
|---|---|
| `vibemap_list_projects` | List all your projects |
| `vibemap_get_project_context` | Load full project specs into agent context |
| `vibemap_list_features` | List features with filtering |
| `vibemap_create_feature` | Create a new feature |
| `vibemap_update_feature` | Update feature fields or status |
| `vibemap_list_user_stories` | List stories by project or feature |
| `vibemap_create_user_story` | Create a user story |
| `vibemap_update_user_story` | Update story fields or status |
| `vibemap_list_acceptance_criteria` | Fetch BDD criteria |
| `vibemap_update_acceptance_criterion` | Mark criteria passed/failed |
| `vibemap_update_kanban_status` | Advance kanban status (with transition validation) |
| `vibemap_get_kanban_board` | Get real-time board view |
| `vibemap_scan_codebase` | Walk a local directory |
| `vibemap_analyze_codebase` | Reverse-engineer a codebase into VibeMap assets |
| `vibemap_get_generation_status` | Poll AI generation task status |

## Documentation

Full docs at [vibemap.ai/docs/developer-docs/mcp-server/introduction](https://vibemap.ai/docs/developer-docs/mcp-server/introduction)

## License

MIT
