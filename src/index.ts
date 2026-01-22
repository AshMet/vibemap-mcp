import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { VibePlanClient } from "./vibe-client.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

const API_KEY = process.env.VIBEPLAN_API_KEY;
const BASE_URL = process.env.VIBEPLAN_BASE_URL || "http://localhost:3000";

if (!API_KEY) {
  throw new Error("VIBEPLAN_API_KEY environment variable is required");
}

const vibeClient = new VibePlanClient({
  baseUrl: BASE_URL,
  apiKey: API_KEY,
});

const server = new Server(
  {
    name: "vibeplan-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_projects",
        description: "List all projects in VibePlan",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_project_context",
        description: "Get full context for a project including features and stories",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
          },
          required: ["projectId"],
        },
      },
      {
        name: "scan_codebase",
        description: "Scan local codebase to prepare for synchronization",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Local path to scan" },
            depth: { type: "number", default: 3 },
          },
          required: ["path"],
        },
      },
      {
        name: "sync_to_vibeplan",
        description: "Sync local codebase state to VibePlan (creates features/stories based on code)",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            localPath: { type: "string" },
          },
          required: ["projectId", "localPath"],
        },
      },
      {
        name: "update_story_status",
        description: "Update the status of a user story in VibePlan",
        inputSchema: {
          type: "object",
          properties: {
            storyId: { type: "string" },
            status: {
              type: "string",
              enum: ["draft", "open", "in_progress", "completed"],
            },
          },
          required: ["storyId", "status"],
        },
      },
    ],
  };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "list_projects": {
      const projects = await vibeClient.listProjects();
      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      };
    }

    case "get_project_context": {
      const { projectId } = request.params.arguments as any;
      const project = await vibeClient.getProject(projectId);
      const features = await vibeClient.listFeatures(projectId);
      const stories = await vibeClient.listUserStories(projectId);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ project, features, stories }, null, 2),
          },
        ],
      };
    }

    case "scan_codebase": {
      const { path: scanPath, depth } = request.params.arguments as any;
      const structure = await walkDir(scanPath, depth || 3);
      return {
        content: [{ type: "text", text: structure }],
      };
    }

    case "sync_to_vibeplan": {
      const { projectId, localPath } = request.params.arguments as any;
      
      // 1. Scan codebase
      const structure = await walkDir(localPath, 3);
      
      // 2. Submit task to VibePlan to "Reverse Engineer"
      const task = await vibeClient.submitTask({
        title: "Reverse Engineer Codebase",
        prompt: `Scan results for local path: ${localPath}\n\nStructure:\n${structure}\n\nPlease analyze this existing codebase and generate corresponding features and user stories in VibePlan.`,        projectId,
        taskType: "features",
      });

      return {
        content: [
          {
            type: "text",
            text: `Synchronization task started. Session ID: ${task.sessionId}. VibePlan AI is now mapping your code to features.`,          },
        ],
      };
    }

    case "update_story_status": {
      const { storyId, status } = request.params.arguments as any;
      await vibeClient.updateUserStory(storyId, { status });
      return {
        content: [{ type: "text", text: `Story ${storyId} status updated to ${status}` }],
      };
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

/**
 * Helper to walk directory and build a string representation
 */
async function walkDir(dir: string, maxDepth: number, currentDepth = 0): Promise<string> {
  if (currentDepth > maxDepth) return "";
  
  let result = "";
  const files = await fs.readdir(dir, { withFileTypes: true });
  
  for (const file of files) {
    if (file.name === "node_modules" || file.name === ".git" || file.name === ".next") continue;
    
    const indent = "  ".repeat(currentDepth);
    result += `${indent}${file.isDirectory() ? "[DIR] " : ""}${file.name}\n`;
    
    if (file.isDirectory()) {
      result += await walkDir(path.join(dir, file.name), maxDepth, currentDepth + 1);
    }
  }
  
  return result;
}

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibePlan MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
