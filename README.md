# VibeMap MCP Server

A Model Context Protocol (MCP) server that creates a **two-way sync** between VibeMap and your IDE or AI coding agent.

**Inbound** → Scan an existing codebase and let VibeMap AI reverse-engineer it into structured features, user stories, and acceptance criteria.

**Outbound** → Connect your IDE agent to VibeMap to consume all planned specs and auto-build the product, tracking progress in real-time.

---

## Features

| Capability | Description |
|---|---|
| **Project Context** | Serve full VibeMap project specs (features, stories, AC, personas, pages, schema) to any connected IDE |
| **Codebase Analysis** | Scan a local project and submit it for AI reverse-engineering |
| **Kanban Tracking** | Auto-advance features/stories/criteria through kanban stages as your IDE builds them |
| **Full CRUD** | Create, read, and update features, user stories, and acceptance criteria |
| **Generation Status** | Poll ongoing AI generation tasks |

---

## Setup

### 1. Build the Server

```bash
cd mcp-server
npm install
npm run build
```

### 2. Get an API Key

1. Log in to VibeMap → **Account > Developer**
2. Click **Generate Key**, name it (e.g. `"Cursor"`), and copy the token (starts with `vm_`)

### 3. Configure your MCP Client

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "vibemap": {
      "command": "node",
      "args": ["/absolute/path/to/vibemap/mcp-server/build/index.js"],
      "env": {
        "VIBEMAP_API_KEY": "vm_your_token_here",
        "VIBEMAP_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

**Cursor / Windsurf** — add the same config to your MCP settings file.

---

## Two-Way Workflow

### Inbound: Codebase → VibeMap Specs

```
1. vibemap_list_projects          ← find or create your project
2. vibemap_analyze_codebase       ← scan repo + submit to VibeMap AI
3. vibemap_get_generation_status  ← poll until complete
4. vibemap_get_project_context    ← review generated specs
```

### Outbound: VibeMap Specs → Building the Product

```
1. vibemap_get_project_context    ← load all specs into agent context
2. vibemap_get_kanban_board       ← see what's planned/in-progress/done
3. ... implement a feature ...
4. vibemap_update_kanban_status   ← advance feature/story to in_progress
5. vibemap_update_kanban_status   ← mark acceptance criteria as passed
6. vibemap_update_kanban_status   ← mark story/feature as completed
```

---

## Available Tools

### Projects
| Tool | Description |
|---|---|
| `vibemap_list_projects` | List all VibeMap projects |
| `vibemap_get_project_context` | Full project context: features, stories, personas, pages, schema |

### Features
| Tool | Description |
|---|---|
| `vibemap_list_features` | List features with filtering (status, priority, category, search) |
| `vibemap_create_feature` | Create a new feature |
| `vibemap_update_feature` | Update feature fields or status |

### User Stories
| Tool | Description |
|---|---|
| `vibemap_list_user_stories` | List stories with filtering by feature/project |
| `vibemap_create_user_story` | Create a new user story |
| `vibemap_update_user_story` | Update story fields or status |

### Acceptance Criteria
| Tool | Description |
|---|---|
| `vibemap_list_acceptance_criteria` | List criteria by story/feature/project |
| `vibemap_update_acceptance_criterion` | Update criterion content or status (passed/failed) |

### Kanban Tracking
| Tool | Description |
|---|---|
| `vibemap_update_kanban_status` | Atomic status transition with validation. Prevents invalid moves. |
| `vibemap_get_kanban_board` | Real-time board view grouped by stage (draft/open/in_progress/completed) |

**Stage transitions:**
- Feature: `draft → open → in_progress → completed`
- Story: `draft → has_criteria → open → in_progress → completed`
- Criterion: `draft → pending → passed | failed`

### Codebase Analysis
| Tool | Description |
|---|---|
| `vibemap_scan_codebase` | Walk directory tree with file stats |
| `vibemap_analyze_codebase` | Scan + submit to VibeMap AI for reverse engineering. Returns `sessionId`. |
| `vibemap_get_generation_status` | Poll an AI generation task by `sessionId` |

---

## Development

```bash
npm test          # Run all unit tests (37 tests)
npm run build     # Compile TypeScript
npm run dev       # Watch mode
```
