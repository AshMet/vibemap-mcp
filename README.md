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

The server exposes **48 tools** via the `vibemap_` prefix.

**Projects & context**

| Tool | Description |
|---|---|
| `vibemap_list_projects` | List all your projects |
| `vibemap_create_project` | Create a new project (use before `analyze_codebase`) |
| `vibemap_get_project_context` | Load full project specs into agent context |
| `vibemap_get_atomic_blueprint` | Get the code-shaped blueprint of the whole project (large; for scaffolds and audits, not for building a single ticket: use `vibemap_get_criterion_context` there) |
| `vibemap_list_access_rules` | List table- and page-level access rules (with `op_conditions`) for RLS + auth |
| `vibemap_get_page_source` | Retrieve a page and its section source code |

**Personas & pages (spec authoring)**

| Tool | Description |
|---|---|
| `vibemap_create_persona` | Create a rich user persona (demographics, goals, pain points, …) |
| `vibemap_create_page` | Create a page/screen in the project's page inventory |
| `vibemap_create_schema` | Persist the database schema (tables → columns → relationships) in one call |

**Conversational agent (Engine B — hosted, metered)**

| Tool | Description |
|---|---|
| `vibemap_agent` | Drive VibeMap's full conversational agent for one turn (same brain as the in-app chat). Metered — uses VibeMap tokens. Destructive turns return a plan + `operationId` to approve in a second call; long generations run in the background (poll `get_generation_status`) |

**Features**

| Tool | Description |
|---|---|
| `vibemap_list_features` | List features with filtering |
| `vibemap_create_feature` | Create a new feature |
| `vibemap_update_feature` | Update feature fields or status (validates transitions). For spec authoring only: while building, use `vibemap_propose_spec_change` |

**User stories**

| Tool | Description |
|---|---|
| `vibemap_list_user_stories` | List stories by project or feature |
| `vibemap_create_user_story` | Create a user story |
| `vibemap_update_user_story` | Update story fields or status (validates transitions). For spec authoring only: while building, use `vibemap_propose_spec_change` |

**Acceptance criteria**

| Tool | Description |
|---|---|
| `vibemap_list_acceptance_criteria` | Fetch BDD criteria |
| `vibemap_create_acceptance_criterion` | Create a BDD acceptance criterion |
| `vibemap_update_acceptance_criterion` | Update a criterion's content (Given/When/Then, description). Status is not writable here: use the lifecycle tools below. For spec authoring only: while building, use `vibemap_propose_spec_change` |

**Kanban — board & agentic lifecycle**

| Tool | Description |
|---|---|
| `vibemap_get_kanban_board` | Get a real-time board view |
| `vibemap_get_execution_plan` | The build order: criteria grouped by sprint in dependency order, with state |
| `vibemap_get_next_ready_criterion` | Get the next criterion to work on, its story bundle, and a `reason` when nothing is claimable |
| `vibemap_claim_story` | Claim every claimable criterion of a story at once; returns a context pack for each |
| `vibemap_claim_criterion` | Claim a criterion (`ready` → `in_progress`) |
| `vibemap_get_criterion_context` | Everything needed to build one criterion in a few thousand tokens (use instead of the whole blueprint) |
| `vibemap_report_progress` | Heartbeat with the current `phase`, plus optional plan, files and test counts |
| `vibemap_submit_for_review` | Submit a criterion for review with the changed files and the named tests that prove it (→ `in_review`) |
| `vibemap_get_criterion_evidence` | Submission history of a criterion: files, tests and verdict per attempt |
| `vibemap_rework_criterion` | Send a criterion that failed review back to `ready` to build it again |
| `vibemap_resolve_review` | Resolve a review (`passed` / `failed`); needs a CI-review token or a signed-in user |
| `vibemap_block_criterion` | Block a criterion with a category and reason |
| `vibemap_ask_user` | Ask the project owner a question when the spec is unclear (blocks the criterion until answered) |
| `vibemap_get_answers` | Collect the answers to your questions |
| `vibemap_unblock_criterion` | Unblock a criterion with a resolution |
| `vibemap_propose_spec_change` | Propose a spec change for the owner to review when the code must differ; never edits the spec |
| `vibemap_list_kanban_events` | Kanban transition history (for incremental sync) |
| `vibemap_update_kanban_status` | ⚠️ Deprecated — use the lifecycle tools above |

**Version control**

| Tool | Description |
|---|---|
| `vibemap_list_changesets` | List changesets (your writes + history) with op counts; `includeOps` for diffs, `sinceSeq` as a cursor |
| `vibemap_get_spec_delta` | What changed in the spec since a sequence number, and which criteria that affects |
| `vibemap_get_release_work_list` | A release's work grouped as new, modified and removed (with the code paths to delete) |
| `vibemap_get_release_diff` | A release's raw diff against its baseline |
| `vibemap_sync_changes` | Report changed paths since the last sync so VibeMap can flag spec drift |

**Codebase**

| Tool | Description |
|---|---|
| `vibemap_scan_codebase` | Walk a local directory |
| `vibemap_analyze_codebase` | Reverse-engineer a codebase into VibeMap assets |
| `vibemap_submit_code_map` | Submit a structural code map (nodes/edges) rendered on the project's Codebase tab |
| `vibemap_get_code_map` | Fetch the project's current code map (status, nodes/edges, sync anchor + drift) |
| `vibemap_get_generation_status` | Poll AI generation task status |

## Prompts (slash commands)

The server also exposes **prompts** — invocable workflows your IDE surfaces as slash commands (in Claude Code: `/mcp__vibemap__<name>`). The body of each prompt is expanded from VibeMap's server at call time, so you invoke a workflow rather than paste a long instruction. Every prompt takes a `projectId` except `new_project`, which is the one that creates a project; the code-oriented ones also accept an optional `localPath`.

| Prompt | Args | Description |
|---|---|---|
| `new_project` | — | Guided interview that creates a new VibeMap project. Start here |
| `author_spec` | `projectId`, `localPath?` | Author the full spec graph from your local codebase (bring-your-own-agent, code-first) |
| `author_idea` | `projectId` | Author the full spec graph from the project idea (bring-your-own-agent, idea-first) |
| `author_personas` | `projectId` | Stage 1 of 5 — author just the personas |
| `author_features` | `projectId` | Stage 2 of 5 — author just the features |
| `author_stories` | `projectId` | Stage 3 of 5 — author just the user stories |
| `author_criteria` | `projectId` | Stage 4 of 5 — author just the acceptance criteria |
| `author_pages` | `projectId` | Stage 5 of 5 — author just the pages |
| `author_schema` | `projectId`, `localPath?` | Author the database schema — tables, columns, relationships |
| `sync_changes` | `projectId`, `localPath?` | Detect and reconcile spec drift since the last sync |
| `code_map` | `projectId`, `localPath?` | Build and submit a structural code map |
| `load_context` | `projectId` | Load the project's spec context into your agent |
| `kanban` | `projectId` | Show the project's kanban board |
| `build_sprint` | `projectId` | Build the ready work test first while the board follows live; CI verifies, the agent never marks anything done |
| `release_next` | `projectId` | Build the next release: new and modified items, and delete what was removed |

### `gen_*` — run VibeMap's own generators

The `author_*` prompts above run on **your** model: your agent does the thinking and VibeMap just stores the result. The `gen_*` prompts are the other half — they run VibeMap's hosted generation pipelines, the same ones behind the app's `/gen-…` slash commands. They are **metered** (they draw down the project owner's VibeMap token budget) and **asynchronous** (you get a `sessionId` back and poll `vibemap_get_generation_status`).

| Prompt | Args | Description |
|---|---|---|
| `gen_personas` | `projectId` | Generate personas — who you're building for |
| `gen_features` | `projectId` | Generate features — the set every story, page and table hangs off |
| `gen_stories` | `projectId` | Generate user stories from your features |
| `gen_criteria` | `projectId` | Derive acceptance criteria from features and stories |
| `gen_pages` | `projectId` | Generate the page architecture from features and stories |
| `gen_schema` | `projectId` | Generate the database schema — tables and relationships |
| `gen_sync_criteria_from_pages` | `projectId` | Cross-check acceptance criteria against your page layouts |

## Reporting test results from CI

`ci-report` turns a test run into review results. Tag each test name with the acceptance criterion it proves, for example `[AC-042] rejects an empty title`. After the run, post the report:

```bash
VIBEMAP_CI_TOKEN=... npx @vibemap.ai/mcp-server ci-report \
  --junit junit.xml --project <project-id>
```

Every criterion that is in review and mentioned by the report is resolved from its own tests: passed when all of them passed, failed when any failed (the failing test names go back to the agent). Criteria that are not in review, or are unknown, are listed and left alone.

- Formats: `--junit` (JUnit XML), `--vitest` and `--playwright` (each tool's JSON reporter). Pass several to combine them.
- `VIBEMAP_CI_TOKEN` must be a CI-review token (Account, Developer, scope "CI review"). An agent token is refused.
- The run URL and commit are picked up automatically on GitHub Actions; otherwise pass `--run-url` and `--sha`.
- Exit codes: `0` reported, `1` the server rejected the report or could not be reached, `2` bad usage, `3` no tagged tests with `--strict`.
- `--dry-run` prints the request without sending it.

## Documentation

Full docs at [vibemap.ai/docs/developer-docs/mcp-server/introduction](https://vibemap.ai/docs/developer-docs/mcp-server/introduction)

## License

MIT
