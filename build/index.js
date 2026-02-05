import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { walkDir } from "./utils.js";
import { VibeMapClient } from "./vibe-client.js";

const getVibeClient = () => {
  const apiKey = process.env.VIBEMAP_API_KEY;
  const baseUrl = process.env.VIBEMAP_BASE_URL || "http://localhost:3000";
  if (!apiKey) {
    throw new McpError(ErrorCode.InternalError, "VIBEMAP_API_KEY environment variable is required");
  }
  console.error(`[DEBUG] Using API Key: ${apiKey.substring(0, 10)}...`);
  return new VibeMapClient({
    baseUrl,
    apiKey,
  });
};
export const server = new Server(
  {
    name: "vibemap-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);
/**
 * Handler for listing tools
 */
export async function handleListTools() {
  return {
    tools: [
      {
        name: "list_projects",
        description: "List all projects in VibeMap",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_project_context",
        description:
          "Get context for a project including features, stories, personas, pages, and schema.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            includeFeatures: { type: "boolean", default: true },
            includeStories: { type: "boolean", default: true },
            includePersonas: { type: "boolean", default: true },
            includePages: { type: "boolean", default: true },
            includeSchema: { type: "boolean", default: true },
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
        name: "sync_to_vibemap",
        description:
          "Sync local codebase state to VibeMap (creates features/stories based on code)",
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
        description: "Update the status of a user story in VibeMap",
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
}
/**
 * Helper to strip unwanted fields from objects and arrays based on object type
 */
function stripUnwantedFields(data, type) {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map((item) => stripUnwantedFields(item, type));
  }
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    // General exclusions for all objects
    if (
      key === "slug" ||
      key === "embedding" ||
      key === "created_at" ||
      key === "updated_at" ||
      key === "project_id" ||
      key === "original_prompt"
    ) {
      continue;
    }
    // Specific exclusions based on entity type
    // We only apply these if the object looks like the entity (has an id)
    const hasId = "id" in data;
    if (hasId && type === "story") {
      if (key === "persona_id" || key === "title" || key === "features") continue;
    } else if (hasId && type === "persona") {
      // Keep only id, name, user_role, tagline, avatar_description
      const allowedKeys = ["id", "name", "user_role", "tagline", "avatar_description"];
      if (!allowedKeys.includes(key)) continue;
    } else if (hasId && type === "page") {
      // Keep only id, name, description, prompt, path
      const allowedKeys = ["id", "name", "description", "prompt", "path"];
      if (!allowedKeys.includes(key)) continue;
    } else if (hasId && type === "section") {
      // Keep only id, page_id, name, description
      const allowedKeys = ["id", "page_id", "name", "description"];
      if (!allowedKeys.includes(key)) continue;
    }
    // Recursively process objects and arrays
    // IMPORTANT: Clear the type for nested objects so we don't accidentally strip their fields
    // unless they are part of the same array (handled by Array.isArray above)
    result[key] = stripUnwantedFields(value);
  }
  return result;
}
/**
 * Handler for calling tools
 */
export async function handleCallTool(request) {
  const vibeClient = getVibeClient();
  console.error(`[DEBUG] Received tool call: ${request.params.name}`, request.params.arguments);
  try {
    switch (request.params.name) {
      case "list_projects": {
        console.error("[DEBUG] Calling vibeClient.listProjects()");
        const projects = await vibeClient.listProjects();
        const streamlinedProjects = stripUnwantedFields(projects);
        console.error(`[DEBUG] Success: found ${projects.length} projects`);
        return {
          content: [{ type: "text", text: JSON.stringify(streamlinedProjects, null, 2) }],
        };
      }
      case "get_project_context": {
        const {
          projectId,
          includeFeatures = true,
          includeStories = true,
          includePersonas = true,
          includePages = true,
          includeSchema = true,
        } = request.params.arguments;
        console.error(
          `[DEBUG] Getting context for project: ${projectId} (Features: ${includeFeatures}, Stories: ${includeStories}, Personas: ${includePersonas}, Pages: ${includePages}, Schema: ${includeSchema})`
        );
        // Fetch base project (always includes analysis data from API)
        const project = await vibeClient.getProject(projectId);
        // Extract all useful objects from analysis before we delete/streamline the project object
        const analysis = project.analysis || {};
        // Streamline project context to save tokens and improve quality
        const streamlinedProject = stripUnwantedFields(project);
        // Remove unwanted top-level fields (additional ones specific to project)
        const projectSpecificFieldsToRemove = [
          "project_type",
          "business_context",
          "technical_context",
          "assumptions",
          "risks",
          "goals",
          "future_considerations",
          "app_architecture_prefs",
          "analysis", // We've already extracted what we need
        ];
        for (const field of projectSpecificFieldsToRemove) {
          delete streamlinedProject[field];
        }
        // Streamline target audience (keep only primary)
        if (streamlinedProject.target_audience) {
          streamlinedProject.target_audience = {
            primary: streamlinedProject.target_audience.primary,
          };
        }
        // Streamline constraints (remove budget, business, timeline, regulatory)
        if (streamlinedProject.constraints) {
          const { budget, business, timeline, regulatory, ...remainingConstraints } =
            streamlinedProject.constraints;
          streamlinedProject.constraints = remainingConstraints;
        }
        const response = { project: streamlinedProject };
        // Add features
        if (includeFeatures) {
          let features = analysis.features || [];
          if (features.length === 0) {
            console.error("[DEBUG] Fetching features separately...");
            features = await vibeClient.listFeatures(projectId);
          }
          response.features = stripUnwantedFields(features, "feature");
        }
        // Add user stories
        if (includeStories) {
          let stories = analysis.user_stories || [];
          if (stories.length === 0) {
            console.error("[DEBUG] Fetching user stories separately...");
            const storiesResult = await vibeClient.listUserStories(projectId);
            stories = storiesResult.user_stories || storiesResult;
          }
          response.stories = stripUnwantedFields(stories, "story");
        }
        // Add personas
        if (includePersonas) {
          response.personas = stripUnwantedFields(analysis.personas || [], "persona");
        }
        // Add pages and sections
        if (includePages) {
          response.pages = stripUnwantedFields(analysis.pages || [], "page");
          response.sections = stripUnwantedFields(analysis.sections || [], "section");
        }
        // Add database schema
        if (includeSchema) {
          response.dbSchema = stripUnwantedFields(analysis.dbSchema || null);
        }
        console.error("[DEBUG] Context retrieved and streamlined successfully");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }
      case "scan_codebase": {
        const { path: scanPath, depth } = request.params.arguments;
        console.error(`[DEBUG] Scanning codebase at ${scanPath} (depth: ${depth})`);
        const structure = await walkDir(scanPath, depth || 3);
        return {
          content: [{ type: "text", text: structure }],
        };
      }
      case "sync_to_vibemap": {
        const { projectId, localPath } = request.params.arguments;
        console.error(`[DEBUG] Syncing ${localPath} to project ${projectId}`);
        // 1. Scan codebase
        const structure = await walkDir(localPath, 3);
        // 2. Submit task to VibeMap to "Reverse Engineer"
        const task = await vibeClient.submitTask({
          title: "Reverse Engineer Codebase",
          prompt: `Scan results for local path: ${localPath}\n\nStructure:\n${structure}\n\nPlease analyze this existing codebase and generate corresponding features and user stories in VibeMap.`,
          projectId,
          taskType: "features",
        });
        console.error(`[DEBUG] Sync task submitted: ${task.sessionId}`);
        return {
          content: [
            {
              type: "text",
              text: `Synchronization task started. Session ID: ${task.sessionId}. VibeMap AI is now mapping your code to features.`,
            },
          ],
        };
      }
      case "update_story_status": {
        const { storyId, status } = request.params.arguments;
        console.error(`[DEBUG] Updating story ${storyId} to ${status}`);
        await vibeClient.updateUserStory(storyId, { status });
        return {
          content: [{ type: "text", text: `Story ${storyId} status updated to ${status}` }],
        };
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    console.error("[ERROR] Tool execution failed:", error);
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, handleListTools);
/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, handleCallTool);
/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VibeMap MCP Server running on stdio");
}
if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
