# Testing VibePlan MCP Server

This document outlines the testing procedures for the VibePlan MCP Server.

## 1. Unit Tests

We use [Vitest](https://vitest.dev/) for unit testing. The tests cover the API client, directory scanning logic, and tool handlers.

### Running Tests

```bash
cd mcp-server
pnpm install
pnpm test
```

### Test Coverage
- `vibe-client.test.ts`: Verifies communication with the VibePlan API, including error handling and request formatting.
- `walk-dir.test.ts`: Verifies the recursive directory scanning logic, depth limits, and ignored paths.
- `tools.test.ts`: Verifies that tool calls are correctly routed and arguments are processed properly.

---

## 2. Manual Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a browser-based tool for testing MCP servers. It provides a visual interface to list tools and see the exact JSON-RPC traffic.

### Step-by-Step Instructions

1.  **Verify Connection (Optional but Recommended)**:
    Before starting the inspector, verify your API key and server are working:
    ```bash
    curl -H "Authorization: Bearer vp_your_token_here" http://localhost:3000/api/crud/projects
    ```
    If this returns JSON, your setup is correct. If it hangs, your VibePlan server is not responding.

2.  **Build the Server**:
    The inspector runs the compiled JavaScript code, so ensure you have a fresh build:
    ```bash
    cd mcp-server
    pnpm install
    pnpm run build
    ```

3.  **Set Environment Variables**:
    You must provide your VibePlan API key. On macOS/Linux:
    ```bash
    export VIBEPLAN_API_KEY=vp_your_token_here
    export VIBEPLAN_BASE_URL=http://localhost:3000 # Optional
    ```

4.  **Start the Inspector**:
    Run the inspector and point it to the built `index.js`:
    ```bash
    npx @modelcontextprotocol/inspector node build/index.js
    ```

5.  **Get the Proxy Session Token**:
    Look at your terminal output. You should see a line like this:
    ```text
    MCP Inspector is running on http://127.0.0.1:6274 (or similar)
    Proxy session token: 12345-abcde-...
    ```
    **Copy this token and the URL.**

6.  **Configure the Browser UI**:
    *   Open the URL from your terminal in your browser.
    *   You will see a "Connection Error" initially. This is normal.
    *   Look for the **Configuration** or **Settings** button (often a gear icon or a specific "Configuration" tab).
    *   Find the field labeled **Proxy Session Token**.
    *   **Paste the token** you copied from the terminal.
    *   Click **Connect** or **Save**.

7.  **Verify Tools**:
    *   Once connected, click the **List Tools** button.
    *   You should see `list_projects`, `get_project_context`, `scan_codebase`, etc.
    *   Select a tool (e.g., `list_projects`) and click **Run Tool** to see the live output from your VibePlan account.

### Troubleshooting "Request Timed Out" or "Connection Error"
- **VibePlan Not Running**: Ensure your VibePlan web application is running in another terminal (`pnpm dev`). Verify it's on port 3000:
  ```bash
  lsof -i :3000
  ```
- **Wrong Base URL**: If your server is running on a different port, set `VIBEPLAN_BASE_URL`:
  ```bash
  export VIBEPLAN_BASE_URL=http://localhost:3001
  ```
- **Timeout**: Tools now have a 30-second timeout. If requests still fail, check your VibePlan server logs for slow database queries.
- **Environment Variables**:
  - Verify `VIBEPLAN_API_KEY` is set in your terminal **before** starting the inspector.
  - Note: `npx` may not inherit variables if not exported correctly. Use `export` before running `npx`.
- **Logs**: Check the terminal where you ran `npx ... inspector`. The server now outputs `[FETCH]` logs showing exactly which URL is being called.
- **Build Missing**: If you see `Error: Cannot find module...`, make sure you ran `pnpm run build`.
- **Token Mismatch**: Ensure you copied the *latest* token from the terminal. If you restart the inspector, the token changes.
- **API Key**: If tools return 401 errors, verify your `VIBEPLAN_API_KEY` is correct.
- **Node Version**: Ensure you are using Node.js v18 or higher.

---

## 3. Edge Case Verification

The unit tests include verification for several edge cases:
- **Empty Directories**: Verified in `walk-dir.test.ts`.
- **Special Characters**: Verified in `tools.test.ts` (Project IDs with symbols).
- **Long Paths**: Verified in `tools.test.ts` (Paths exceeding 1000 characters).
- **Network Failures**: Verified in `vibe-client.test.ts` (500 errors, malformed JSON).
- **Missing Auth**: Verified in `tools.test.ts` (Ensures server fails gracefully if `API_KEY` is missing).
