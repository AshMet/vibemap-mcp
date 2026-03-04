#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { buildCodebaseDigest, walkDir } from "./utils.js";
import {
  type CriterionStatus,
  type FeatureStatus,
  type KanbanEntityType,
  type StoryStatus,
  VibeMapClient,
} from "./vibe-client.js";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ProjectIdSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

const FeatureStatusEnum = z.enum(["draft", "open", "in_progress", "completed"]);
const StoryStatusEnum = z.enum(["draft", "has_criteria", "open", "in_progress", "completed"]);
const CriterionStatusEnum = z.enum(["draft", "pending", "passed", "failed"]);

const ListFeaturesSchema = ProjectIdSchema.extend({
  status: FeatureStatusEnum.optional().describe("Filter by status"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
  category: z.enum(["core", "enhancement", "infrastructure"]).optional().describe("Filter by category"),
  search: z.string().optional().describe("Search features by name or description"),
  limit: z.number().int().min(1).max(100).default(50).describe("Max results to return"),
  offset: z.number().int().min(0).default(0).describe("Pagination offset"),
});

const CreateFeatureSchema = ProjectIdSchema.extend({
  name: z.string().min(1).describe("Feature name"),
  description: z.string().optional().describe("Feature description"),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  category: z.enum(["core", "enhancement", "infrastructure"]).optional().default("core"),
  complexity: z.enum(["low", "medium", "high"]).optional().default("medium"),
  effort: z.enum(["xs", "s", "m", "l", "xl"]).optional().default("m"),
  business_value: z.enum(["low", "medium", "high"]).optional().default("medium"),
});

const UpdateFeatureSchema = z.object({
  featureId: z.string().min(1, "featureId is required"),
  name: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  category: z.enum(["core", "enhancement", "infrastructure"]).optional(),
  complexity: z.enum(["low", "medium", "high"]).optional(),
  effort: z.enum(["xs", "s", "m", "l", "xl"]).optional(),
  business_value: z.enum(["low", "medium", "high"]).optional(),
  status: FeatureStatusEnum.optional(),
});

const ListStoriesSchema = z.object({
  projectId: z.string().optional().describe("Filter by project ID"),
  featureId: z.string().optional().describe("Filter by feature ID (overrides projectId)"),
  status: StoryStatusEnum.optional().describe("Filter by status"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
}).refine((d) => d.projectId || d.featureId, {
  message: "Either projectId or featureId must be provided",
});

const CreateStorySchema = z.object({
  featureId: z.string().min(1, "featureId is required"),
  title: z.string().min(1, "title is required"),
  description: z.string().min(1, "description is required"),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  userRole: z.string().optional().default("user").describe("Role of the user (e.g., 'admin', 'developer')"),
  iWantTo: z.string().optional().describe("The 'I want to' part of the user story"),
  soThat: z.string().optional().describe("The 'so that' part of the user story"),
  estimatedEffort: z.number().int().min(0).optional().default(0),
});

const UpdateStorySchema = z.object({
  storyId: z.string().min(1, "storyId is required"),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: StoryStatusEnum.optional(),
  estimatedEffort: z.number().int().min(0).optional(),
  userRole: z.string().optional(),
  iWantTo: z.string().optional(),
  soThat: z.string().optional(),
});

const ListCriteriaSchema = z.object({
  storyId: z.string().optional().describe("Filter by user story ID"),
  featureId: z.string().optional().describe("Filter by feature ID"),
  projectId: z.string().optional().describe("Filter by project ID"),
  status: CriterionStatusEnum.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
}).refine((d) => d.storyId || d.featureId || d.projectId, {
  message: "At least one of storyId, featureId, or projectId must be provided",
});

const UpdateCriterionSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
  status: CriterionStatusEnum.optional(),
  givenCondition: z.string().optional().describe("Given condition (BDD format)"),
  whenAction: z.string().optional().describe("When action (BDD format)"),
  thenOutcome: z.string().optional().describe("Expected outcome (BDD format)"),
  description: z.string().optional(),
  scenarioCategory: z.enum(["happy_path", "error_scenario", "edge_case"]).optional(),
});

// Kanban status tool
const KanbanEntityTypeEnum = z.enum(["feature", "story", "criterion"]);

const UpdateKanbanStatusSchema = z.object({
  entityType: KanbanEntityTypeEnum.describe(
    "Type of entity: 'feature', 'story', or 'criterion'"
  ),
  entityId: z.string().min(1, "entityId is required"),
  newStatus: z.string().min(1, "newStatus is required"),
  notes: z.string().optional().describe("Optional notes about this status change"),
});

const GetKanbanBoardSchema = ProjectIdSchema.extend({
  includeCriteria: z.boolean().default(false).describe("Also fetch acceptance criteria per story"),
});

const GetProjectContextSchema = ProjectIdSchema.extend({
  includeFeatures: z.boolean().default(true),
  includeStories: z.boolean().default(true),
  includePersonas: z.boolean().default(true),
  includePages: z.boolean().default(true),
  includeSchema: z.boolean().default(true),
});

const ScanCodebaseSchema = z.object({
  localPath: z.string().min(1, "localPath is required").describe("Absolute path to the local codebase directory"),
  depth: z.number().int().min(1).max(8).default(4).describe("Max directory traversal depth"),
});

const AnalyzeCodebaseSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  localPath: z.string().min(1, "localPath is required").describe("Absolute path to the local codebase directory"),
  depth: z.number().int().min(1).max(8).default(4),
  taskTitle: z.string().optional().default("Reverse Engineer Codebase").describe("Title for the generation task"),
});

const GetGenerationStatusSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required").describe("Session ID returned by vibemap_analyze_codebase"),
});

// ─── Kanban transition validation ─────────────────────────────────────────────

const FEATURE_TRANSITIONS: Record<FeatureStatus, FeatureStatus[]> = {
  draft: ["open"],
  open: ["in_progress", "draft"],
  in_progress: ["completed", "open"],
  completed: ["in_progress"],
};

const STORY_TRANSITIONS: Record<StoryStatus, StoryStatus[]> = {
  draft: ["open", "has_criteria"],
  has_criteria: ["open", "draft"],
  open: ["in_progress", "has_criteria", "draft"],
  in_progress: ["completed", "open"],
  completed: ["in_progress"],
};

const CRITERION_TRANSITIONS: Record<CriterionStatus, CriterionStatus[]> = {
  draft: ["pending"],
  pending: ["passed", "failed", "draft"],
  passed: ["pending"],
  failed: ["pending"],
};

function validateKanbanTransition(
  entityType: KanbanEntityType,
  currentStatus: string,
  newStatus: string
): { valid: boolean; error?: string } {
  const transitions =
    entityType === "feature"
      ? FEATURE_TRANSITIONS
      : entityType === "story"
        ? STORY_TRANSITIONS
        : CRITERION_TRANSITIONS;

  const allowed = transitions[currentStatus as keyof typeof transitions];
  if (!allowed) {
    return { valid: false, error: `Unknown current status '${currentStatus}' for ${entityType}` };
  }
  if (!allowed.includes(newStatus as never)) {
    return {
      valid: false,
      error: `Invalid transition: ${entityType} cannot move from '${currentStatus}' to '${newStatus}'. Allowed next statuses: [${allowed.join(", ")}]`,
    };
  }
  return { valid: true };
}

// ─── Field stripping for token efficiency ─────────────────────────────────────

function stripFields(data: unknown, remove: string[]): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map((i) => stripFields(i, remove));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (remove.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

const GLOBAL_STRIP = ["slug", "embedding", "created_at", "updated_at", "original_prompt"];

// ─── Server setup ─────────────────────────────────────────────────────────────

export const server = new Server(
  {
    name: "vibemap-mcp-server",
    version: "2.0.0",
  },
  {
    capabilities: { tools: {} },
  }
);

const getVibeClient = () => {
  const apiKey = process.env.VIBEMAP_API_KEY;
  const baseUrl = process.env.VIBEMAP_BASE_URL || "http://localhost:3000";
  if (!apiKey) {
    throw new McpError(ErrorCode.InternalError, "VIBEMAP_API_KEY environment variable is required");
  }
  return new VibeMapClient({ baseUrl, apiKey });
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

export async function handleListTools() {
  return {
    tools: [
      // ── Group 1: Projects ──────────────────────────────────────────────────
      {
        name: "vibemap_list_projects",
        description:
          "List all VibeMap projects for the authenticated user. Returns project IDs, names, descriptions, and status.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "vibemap_get_project_context",
        description:
          "Retrieve the full context of a VibeMap project including features, user stories, personas, pages, and database schema. Use this before building a feature to understand all the specs.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "The VibeMap project ID" },
            includeFeatures: { type: "boolean", default: true },
            includeStories: { type: "boolean", default: true },
            includePersonas: { type: "boolean", default: true },
            includePages: { type: "boolean", default: true },
            includeSchema: { type: "boolean", default: true },
          },
          required: ["projectId"],
        },
      },

      // ── Group 2: Features ──────────────────────────────────────────────────
      {
        name: "vibemap_list_features",
        description:
          "List features for a VibeMap project. Supports filtering by status, priority, category, and search. Returns paginated results.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            status: { type: "string", enum: ["draft", "open", "in_progress", "completed"] },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            category: { type: "string", enum: ["core", "enhancement", "infrastructure"] },
            search: { type: "string" },
            limit: { type: "number", default: 50 },
            offset: { type: "number", default: 0 },
          },
          required: ["projectId"],
        },
      },
      {
        name: "vibemap_create_feature",
        description:
          "Create a new feature in a VibeMap project. Use this when reverse-engineering a codebase to register discovered capabilities.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
            category: { type: "string", enum: ["core", "enhancement", "infrastructure"], default: "core" },
            complexity: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
            effort: { type: "string", enum: ["xs", "s", "m", "l", "xl"], default: "m" },
            business_value: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
          },
          required: ["projectId", "name"],
        },
      },
      {
        name: "vibemap_update_feature",
        description:
          "Update an existing feature's fields or status in VibeMap.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        inputSchema: {
          type: "object",
          properties: {
            featureId: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            category: { type: "string", enum: ["core", "enhancement", "infrastructure"] },
            complexity: { type: "string", enum: ["low", "medium", "high"] },
            effort: { type: "string", enum: ["xs", "s", "m", "l", "xl"] },
            business_value: { type: "string", enum: ["low", "medium", "high"] },
            status: { type: "string", enum: ["draft", "open", "in_progress", "completed"] },
          },
          required: ["featureId"],
        },
      },

      // ── Group 3: User Stories ──────────────────────────────────────────────
      {
        name: "vibemap_list_user_stories",
        description:
          "List user stories for a project or feature. Filter by status, priority. Returns paginated results with full story detail.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Filter by project (use featureId for more specific results)" },
            featureId: { type: "string", description: "Filter by specific feature" },
            status: { type: "string", enum: ["draft", "has_criteria", "open", "in_progress", "completed"] },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            search: { type: "string" },
            limit: { type: "number", default: 50 },
            offset: { type: "number", default: 0 },
          },
        },
      },
      {
        name: "vibemap_create_user_story",
        description:
          "Create a new user story inside a VibeMap feature. Provide the user role, action, and expected outcome.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        inputSchema: {
          type: "object",
          properties: {
            featureId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
            userRole: { type: "string", description: "e.g., 'admin', 'developer', 'guest'" },
            iWantTo: { type: "string", description: "What the user wants to do" },
            soThat: { type: "string", description: "The benefit / outcome" },
            estimatedEffort: { type: "number", default: 0 },
          },
          required: ["featureId", "title", "description"],
        },
      },
      {
        name: "vibemap_update_user_story",
        description:
          "Update an existing user story's fields or status in VibeMap.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        inputSchema: {
          type: "object",
          properties: {
            storyId: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            status: { type: "string", enum: ["draft", "has_criteria", "open", "in_progress", "completed"] },
            estimatedEffort: { type: "number" },
            userRole: { type: "string" },
            iWantTo: { type: "string" },
            soThat: { type: "string" },
          },
          required: ["storyId"],
        },
      },

      // ── Group 4: Acceptance Criteria ───────────────────────────────────────
      {
        name: "vibemap_list_acceptance_criteria",
        description:
          "List acceptance criteria for a story, feature, or project. Returns BDD-formatted criteria (Given/When/Then) with status.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          properties: {
            storyId: { type: "string" },
            featureId: { type: "string" },
            projectId: { type: "string" },
            status: { type: "string", enum: ["draft", "pending", "passed", "failed"] },
            limit: { type: "number", default: 50 },
            offset: { type: "number", default: 0 },
          },
        },
      },
      {
        name: "vibemap_update_acceptance_criterion",
        description:
          "Update an acceptance criterion's status or content. Use status 'passed' when your code satisfies the criterion, 'failed' when it does not.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        inputSchema: {
          type: "object",
          properties: {
            criterionId: { type: "string" },
            status: { type: "string", enum: ["draft", "pending", "passed", "failed"] },
            givenCondition: { type: "string" },
            whenAction: { type: "string" },
            thenOutcome: { type: "string" },
            description: { type: "string" },
            scenarioCategory: { type: "string", enum: ["happy_path", "error_scenario", "edge_case"] },
          },
          required: ["criterionId"],
        },
      },

      // ── Group 5: Kanban Tracking ───────────────────────────────────────────
      {
        name: "vibemap_update_kanban_status",
        description:
          "Atomically advance or update the kanban status of a feature, user story, or acceptance criterion. Validates allowed state transitions and prevents invalid moves. Call this when you start or finish implementing something.\n\nFeature stages: draft → open → in_progress → completed\nStory stages: draft → has_criteria → open → in_progress → completed\nCriterion stages: draft → pending → passed | failed",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        inputSchema: {
          type: "object",
          properties: {
            entityType: {
              type: "string",
              enum: ["feature", "story", "criterion"],
              description: "Type of item to update",
            },
            entityId: { type: "string", description: "ID of the feature, story, or criterion" },
            newStatus: { type: "string", description: "Target kanban status" },
            notes: { type: "string", description: "Optional context about why this transition was made" },
          },
          required: ["entityType", "entityId", "newStatus"],
        },
      },
      {
        name: "vibemap_get_kanban_board",
        description:
          "Get a real-time kanban board view of a project grouped by status columns. Shows features with their stories nested underneath. Ideal for an IDE agent to understand what's planned, in progress, and done.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            includeCriteria: { type: "boolean", default: false, description: "Include acceptance criteria counts per story" },
          },
          required: ["projectId"],
        },
      },

      // ── Group 6: Codebase Analysis ─────────────────────────────────────────
      {
        name: "vibemap_scan_codebase",
        description:
          "Scan a local directory and return a formatted tree view plus file statistics. Use this to explore and understand an existing codebase before syncing to VibeMap.",
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        inputSchema: {
          type: "object",
          properties: {
            localPath: { type: "string", description: "Absolute path to the local project directory" },
            depth: { type: "number", default: 4, description: "Max directory depth to traverse" },
          },
          required: ["localPath"],
        },
      },
      {
        name: "vibemap_analyze_codebase",
        description:
          "Scan a local codebase and submit it to VibeMap for AI-powered reverse engineering. VibeMap will analyze the code structure and key file contents to automatically generate features, user stories, and acceptance criteria. Returns a sessionId to poll with vibemap_get_generation_status.",
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "The VibeMap project to populate with discovered specs" },
            localPath: { type: "string", description: "Absolute path to the local project directory" },
            depth: { type: "number", default: 4 },
            taskTitle: { type: "string", default: "Reverse Engineer Codebase" },
          },
          required: ["projectId", "localPath"],
        },
      },

      // ── Group 7: Generation Status ─────────────────────────────────────────
      {
        name: "vibemap_get_generation_status",
        description:
          "Poll the status of a VibeMap AI generation task (e.g., reverse engineering or spec generation). Use the sessionId returned by vibemap_analyze_codebase.",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID from vibemap_analyze_codebase" },
          },
          required: ["sessionId"],
        },
      },
    ],
  };
}

// ─── Tool call handler ────────────────────────────────────────────────────────

export async function handleCallTool(request: CallToolRequest) {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── vibemap_list_projects ──────────────────────────────────────────────
      case "vibemap_list_projects": {
        const client = getVibeClient();
        const projects = await client.listProjects();
        const clean = stripFields(projects, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_get_project_context ────────────────────────────────────────
      case "vibemap_get_project_context": {
        const parsed = GetProjectContextSchema.parse(args);
        const client = getVibeClient();

        const project = await client.getProject(parsed.projectId);
        const analysis = (project.analysis as Record<string, unknown>) || {};

        // Build streamlined project object
        const projectFieldsToRemove = [
          ...GLOBAL_STRIP,
          "project_type", "business_context", "technical_context",
          "assumptions", "risks", "goals", "future_considerations",
          "app_architecture_prefs", "analysis",
        ];
        const cleanProject = stripFields(project, projectFieldsToRemove) as Record<string, unknown>;

        // Keep only primary target audience
        if (cleanProject.target_audience && typeof cleanProject.target_audience === "object") {
          cleanProject.target_audience = {
            primary: (cleanProject.target_audience as Record<string, unknown>).primary,
          };
        }

        // Strip budget/timeline from constraints
        if (cleanProject.constraints && typeof cleanProject.constraints === "object") {
          const { budget: _b, timeline: _t, regulatory: _r, ...rest } = cleanProject.constraints as Record<string, unknown>;
          cleanProject.constraints = rest;
        }

        const response: Record<string, unknown> = { project: cleanProject };

        if (parsed.includeFeatures) {
          let features = (analysis.features as unknown[]) || [];
          if (features.length === 0) {
            const result = await client.listFeatures({ project_id: parsed.projectId, limit: 100 });
            features = (result as { features: unknown[] }).features || [];
          }
          response.features = stripFields(features, GLOBAL_STRIP);
        }

        if (parsed.includeStories) {
          let stories = (analysis.user_stories as unknown[]) || [];
          if (stories.length === 0) {
            const result = await client.listUserStories({ project_id: parsed.projectId, limit: 100 });
            stories = (result as { user_stories: unknown[] }).user_stories || [];
          }
          response.stories = stripFields(stories, [...GLOBAL_STRIP, "persona_id", "features"]);
        }

        if (parsed.includePersonas) {
          const personas = (analysis.personas as unknown[]) || [];
          response.personas = (personas as Record<string, unknown>[]).map((p) => ({
            id: p.id, name: p.name, user_role: p.user_role, tagline: p.tagline, avatar_description: p.avatar_description,
          }));
        }

        if (parsed.includePages) {
          const pages = (analysis.pages as unknown[]) || [];
          response.pages = (pages as Record<string, unknown>[]).map((p) => ({
            id: p.id, name: p.name, description: p.description, path: p.path, prompt: p.prompt,
          }));
          const sections = (analysis.sections as unknown[]) || [];
          response.sections = (sections as Record<string, unknown>[]).map((s) => ({
            id: s.id, page_id: s.page_id, name: s.name, description: s.description,
          }));
        }

        if (parsed.includeSchema) {
          response.dbSchema = analysis.dbSchema || null;
        }

        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      }

      // ── vibemap_list_features ──────────────────────────────────────────────
      case "vibemap_list_features": {
        const parsed = ListFeaturesSchema.parse(args);
        const client = getVibeClient();
        const result = await client.listFeatures({
          project_id: parsed.projectId,
          status: parsed.status,
          priority: parsed.priority,
          category: parsed.category,
          search: parsed.search,
          limit: parsed.limit,
          offset: parsed.offset,
        });
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_create_feature ─────────────────────────────────────────────
      case "vibemap_create_feature": {
        const parsed = CreateFeatureSchema.parse(args);
        const client = getVibeClient();
        const feature = await client.createFeature({
          project_id: parsed.projectId,
          name: parsed.name,
          description: parsed.description,
          priority: parsed.priority,
          category: parsed.category,
          complexity: parsed.complexity,
          effort: parsed.effort,
          business_value: parsed.business_value,
        });
        const clean = stripFields(feature, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_update_feature ─────────────────────────────────────────────
      case "vibemap_update_feature": {
        const parsed = UpdateFeatureSchema.parse(args);
        const { featureId, ...updateData } = parsed;
        const client = getVibeClient();
        const result = await client.updateFeature(featureId, updateData);
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_list_user_stories ──────────────────────────────────────────
      case "vibemap_list_user_stories": {
        // Manual parse here since zod refine can't capture partial optional pattern well
        const raw = (args || {}) as Record<string, unknown>;
        if (!raw.projectId && !raw.featureId) {
          throw new McpError(ErrorCode.InvalidParams, "Either projectId or featureId must be provided");
        }
        const client = getVibeClient();
        const result = await client.listUserStories({
          project_id: raw.projectId as string | undefined,
          feature_id: raw.featureId as string | undefined,
          status: raw.status as StoryStatus | undefined,
          priority: raw.priority as "high" | "medium" | "low" | undefined,
          search: raw.search as string | undefined,
          limit: (raw.limit as number | undefined) ?? 50,
          offset: (raw.offset as number | undefined) ?? 0,
        });
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_create_user_story ──────────────────────────────────────────
      case "vibemap_create_user_story": {
        const parsed = CreateStorySchema.parse(args);
        const client = getVibeClient();
        const story = await client.createUserStory({
          feature_id: parsed.featureId,
          title: parsed.title,
          description: parsed.description,
          priority: parsed.priority,
          user_role: parsed.userRole,
          i_want_to: parsed.iWantTo,
          so_that: parsed.soThat,
          estimated_effort: parsed.estimatedEffort,
        });
        const clean = stripFields(story, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_update_user_story ──────────────────────────────────────────
      case "vibemap_update_user_story": {
        const parsed = UpdateStorySchema.parse(args);
        const { storyId, ...rest } = parsed;
        const client = getVibeClient();
        const result = await client.updateUserStory(storyId, {
          title: rest.title,
          description: rest.description,
          priority: rest.priority,
          status: rest.status,
          estimated_effort: rest.estimatedEffort,
          user_role: rest.userRole,
          i_want_to: rest.iWantTo,
          so_that: rest.soThat,
        });
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_list_acceptance_criteria ──────────────────────────────────
      case "vibemap_list_acceptance_criteria": {
        const raw = (args || {}) as Record<string, unknown>;
        if (!raw.storyId && !raw.featureId && !raw.projectId) {
          throw new McpError(ErrorCode.InvalidParams, "At least one of storyId, featureId, or projectId must be provided");
        }
        const client = getVibeClient();
        const result = await client.listAcceptanceCriteria({
          story_id: raw.storyId as string | undefined,
          feature_id: raw.featureId as string | undefined,
          project_id: raw.projectId as string | undefined,
          status: raw.status as CriterionStatus | undefined,
          limit: (raw.limit as number | undefined) ?? 50,
          offset: (raw.offset as number | undefined) ?? 0,
        });
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_update_acceptance_criterion ───────────────────────────────
      case "vibemap_update_acceptance_criterion": {
        const parsed = UpdateCriterionSchema.parse(args);
        const { criterionId, givenCondition, whenAction, thenOutcome, ...rest } = parsed;
        const client = getVibeClient();
        const result = await client.updateAcceptanceCriterion(criterionId, {
          ...rest,
          given_condition: givenCondition,
          when_action: whenAction,
          then_outcome: thenOutcome,
        });
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_update_kanban_status ───────────────────────────────────────
      case "vibemap_update_kanban_status": {
        const parsed = UpdateKanbanStatusSchema.parse(args);
        const { entityType, entityId, newStatus, notes } = parsed;
        const client = getVibeClient();

        // Fetch current status
        let currentStatus: string;
        if (entityType === "feature") {
          const feature = await client.getFeature(entityId) as Record<string, unknown>;
          currentStatus = feature.status as string;
        } else if (entityType === "story") {
          const story = await client.getUserStory(entityId) as Record<string, unknown>;
          currentStatus = story.status as string;
        } else {
          // criterion — fetch by ID
          const result = await client.getCriterion(entityId);
          currentStatus = (result?.status as string) ?? "draft";
        }

        // Validate transition
        const validation = validateKanbanTransition(
          entityType as KanbanEntityType,
          currentStatus,
          newStatus
        );
        if (!validation.valid) {
          return {
            isError: true,
            content: [{ type: "text", text: `Kanban transition error: ${validation.error}` }],
          };
        }

        // Perform update
        let updated: unknown;
        if (entityType === "feature") {
          updated = await client.updateFeature(entityId, { status: newStatus as FeatureStatus });
        } else if (entityType === "story") {
          updated = await client.updateUserStory(entityId, { status: newStatus as StoryStatus });
        } else {
          updated = await client.updateAcceptanceCriterion(entityId, { status: newStatus as CriterionStatus });
        }

        const noteStr = notes ? ` Note: ${notes}` : "";
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              entityType,
              entityId,
              previousStatus: currentStatus,
              newStatus,
              notes: noteStr || undefined,
              updated: stripFields(updated, GLOBAL_STRIP),
            }, null, 2),
          }],
        };
      }

      // ── vibemap_get_kanban_board ───────────────────────────────────────────
      case "vibemap_get_kanban_board": {
        const parsed = GetKanbanBoardSchema.parse(args);
        const client = getVibeClient();

        const [featuresResult, storiesResult] = await Promise.all([
          client.listFeatures({ project_id: parsed.projectId, limit: 100 }),
          client.listUserStories({ project_id: parsed.projectId, limit: 200 }),
        ]);

        const features = (featuresResult as { features: Record<string, unknown>[] }).features || [];
        const stories = (storiesResult as { user_stories: Record<string, unknown>[] }).user_stories || [];

        // Build feature → stories map
        const storyByFeature = new Map<string, Record<string, unknown>[]>();
        for (const story of stories) {
          const fid = story.feature_id as string;
          if (!storyByFeature.has(fid)) storyByFeature.set(fid, []);
          storyByFeature.get(fid)!.push(story);
        }

        // Group features by kanban column
        const board: Record<string, unknown[]> = {
          draft: [],
          open: [],
          in_progress: [],
          completed: [],
        };

        for (const feature of features) {
          const status = (feature.status as string) || "draft";
          const featureStories = storyByFeature.get(feature.id as string) || [];

          // Group stories by status for this feature
          const storyBoard: Record<string, unknown[]> = {
            draft: [], has_criteria: [], open: [], in_progress: [], completed: [],
          };
          for (const s of featureStories) {
            const ss = (s.status as string) || "draft";
            storyBoard[ss]?.push(stripFields(s, [...GLOBAL_STRIP, "features"]) as unknown);
          }

          const entry = {
            ...stripFields(feature, [...GLOBAL_STRIP, "projects"]) as object,
            _stories: storyBoard,
            _storyCount: featureStories.length,
            _completedStories: featureStories.filter((s) => s.status === "completed").length,
          };

          board[status]?.push(entry);
        }

        const summary = {
          projectId: parsed.projectId,
          board,
          _totals: {
            features: features.length,
            stories: stories.length,
            featuresByStatus: Object.fromEntries(
              Object.entries(board).map(([k, v]) => [k, v.length])
            ),
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      // ── vibemap_scan_codebase ──────────────────────────────────────────────
      case "vibemap_scan_codebase": {
        const parsed = ScanCodebaseSchema.parse(args);
        const tree = await walkDir(parsed.localPath, parsed.depth);
        return {
          content: [{
            type: "text",
            text: `Directory tree for: ${parsed.localPath}\n\n${tree}`,
          }],
        };
      }

      // ── vibemap_analyze_codebase ───────────────────────────────────────────
      case "vibemap_analyze_codebase": {
        const parsed = AnalyzeCodebaseSchema.parse(args);
        const client = getVibeClient();

        // Build rich digest
        const digest = await buildCodebaseDigest(parsed.localPath, parsed.depth);

        // Format key files for the prompt
        const keyFilesText = digest.keyFiles
          .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
          .join("\n\n");

        const prompt = `
Analyze this existing codebase and generate comprehensive VibeMap product assets.

## Codebase: ${parsed.localPath}

### Statistics
- Total files: ${digest.stats.totalFiles}
- Total directories: ${digest.stats.totalDirs}  
- Estimated size: ${digest.stats.estimatedSizeKb} KB
- By extension: ${JSON.stringify(digest.stats.byExtension)}

### Directory Tree
\`\`\`
${digest.tree}
\`\`\`

### Key Source Files
${keyFilesText}

## Instructions
Based on the above, please:
1. Identify the main features and capabilities this codebase implements
2. Generate user stories for each feature (As a [role], I want to [action], so that [benefit])
3. Create acceptance criteria in BDD format (Given/When/Then)
4. Map out the database schema if visible
5. Identify user personas based on the codebase's use cases
`.trim();

        const task = await client.submitTask({
          title: parsed.taskTitle,
          prompt,
          projectId: parsed.projectId,
          taskType: "features",
          additionalData: { sourceCodeStats: digest.stats },
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "Codebase submitted to VibeMap for AI analysis. Poll vibemap_get_generation_status with the sessionId.",
              sessionId: task.sessionId,
              projectId: parsed.projectId,
              localPath: parsed.localPath,
              filesAnalyzed: digest.stats.totalFiles,
              keyFilesIncluded: digest.keyFiles.length,
            }, null, 2),
          }],
        };
      }

      // ── vibemap_get_generation_status ──────────────────────────────────────
      case "vibemap_get_generation_status": {
        const parsed = GetGenerationStatusSchema.parse(args);
        const client = getVibeClient();
        const status = await client.getTaskStatus(parsed.sessionId);
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.issues.map((issue: z.ZodIssue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
      );
    }
    if (error instanceof McpError) throw error;
    throw new McpError(
      ErrorCode.InternalError,
      `Tool '${name}' failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ─── Wire up handlers ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, handleListTools);
server.setRequestHandler(CallToolRequestSchema, handleCallTool);

// ─── Entrypoint ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("VibeMap MCP Server v2.0.0 running on stdio\n");
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    process.stderr.write(`Server error: ${error}\n`);
    process.exit(1);
  });
}
