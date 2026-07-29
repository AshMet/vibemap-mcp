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

The server exposes **31 tools** via the `vibemap_` prefix.

**Projects & context**

| Tool | Description |
|---|---|
| `vibemap_list_projects` | List all your projects |
| `vibemap_create_project` | Create a new project (use before `analyze_codebase`) |
| `vibemap_get_project_context` | Load full project specs into agent context |
| `vibemap_get_atomic_blueprint` | Get the code-shaped atomic blueprint for LLM generation |
| `vibemap_list_access_rules` | List table- and page-level access rules (with `op_conditions`) for RLS + auth |
| `vibemap_get_page_source` | Retrieve a page and its section source code |

**Personas & pages (spec authoring)**

| Tool | Description |
|---|---|
| `vibemap_create_persona` | Create a rich user persona (demographics, goals, pain points, …) |
| `vibemap_create_page` | Create a page/screen in the project's page inventory |

**Features**

| Tool | Description |
|---|---|
| `vibemap_list_features` | List features with filtering |
| `vibemap_create_feature` | Create a new feature |
| `vibemap_update_feature` | Update feature fields or status (validates transitions) |

**User stories**

| Tool | Description |
|---|---|
| `vibemap_list_user_stories` | List stories by project or feature |
| `vibemap_create_user_story` | Create a user story |
| `vibemap_update_user_story` | Update story fields or status (validates transitions) |

**Acceptance criteria**

| Tool | Description |
|---|---|
| `vibemap_list_acceptance_criteria` | Fetch BDD criteria |
| `vibemap_create_acceptance_criterion` | Create a BDD acceptance criterion |
| `vibemap_update_acceptance_criterion` | Update or mark criteria passed/failed (validates transitions) |

**Kanban — board & agentic lifecycle**

| Tool | Description |
|---|---|
| `vibemap_get_kanban_board` | Get a real-time board view |
| `vibemap_get_next_ready_criterion` | Get the highest-priority criterion ready to work on |
| `vibemap_claim_criterion` | Claim a criterion (`ready` → `in_progress`) |
| `vibemap_report_progress` | Append a progress event to a criterion |
| `vibemap_submit_for_review` | Submit a criterion for review (→ `review_pending`) |
| `vibemap_resolve_review` | Resolve a review (`passed` / `failed`) |
| `vibemap_block_criterion` | Block a criterion with a category and reason |
| `vibemap_unblock_criterion` | Unblock a criterion with a resolution |
| `vibemap_list_kanban_events` | Kanban transition history (for incremental sync) |
| `vibemap_update_kanban_status` | ⚠️ Deprecated — use the lifecycle tools above |

**Version control**

| Tool | Description |
|---|---|
| `vibemap_list_changesets` | List changesets (your writes + history) with op counts; `includeOps` for diffs |

**Codebase**

| Tool | Description |
|---|---|
| `vibemap_scan_codebase` | Walk a local directory |
| `vibemap_analyze_codebase` | Reverse-engineer a codebase into VibeMap assets |
| `vibemap_get_generation_status` | Poll AI generation task status |

## Prompts (slash commands)

The server also exposes **prompts** — invocable workflows your IDE surfaces as slash commands (in Claude Code: `/mcp__vibemap__<name>`). The body of each prompt is expanded from VibeMap's server at call time, so you invoke a workflow rather than paste a long instruction. Each takes a `projectId`; the code-oriented ones also accept an optional `localPath`.

| Prompt | Args | Description |
|---|---|---|
| `author_spec` | `projectId`, `localPath?` | Author the full spec graph from your local codebase (bring-your-own-agent, code-first) |
| `author_idea` | `projectId` | Author the full spec graph from the project idea (bring-your-own-agent, idea-first) |
| `sync_changes` | `projectId`, `localPath?` | Detect and reconcile spec drift since the last sync |
| `code_map` | `projectId`, `localPath?` | Build and submit a structural code map |
| `load_context` | `projectId` | Load the project's spec context into your agent |
| `kanban` | `projectId` | Show the project's kanban board |

## Documentation

Full docs at [vibemap.ai/docs/developer-docs/mcp-server/introduction](https://vibemap.ai/docs/developer-docs/mcp-server/introduction)

## License

MIT
