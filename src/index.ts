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
import { formatPageSourceResponse, type PageRecord } from "./page-source.js";
import { TOOL_DEFINITIONS } from "./tools/definitions.js";
import { buildCodebaseDigest, camelToSnakeDeep, walkDir } from "./utils.js";
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

// Single source of truth for status enums — types in vibe-client.ts mirror these
const FEATURE_STATUSES = ["draft", "open", "in_progress", "completed"] as const;
const STORY_STATUSES = ["draft", "has_criteria", "open", "in_progress", "completed"] as const;
const CRITERION_STATUSES = [
  "draft",
  "ready",
  "in_progress",
  "in_review",
  "passed",
  "failed",
  "blocked",
] as const;

const FeatureStatusEnum = z.enum(FEATURE_STATUSES);
const StoryStatusEnum = z.enum(STORY_STATUSES);
const CriterionStatusEnum = z.enum(CRITERION_STATUSES);

const CreateProjectSchema = z.object({
  name: z.string().min(3, "Project name must be at least 3 characters").max(100),
  description: z
    .string()
    .min(50, "Description should be at least 50 characters for good AI analysis")
    .max(20000),
});

// ── Personas & Pages (spec authoring) ───────────────────────────────────────
//
// The MCP surface is uniformly camelCase — including the nested persona blocks.
// The handler converts to the snake_case CRUD body via camelToSnakeDeep, so the
// authoring agent never mixes casing. Block shapes mirror what VibeMap's own
// persona generator produces (lib/prompts/personas.ts) for engine parity.

const StrArr = z.array(z.string());

const CreatePersonaSchema = ProjectIdSchema.extend({
  name: z.string().min(1, "name is required").describe("Persona's first name"),
  userRole: z
    .string()
    .optional()
    .describe("Canonical role this persona represents (e.g. 'admin', 'diver'); referenced by stories"),
  tagline: z.string().optional().describe("Brief one-line descriptor"),
  avatarDescription: z.string().optional().describe("Brief visual description"),
  demographics: z
    .object({
      ageRange: z.string().optional(),
      gender: z.string().optional(),
      location: z.string().optional(),
      education: z.string().optional(),
      incomeLevel: z.string().optional(),
      occupation: z.string().optional(),
      familyStructure: z.string().optional(),
    })
    .partial()
    .optional(),
  psychographics: z
    .object({
      values: StrArr.optional(),
      personalityTraits: StrArr.optional(),
      motivations: StrArr.optional(),
      aspirations: StrArr.optional(),
    })
    .partial()
    .optional(),
  goalsAndNeeds: z
    .object({
      primaryObjectives: StrArr.optional(),
      problemsToSolve: StrArr.optional(),
      functionalNeeds: StrArr.optional(),
      emotionalNeeds: StrArr.optional(),
    })
    .partial()
    .optional(),
  painPoints: z
    .object({
      currentChallenges: StrArr.optional(),
      barriers: StrArr.optional(),
      skillGaps: StrArr.optional(),
    })
    .partial()
    .optional(),
  productSpecific: z
    .object({
      featurePriorities: StrArr.optional(),
      primaryUseCases: StrArr.optional(),
      technicalProficiency: z.string().optional(),
      priceSensitivity: z.string().optional(),
    })
    .partial()
    .optional(),
  communicationPreferences: z
    .object({
      contentPreferences: StrArr.optional(),
      messagingResponse: z.string().optional(),
    })
    .partial()
    .optional(),
  narrative: z
    .object({
      quote: z.string().optional(),
      keyFrustrations: z.string().optional(),
    })
    .partial()
    .optional(),
});

const CreatePageSchema = ProjectIdSchema.extend({
  name: z.string().min(1, "name is required").describe("Page name (e.g. 'Dashboard')"),
  path: z.string().optional().describe("Route path (e.g. '/dashboard')"),
  description: z.string().optional().describe("What this page is for"),
  status: z.enum(["draft", "confirmed"]).optional().default("draft"),
});

const ListFeaturesSchema = ProjectIdSchema.extend({
  status: FeatureStatusEnum.optional().describe("Filter by status"),
  priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
  category: z
    .enum(["core", "enhancement", "infrastructure"])
    .optional()
    .describe("Filter by category"),
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

const ListStoriesSchema = z
  .object({
    projectId: z.string().optional().describe("Filter by project ID"),
    featureId: z.string().optional().describe("Filter by feature ID (overrides projectId)"),
    status: StoryStatusEnum.optional().describe("Filter by status"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Filter by priority"),
    search: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .refine((d) => d.projectId || d.featureId, {
    message: "Either projectId or featureId must be provided",
  });

const CreateStorySchema = z.object({
  featureId: z.string().min(1, "featureId is required"),
  title: z.string().min(1, "title is required"),
  description: z.string().min(1, "description is required"),
  priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
  userRole: z
    .string()
    .optional()
    .default("user")
    .describe("Role of the user (e.g., 'admin', 'developer')"),
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

const ListCriteriaSchema = z
  .object({
    storyId: z.string().optional().describe("Filter by user story ID"),
    featureId: z.string().optional().describe("Filter by feature ID"),
    projectId: z.string().optional().describe("Filter by project ID"),
    status: CriterionStatusEnum.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .refine((d) => d.storyId || d.featureId || d.projectId, {
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

const CreateCriterionSchema = z.object({
  storyId: z.string().min(1, "storyId is required"),
  givenCondition: z
    .string()
    .min(1, "givenCondition is required")
    .describe("Given precondition (BDD: 'Given …')"),
  whenAction: z
    .string()
    .min(1, "whenAction is required")
    .describe("Action being tested (BDD: 'When …')"),
  thenOutcome: z
    .string()
    .min(1, "thenOutcome is required")
    .describe("Expected result (BDD: 'Then …')"),
  description: z.string().optional().describe("Optional human-readable description"),
  scenarioCategory: z
    .enum(["happy_path", "error_scenario", "edge_case"])
    .optional()
    .default("happy_path"),
  status: CriterionStatusEnum.optional().default("draft"),
});

// Kanban status tool
const KanbanEntityTypeEnum = z.enum(["feature", "story", "criterion"]);

const UpdateKanbanStatusSchema = z.object({
  entityType: KanbanEntityTypeEnum.describe("Type of entity: 'feature', 'story', or 'criterion'"),
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

const GetAtomicBlueprintSchema = ProjectIdSchema;

const ListAccessRulesSchema = ProjectIdSchema;

const ListChangesetsSchema = ProjectIdSchema.extend({
  limit: z.number().int().min(1).max(200).optional(),
  includeOps: z.boolean().optional(),
});

const GetPageSourceSchema = ProjectIdSchema.extend({
  pageId: z.string().min(1, "pageId is required"),
});

const ScanCodebaseSchema = z.object({
  localPath: z
    .string()
    .min(1, "localPath is required")
    .describe("Absolute path to the local codebase directory"),
  depth: z.number().int().min(1).max(8).default(4).describe("Max directory traversal depth"),
});

const AnalyzeCodebaseSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  localPath: z
    .string()
    .min(1, "localPath is required")
    .describe("Absolute path to the local codebase directory"),
  depth: z.number().int().min(1).max(8).default(4),
  taskTitle: z
    .string()
    .optional()
    .default("Reverse Engineer Codebase")
    .describe("Title for the generation task"),
});

const GetGenerationStatusSchema = z.object({
  sessionId: z
    .string()
    .min(1, "sessionId is required")
    .describe("Session ID returned by vibemap_analyze_codebase"),
});

// Deep validation lives server-side (lib/code-map/schema.ts CodeMapSchema);
// the MCP layer stays permissive so rich error messages come back from the API.
const SubmitCodeMapSchema = z.object({
  projectId: z.string().min(1).describe("VibeMap project id"),
  map: z.object({
    nodes: z.array(z.record(z.string(), z.unknown())),
    edges: z.array(z.record(z.string(), z.unknown())),
    stats: z.record(z.string(), z.unknown()).optional(),
  }),
  anchor: z.record(z.string(), z.unknown()).optional(),
});

const GetCodeMapSchema = z.object({
  projectId: z.string().min(1).describe("VibeMap project id"),
});

const SyncChangesSchema = z.object({
  projectId: z.string().min(1).describe("VibeMap project id"),
  changedFiles: z
    .array(z.string())
    .max(2000)
    .describe("Repo-relative paths changed since anchor.commitSha"),
  headSha: z.string().optional().describe("Current HEAD commit sha"),
});

// ── Kanban Tracker (typed transitions) schemas ──────────────────────────────

const GetNextReadyCriterionSchema = ProjectIdSchema;

const ClaimCriterionSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
});

const ReportProgressSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
  summary: z.string().min(1).max(2000, "summary must be 1-2000 chars"),
});

const SubmitForReviewSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
  gitSha: z.string().min(7, "gitSha must be at least 7 chars"),
  diffUrl: z.string().min(1, "diffUrl is required"),
  notes: z.string().max(2000).optional(),
});

const ResolveReviewSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
  outcome: z.enum(["passed", "failed"]),
  testRunUrl: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

const BlockCriterionSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
  category: z.enum(["spec_unclear", "missing_dep", "external_blocker", "other"]),
  reason: z.string().min(1).max(2000, "reason must be 1-2000 chars"),
});

const UnblockCriterionSchema = z.object({
  criterionId: z.string().min(1, "criterionId is required"),
  resolution: z.string().min(1).max(2000, "resolution must be 1-2000 chars"),
});

const ListKanbanEventsSchema = ProjectIdSchema.extend({
  since: z
    .string()
    .optional()
    .describe("ISO timestamp; only events strictly after this are returned"),
  limit: z.number().int().min(1).max(1000).default(200),
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

// Canonical lifecycle, mirroring the DB enum + lib/kanban/transitions.ts
// criterionRules (actor gating is enforced server-side; this is the client-side
// shape guard). 'passed' is terminal.
const CRITERION_TRANSITIONS: Record<CriterionStatus, CriterionStatus[]> = {
  draft: ["ready"],
  ready: ["in_progress", "blocked"],
  in_progress: ["in_review", "ready", "blocked"],
  in_review: ["passed", "failed", "blocked"],
  passed: [],
  failed: ["ready"],
  blocked: ["ready", "in_progress", "in_review"],
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

/**
 * If a status change is included in an update call, fetch current status and validate
 * the transition. Returns an error response if invalid, or null if OK to proceed.
 */
async function guardStatusTransition(
  client: VibeMapClient,
  entityType: KanbanEntityType,
  entityId: string,
  newStatus: string | undefined
): Promise<{ isError: true; content: Array<{ type: string; text: string }> } | null> {
  if (!newStatus) return null;

  let currentStatus: string;
  if (entityType === "feature") {
    const entity = (await client.getFeature(entityId)) as Record<string, unknown>;
    currentStatus = entity.status as string;
  } else if (entityType === "story") {
    const entity = (await client.getUserStory(entityId)) as Record<string, unknown>;
    currentStatus = entity.status as string;
  } else {
    const entity = await client.getCriterion(entityId);
    currentStatus = (entity?.status as string) ?? "draft";
  }

  // Same status = no transition needed
  if (currentStatus === newStatus) return null;

  const validation = validateKanbanTransition(entityType, currentStatus, newStatus);
  if (!validation.valid) {
    return {
      isError: true,
      content: [{ type: "text", text: `Kanban transition error: ${validation.error}` }],
    };
  }
  return null;
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

// Entity-specific strip lists for read/context surfaces. These drop planning
// metadata (priority, status, effort, etc.) that bloats the context window but
// is not needed by an external coding agent consuming the spec. Kanban status
// is read for column grouping *before* stripping, so dropping it from the row
// is safe — the board column already encodes it.
const FEATURE_STRIP = [
  ...GLOBAL_STRIP,
  "priority",
  "category",
  "complexity",
  "effort",
  "business_value",
  "status",
];
const STORY_STRIP = [
  ...GLOBAL_STRIP,
  "persona_id",
  "features",
  "priority",
  "estimated_effort",
  "status",
];
const AC_STRIP = [...GLOBAL_STRIP, "title", "description"];

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

let _vibeClient: VibeMapClient | null = null;

/** Reset the cached client (for testing only). */
export function resetVibeClient() {
  _vibeClient = null;
}

const getVibeClient = () => {
  if (_vibeClient) return _vibeClient;
  const apiKey = process.env.VIBEMAP_API_KEY;
  // Production-first default: IDE users following the docs only set
  // VIBEMAP_API_KEY. Local development against a dev server sets
  // VIBEMAP_BASE_URL=http://localhost:3000 explicitly.
  const baseUrl = process.env.VIBEMAP_BASE_URL || "https://vibemap.ai";
  if (!apiKey) {
    throw new McpError(ErrorCode.InternalError, "VIBEMAP_API_KEY environment variable is required");
  }
  _vibeClient = new VibeMapClient({ baseUrl, apiKey });
  return _vibeClient;
};

// ─── Tool definitions ─────────────────────────────────────────────────────────

export async function handleListTools() {
  return { tools: TOOL_DEFINITIONS };
}

// ─── Tool call handler ────────────────────────────────────────────────────────

function log(msg: string) {
  process.stderr.write(`[vibemap-mcp] ${msg}\n`);
}

export async function handleCallTool(request: CallToolRequest) {
  const { name, arguments: args } = request.params;
  const start = Date.now();
  log(`${name} called`);

  try {
    switch (name) {
      // ── vibemap_list_projects ──────────────────────────────────────────────
      case "vibemap_list_projects": {
        const client = getVibeClient();
        const projects = await client.listProjects();
        const clean = stripFields(projects, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_create_project ────────────────────────────────────────────
      case "vibemap_create_project": {
        const parsed = CreateProjectSchema.parse(args);
        const client = getVibeClient();
        const project = await client.createProject({
          name: parsed.name,
          original_prompt: parsed.description,
          current_prompt: parsed.description,
          status: "draft",
        });
        const clean = stripFields(project, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_create_persona ─────────────────────────────────────────────
      case "vibemap_create_persona": {
        const parsed = CreatePersonaSchema.parse(args);
        const client = getVibeClient();
        const { projectId, ...contentCamel } = parsed;
        // MCP args are camelCase; /api/crud/personas wants snake_case. Convert
        // once, then mirror Engine B by persisting the full content as
        // persona_data (the embedding writer indexes that column).
        const content = camelToSnakeDeep(contentCamel) as Record<string, unknown>;
        const persona = await client.createPersona({
          project_id: projectId,
          ...content,
          persona_data: content,
        });
        const clean = stripFields(persona, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_create_page ────────────────────────────────────────────────
      case "vibemap_create_page": {
        const parsed = CreatePageSchema.parse(args);
        const client = getVibeClient();
        const page = await client.createPage({
          project_id: parsed.projectId,
          name: parsed.name,
          path: parsed.path,
          description: parsed.description,
          status: parsed.status,
        });
        const clean = stripFields(page, GLOBAL_STRIP);
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
          "project_type",
          "business_context",
          "technical_context",
          "assumptions",
          "risks",
          "goals",
          "future_considerations",
          "app_architecture_prefs",
          "analysis",
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
          const {
            budget: _b,
            timeline: _t,
            regulatory: _r,
            ...rest
          } = cleanProject.constraints as Record<string, unknown>;
          cleanProject.constraints = rest;
        }

        const response: Record<string, unknown> = { project: cleanProject };

        if (parsed.includeFeatures) {
          let features = (analysis.features as unknown[]) || [];
          if (features.length === 0) {
            const result = await client.listFeatures({ project_id: parsed.projectId, limit: 100 });
            features = (result as { features: unknown[] }).features || [];
          }
          response.features = stripFields(features, FEATURE_STRIP);
        }

        if (parsed.includeStories) {
          let stories = (analysis.user_stories as unknown[]) || [];
          if (stories.length === 0) {
            const result = await client.listUserStories({
              project_id: parsed.projectId,
              limit: 100,
            });
            stories = (result as { user_stories: unknown[] }).user_stories || [];
          }
          response.stories = stripFields(stories, STORY_STRIP);
        }

        if (parsed.includePersonas) {
          const personas = (analysis.personas as unknown[]) || [];
          response.personas = (personas as Record<string, unknown>[]).map((p) => ({
            id: p.id,
            name: p.name,
            user_role: p.user_role,
            tagline: p.tagline,
            avatar_description: p.avatar_description,
          }));
        }

        if (parsed.includePages) {
          const pages = (analysis.pages as unknown[]) || [];
          response.pages = (pages as Record<string, unknown>[]).map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            path: p.path,
            prompt: p.prompt,
          }));
          const sections = (analysis.sections as unknown[]) || [];
          response.sections = (sections as Record<string, unknown>[]).map((s) => ({
            id: s.id,
            page_id: s.page_id,
            name: s.name,
            description: s.description,
          }));
        }

        if (parsed.includeSchema) {
          response.dbSchema = analysis.dbSchema || null;
        }

        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      }

      // ── vibemap_get_atomic_blueprint ───────────────────────────────────────
      case "vibemap_get_atomic_blueprint": {
        const parsed = GetAtomicBlueprintSchema.parse(args);
        const client = getVibeClient();
        const blueprint = await client.getAtomicBlueprint(parsed.projectId);
        return { content: [{ type: "text", text: JSON.stringify(blueprint, null, 2) }] };
      }

      // ── vibemap_list_access_rules ──────────────────────────────────────────
      case "vibemap_list_access_rules": {
        const parsed = ListAccessRulesSchema.parse(args);
        const client = getVibeClient();
        const rules = await client.listAccessRules(parsed.projectId);
        return { content: [{ type: "text", text: JSON.stringify(rules, null, 2) }] };
      }

      // ── vibemap_list_changesets ────────────────────────────────────────────
      case "vibemap_list_changesets": {
        const parsed = ListChangesetsSchema.parse(args);
        const client = getVibeClient();
        const changesets = await client.listChangesets(parsed.projectId, {
          limit: parsed.limit,
          includeOps: parsed.includeOps,
        });
        return { content: [{ type: "text", text: JSON.stringify(changesets, null, 2) }] };
      }

      // ── vibemap_get_page_source ────────────────────────────────────────────
      case "vibemap_get_page_source": {
        const parsed = GetPageSourceSchema.parse(args);
        const client = getVibeClient();

        let page: PageRecord;
        try {
          page = (await client.getPageWithSections(parsed.pageId)) as PageRecord;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Graceful "not found" — return error content instead of throwing.
          if (/not found/i.test(msg)) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Page not found: no page with id '${parsed.pageId}' in project '${parsed.projectId}'.`,
                },
              ],
            };
          }
          throw err;
        }

        // Guard: ensure the page belongs to the requested project.
        if (page.project_id && page.project_id !== parsed.projectId) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Page '${parsed.pageId}' does not belong to project '${parsed.projectId}'.`,
              },
            ],
          };
        }

        const sections =
          (page.relationships?.sections as unknown[] | undefined) ?? ([] as unknown[]);
        const response = formatPageSourceResponse(page, sections);
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
      }

      // ── vibemap_list_features ──────────────────────────────────────────────
      case "vibemap_list_features": {
        const parsed = ListFeaturesSchema.parse(args);
        const client = getVibeClient();
        const result = (await client.listFeatures({
          project_id: parsed.projectId,
          status: parsed.status,
          priority: parsed.priority,
          category: parsed.category,
          search: parsed.search,
          limit: parsed.limit,
          offset: parsed.offset,
        })) as { features: unknown[]; meta: unknown };
        const clean = { ...result, features: stripFields(result.features, FEATURE_STRIP) };
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
        const guard = await guardStatusTransition(client, "feature", featureId, updateData.status);
        if (guard) return guard;
        const result = await client.updateFeature(featureId, updateData);
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_list_user_stories ──────────────────────────────────────────
      case "vibemap_list_user_stories": {
        const parsed = ListStoriesSchema.parse(args);
        const client = getVibeClient();
        const result = (await client.listUserStories({
          project_id: parsed.projectId,
          feature_id: parsed.featureId,
          status: parsed.status,
          priority: parsed.priority,
          search: parsed.search,
          limit: parsed.limit,
          offset: parsed.offset,
        })) as { user_stories: unknown[]; meta: unknown };
        const clean = { ...result, user_stories: stripFields(result.user_stories, STORY_STRIP) };
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
        const guard = await guardStatusTransition(client, "story", storyId, rest.status);
        if (guard) return guard;
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
        const parsed = ListCriteriaSchema.parse(args);
        const client = getVibeClient();
        const result = (await client.listAcceptanceCriteria({
          story_id: parsed.storyId,
          feature_id: parsed.featureId,
          project_id: parsed.projectId,
          status: parsed.status,
          limit: parsed.limit,
          offset: parsed.offset,
        })) as { acceptance_criteria: unknown[]; meta: unknown };
        const clean = {
          ...result,
          acceptance_criteria: stripFields(result.acceptance_criteria, AC_STRIP),
        };
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_create_acceptance_criterion ───────────────────────────────
      case "vibemap_create_acceptance_criterion": {
        const parsed = CreateCriterionSchema.parse(args);
        const { storyId, givenCondition, whenAction, thenOutcome, ...rest } = parsed;
        const client = getVibeClient();
        const result = await client.createAcceptanceCriterion({
          story_id: storyId,
          given_condition: givenCondition,
          when_action: whenAction,
          then_outcome: thenOutcome,
          description: rest.description,
          scenario_category: rest.scenarioCategory,
          status: rest.status,
        });
        const clean = stripFields(result, GLOBAL_STRIP);
        return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }] };
      }

      // ── vibemap_update_acceptance_criterion ───────────────────────────────
      case "vibemap_update_acceptance_criterion": {
        const parsed = UpdateCriterionSchema.parse(args);
        const { criterionId, givenCondition, whenAction, thenOutcome, ...rest } = parsed;
        const client = getVibeClient();
        const guard = await guardStatusTransition(client, "criterion", criterionId, rest.status);
        if (guard) return guard;
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
          const feature = (await client.getFeature(entityId)) as Record<string, unknown>;
          currentStatus = feature.status as string;
        } else if (entityType === "story") {
          const story = (await client.getUserStory(entityId)) as Record<string, unknown>;
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
          updated = await client.updateAcceptanceCriterion(entityId, {
            status: newStatus as CriterionStatus,
          });
        }

        const noteStr = notes ? ` Note: ${notes}` : "";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  entityType,
                  entityId,
                  previousStatus: currentStatus,
                  newStatus,
                  notes: noteStr || undefined,
                  updated: stripFields(updated, GLOBAL_STRIP),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── vibemap_get_kanban_board ───────────────────────────────────────────
      case "vibemap_get_kanban_board": {
        const parsed = GetKanbanBoardSchema.parse(args);
        const client = getVibeClient();

        const FEATURE_LIMIT = 200;
        const STORY_LIMIT = 500;

        const [featuresResult, storiesResult] = await Promise.all([
          client.listFeatures({ project_id: parsed.projectId, limit: FEATURE_LIMIT }),
          client.listUserStories({ project_id: parsed.projectId, limit: STORY_LIMIT }),
        ]);

        const features = (featuresResult as { features: Record<string, unknown>[] }).features || [];
        const stories =
          (storiesResult as { user_stories: Record<string, unknown>[] }).user_stories || [];

        const truncated = features.length >= FEATURE_LIMIT || stories.length >= STORY_LIMIT;

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
            draft: [],
            has_criteria: [],
            open: [],
            in_progress: [],
            completed: [],
          };
          for (const s of featureStories) {
            const ss = (s.status as string) || "draft";
            storyBoard[ss]?.push(stripFields(s, STORY_STRIP) as unknown);
          }

          const entry = {
            ...(stripFields(feature, [...FEATURE_STRIP, "projects"]) as object),
            _stories: storyBoard,
            _storyCount: featureStories.length,
            _completedStories: featureStories.filter((s) => s.status === "completed").length,
          };

          board[status]?.push(entry);
        }

        const summary: Record<string, unknown> = {
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

        if (truncated) {
          summary._warning = `Results may be truncated (limits: ${FEATURE_LIMIT} features, ${STORY_LIMIT} stories). Use vibemap_list_features or vibemap_list_user_stories with pagination for full data.`;
        }

        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      }

      // ── vibemap_get_next_ready_criterion ───────────────────────────────────
      case "vibemap_get_next_ready_criterion": {
        const parsed = GetNextReadyCriterionSchema.parse(args);
        const client = getVibeClient();
        const result = await client.getNextReadyCriterion(parsed.projectId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_claim_criterion ────────────────────────────────────────────
      case "vibemap_claim_criterion": {
        const parsed = ClaimCriterionSchema.parse(args);
        const client = getVibeClient();
        const result = await client.claimCriterion(parsed.criterionId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_report_progress ────────────────────────────────────────────
      case "vibemap_report_progress": {
        const parsed = ReportProgressSchema.parse(args);
        const client = getVibeClient();
        const result = await client.reportProgress(parsed.criterionId, parsed.summary);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_submit_for_review ──────────────────────────────────────────
      case "vibemap_submit_for_review": {
        const parsed = SubmitForReviewSchema.parse(args);
        const client = getVibeClient();
        const result = await client.submitForReview(
          parsed.criterionId,
          parsed.gitSha,
          parsed.diffUrl,
          parsed.notes
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_resolve_review ─────────────────────────────────────────────
      case "vibemap_resolve_review": {
        const parsed = ResolveReviewSchema.parse(args);
        const client = getVibeClient();
        const result = await client.resolveReview(
          parsed.criterionId,
          parsed.outcome,
          parsed.testRunUrl,
          parsed.notes
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_block_criterion ────────────────────────────────────────────
      case "vibemap_block_criterion": {
        const parsed = BlockCriterionSchema.parse(args);
        const client = getVibeClient();
        const result = await client.blockCriterion(
          parsed.criterionId,
          parsed.category,
          parsed.reason
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_unblock_criterion ──────────────────────────────────────────
      case "vibemap_unblock_criterion": {
        const parsed = UnblockCriterionSchema.parse(args);
        const client = getVibeClient();
        const result = await client.unblockCriterion(parsed.criterionId, parsed.resolution);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_list_kanban_events ─────────────────────────────────────────
      case "vibemap_list_kanban_events": {
        const parsed = ListKanbanEventsSchema.parse(args);
        const client = getVibeClient();
        const result = await client.listKanbanEvents(parsed.projectId, parsed.since, parsed.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_scan_codebase ──────────────────────────────────────────────
      case "vibemap_scan_codebase": {
        const parsed = ScanCodebaseSchema.parse(args);
        const tree = await walkDir(parsed.localPath, parsed.depth);
        return {
          content: [
            {
              type: "text",
              text: `Directory tree for: ${parsed.localPath}\n\n${tree}`,
            },
          ],
        };
      }

      // ── vibemap_analyze_codebase ───────────────────────────────────────────
      case "vibemap_analyze_codebase": {
        const parsed = AnalyzeCodebaseSchema.parse(args);
        const client = getVibeClient();

        // Build rich digest
        const digest = await buildCodebaseDigest(parsed.localPath, parsed.depth);

        // Format key files for the prompt, respecting a rough token budget
        const MAX_PROMPT_CHARS = 80000; // ~20k tokens
        let keyFilesText = "";
        let charBudget = MAX_PROMPT_CHARS;
        for (const f of digest.keyFiles) {
          const block = `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
          if (charBudget - block.length < 0) break;
          keyFilesText += block;
          charBudget -= block.length;
        }

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
Identify the main features and capabilities this codebase implements. For each
feature provide: name, description (what it does and for whom, grounded in the
actual code), category, priority, complexity, effort, and business value.
Cover every user-facing capability and significant backend subsystem you can
see evidence for — do not invent features the code does not support.
`.trim();

        const task = await client.submitTask({
          title: parsed.taskTitle,
          prompt,
          projectId: parsed.projectId,
          taskType: "features",
          additionalData: { sourceCodeStats: digest.stats },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message:
                    "Codebase submitted to VibeMap for AI feature extraction. Poll vibemap_get_generation_status with the sessionId. When it completes, features will exist in the project — then create user stories (vibemap_create_user_story) and acceptance criteria (vibemap_create_acceptance_criterion) for each feature using your direct codebase knowledge, or run those generations in the VibeMap app.",
                  sessionId: task.sessionId,
                  projectId: parsed.projectId,
                  localPath: parsed.localPath,
                  filesAnalyzed: digest.stats.totalFiles,
                  keyFilesIncluded: digest.keyFiles.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ── vibemap_submit_code_map ────────────────────────────────────────────
      case "vibemap_submit_code_map": {
        const parsed = SubmitCodeMapSchema.parse(args);
        const client = getVibeClient();
        const result = await client.submitCodeMap(parsed.projectId, parsed.map, parsed.anchor);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_get_code_map ───────────────────────────────────────────────
      case "vibemap_get_code_map": {
        const parsed = GetCodeMapSchema.parse(args);
        const client = getVibeClient();
        const result = await client.getCodeMap(parsed.projectId);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // ── vibemap_sync_changes ───────────────────────────────────────────────
      case "vibemap_sync_changes": {
        const parsed = SyncChangesSchema.parse(args);
        const client = getVibeClient();
        const result = await client.reportDriftChanges(
          parsed.projectId,
          parsed.changedFiles,
          parsed.headSha
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    const duration = Date.now() - start;
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`${name} FAILED (${duration}ms): ${errMsg}`);

    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.issues.map((issue: z.ZodIssue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
      );
    }
    if (error instanceof McpError) throw error;
    throw new McpError(ErrorCode.InternalError, `Tool '${name}' failed: ${errMsg}`);
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
