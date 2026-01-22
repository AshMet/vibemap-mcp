# VibePlan MCP Server

A Model Context Protocol (MCP) server that connects VibePlan to your local development environment.

## Features

-   **Reverse Engineering**: Automatically generate VibePlan features and user stories by scanning your existing local codebase.
-   **Context Injection**: Provide your IDE's AI assistant with full project context from VibePlan.
-   **Status Synchronization**: Update the progress of user stories and acceptance criteria directly from your CLI or IDE.
-   **Project Management**: List and inspect VibePlan projects without leaving your terminal.

## Setup

### 1. Build the server
```bash
cd mcp-server
npm install
npm run build
```

### 2. Obtain an API Key
1.  Log in to your VibePlan web application.
2.  Navigate to **Account > Developer**.
3.  Click **Generate Key**, give it a name (e.g., "Claude Desktop"), and copy the generated token (starts with `vp_`).
    *Note: The token is only shown once.*

### 3. Configure Environment Variables
The server requires the following environment variables:
-   `VIBEPLAN_API_KEY`: Your VibePlan Personal Access Token (`vp_...`).
-   `VIBEPLAN_BASE_URL`: The URL of your VibePlan instance (default: `http://localhost:3000`).

### 3. Usage with Claude Desktop
Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vibeplan": {
      "command": "node",
      "args": ["/absolute/path/to/VibePlan/mcp-server/build/index.js"],
      "env": {
        "VIBEPLAN_API_KEY": "your_api_token_here",
        "VIBEPLAN_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Available Tools

-   `list_projects`: Get a list of all your VibePlan projects.
-   `get_project_context`: Retrieve full details (features, stories) for a specific project.
-   `scan_codebase`: Walk a local directory to visualize the file structure.
-   `sync_to_vibeplan`: The "Reverse Engineering" tool. Scans your code and tells VibePlan to generate matching assets.
-   `update_story_status`: Change user story status (draft, open, in_progress, completed).
