import fetch, { type RequestInit } from "node-fetch";

export interface VibeConfig {
  baseUrl: string;
  apiKey: string;
}

// ─── Status types that match the real backend schemas ────────────────────────

export type FeatureStatus = "draft" | "open" | "in_progress" | "completed";
export type StoryStatus = "draft" | "has_criteria" | "open" | "in_progress" | "completed";
export type CriterionStatus =
  | "draft"
  | "ready"
  | "in_progress"
  | "in_review"
  | "passed"
  | "failed"
  | "blocked";
export type KanbanEntityType = "feature" | "story" | "criterion";

export type FeaturePriority = "high" | "medium" | "low";
export type FeatureCategory = "core" | "enhancement" | "infrastructure";
export type FeatureComplexity = "low" | "medium" | "high";
export type FeatureEffort = "xs" | "s" | "m" | "l" | "xl";
export type BusinessValue = "low" | "medium" | "high";

export type StoryPriority = "high" | "medium" | "low";

// ─── DTO types ────────────────────────────────────────────────────────────────

export interface CreateFeatureData {
  project_id: string;
  name: string;
  description?: string;
  priority?: FeaturePriority;
  category?: FeatureCategory;
  complexity?: FeatureComplexity;
  effort?: FeatureEffort;
  business_value?: BusinessValue;
  status?: FeatureStatus;
}

export interface UpdateFeatureData {
  name?: string;
  description?: string;
  priority?: FeaturePriority;
  category?: FeatureCategory;
  complexity?: FeatureComplexity;
  effort?: FeatureEffort;
  business_value?: BusinessValue;
  status?: FeatureStatus;
}

export interface CreateUserStoryData {
  feature_id: string;
  title: string;
  description: string;
  priority?: StoryPriority;
  status?: StoryStatus;
  estimated_effort?: number;
  user_role?: string;
  i_want_to?: string;
  so_that?: string;
}

export interface UpdateUserStoryData {
  title?: string;
  description?: string;
  priority?: StoryPriority;
  status?: StoryStatus;
  estimated_effort?: number;
  user_role?: string;
  i_want_to?: string;
  so_that?: string;
}

export interface UpdateCriterionData {
  status?: CriterionStatus;
  given_condition?: string;
  when_action?: string;
  then_outcome?: string;
  description?: string;
  scenario_category?: "happy_path" | "error_scenario" | "edge_case";
}

export interface CreateCriterionData {
  story_id: string;
  given_condition: string;
  when_action: string;
  then_outcome: string;
  description?: string;
  scenario_category?: "happy_path" | "error_scenario" | "edge_case";
  status?: CriterionStatus;
}

export interface ListFeaturesOptions {
  project_id: string;
  status?: FeatureStatus;
  priority?: FeaturePriority;
  category?: FeatureCategory;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListStoriesOptions {
  project_id?: string;
  feature_id?: string;
  status?: StoryStatus;
  priority?: StoryPriority;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListCriteriaOptions {
  story_id?: string;
  feature_id?: string;
  project_id?: string;
  status?: CriterionStatus;
  limit?: number;
  offset?: number;
}

export interface CreatePageData {
  project_id: string;
  name: string;
  path?: string;
  description?: string;
  status?: "draft" | "confirmed";
}

export interface SubmitTaskData {
  title: string;
  prompt: string;
  projectId: string;
  taskType: string;
  additionalData?: Record<string, unknown>;
}

// ── Schema (Engine A: bring-your-own-agent database schema) ──────────────────
//
// The schema surface is camelCase end-to-end — it mirrors VibeMap's SchemaJSON,
// which SchemaDatabaseService.saveSchema consumes directly. Unlike personas/pages
// there is NO snake_case conversion here.

export interface SchemaColumnData {
  name: string;
  type: string;
  primaryKey?: boolean;
  nullable?: boolean;
  unique?: boolean;
  default?: string;
  description?: string;
  check?: string;
  maxLength?: string;
  foreignKey?: { table: string; column: string };
}

export interface SchemaTableData {
  name: string;
  description?: string;
  columns: SchemaColumnData[];
}

export interface SchemaRelationshipData {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  sourceCardinality: "1" | "N";
  targetCardinality: "1" | "N";
  onDelete?: string;
}

export interface CreateSchemaData {
  projectId: string;
  tables: SchemaTableData[];
  relationships?: SchemaRelationshipData[];
}

// ── Agent (Engine B: VibeMap-hosted conversational agent, metered) ───────────

export interface AgentOptions {
  /** Model id for the turn (server defaults to the economy model). */
  model?: string;
  /**
   * Conversation thread. Omit and the server derives a stable thread per
   * (user, project) so multi-turn history carries across calls; pass the
   * `sessionId` echoed by a prior reply to pin a specific thread.
   */
  sessionId?: string;
  /** Approve a specific pending operation (from a prior confirmationRequired reply). */
  approveOperationId?: string;
  /** Approve the latest pending operation without quoting its id. */
  approve?: boolean;
}

export interface AgentResult {
  response: string;
  confirmationRequired?: boolean;
  operationId?: string;
  plan?: unknown;
  clarificationNeeded?: unknown;
  executionResults?: unknown;
  generationStarted?: boolean;
  sessionId?: string;
  success?: boolean;
  [key: string]: unknown;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class VibeMapClient {
  private config: VibeConfig;

  constructor(config: VibeConfig) {
    this.config = config;
  }

  // Default 30s covers CRUD calls. The agent tool drives a full LLM turn
  // (classify → plan → impact), so it passes a longer budget.
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs = 30000
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal as AbortSignal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: response.statusText }));
        const message =
          ((errorBody as Record<string, unknown>).error as string) || `HTTP ${response.status}`;
        // A bare "Unauthorized" is the most confusing failure this server can
        // produce: it names neither the host that rejected the key nor the reason.
        // Tokens are per-instance, so a key issued by a local VibeMap fails against
        // vibemap.ai (and vice versa) — as does a project id from the other one.
        if (response.status === 401) {
          throw new Error(
            `${message} — ${this.config.baseUrl} rejected this VIBEMAP_API_KEY. ` +
              `Keys are only valid on the VibeMap instance that issued them: confirm this key ` +
              `came from ${this.config.baseUrl} (Account -> Developer) and was not revoked, and ` +
              `that VIBEMAP_BASE_URL points at that same instance.`
          );
        }
        throw new Error(message);
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildQuery(params: Record<string, string | number | boolean | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        qs.set(k, String(v));
      }
    }
    const str = qs.toString();
    return str ? `?${str}` : "";
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  async listProjects(): Promise<unknown[]> {
    return this.request<unknown[]>("/api/crud/projects");
  }

  async getProject(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/crud/projects${this.buildQuery({ id, includeAnalysis: true })}`
    );
  }

  async getAtomicBlueprint(projectId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/atomic-blueprint${this.buildQuery({ projectId })}`
    );
  }

  async listAccessRules(projectId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/access-rules${this.buildQuery({ projectId })}`
    );
  }

  async submitCodeMap(
    projectId: string,
    map: Record<string, unknown>,
    anchor?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/mcp/code-map", {
      method: "POST",
      body: JSON.stringify({ projectId, map, anchor }),
    });
  }

  async getCodeMap(projectId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/code-map${this.buildQuery({ projectId })}`
    );
  }

  async reportDriftChanges(
    projectId: string,
    changedFiles: string[],
    headSha?: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/mcp/code-map", {
      method: "PATCH",
      body: JSON.stringify({ projectId, action: "report_drift", changedFiles, headSha }),
    });
  }

  async listChangesets(
    projectId: string,
    opts: { limit?: number; includeOps?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/changesets${this.buildQuery({
        projectId,
        limit: opts.limit,
        includeOps: opts.includeOps,
      })}`
    );
  }

  // ── Pages ────────────────────────────────────────────────────────────────

  /**
   * Fetch a single page with its sections (via includeRelationships). The
   * returned object includes the page's own fields (id, name, path,
   * source_code, project_id) plus `relationships.sections`.
   */
  async getPageWithSections(pageId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/crud/pages${this.buildQuery({ id: pageId, includeRelationships: true })}`
    );
  }

  async createProject(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async createPage(data: CreatePageData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/pages", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ── Schema ───────────────────────────────────────────────────────────────

  /**
   * Persist a project's database schema (tables → columns → relationships). The
   * body is already camelCase (it mirrors VibeMap's SchemaJSON), so no case
   * conversion happens — the server keyed-reconciles it, so re-running is
   * idempotent.
   */
  async createSchema(data: CreateSchemaData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/schema", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ── Agent (Engine B: hosted conversational agent) ──────────────────────────

  /**
   * Drive the full VibeMap conversational agent for one turn. Metered (uses
   * VibeMap tokens). A destructive/sensitive turn replies with
   * `confirmationRequired` + an `operationId`; approve it in a second call
   * (`approveOperationId`). Long generations run in the background — the reply
   * says so and you poll `getTaskStatus`. Uses a longer timeout than CRUD
   * calls because the turn drives an LLM plan/impact pass.
   */
  async agent(projectId: string, message: string, opts: AgentOptions = {}): Promise<AgentResult> {
    return this.request<AgentResult>(
      "/api/mcp/agent",
      {
        method: "POST",
        body: JSON.stringify({
          projectId,
          message,
          model: opts.model,
          sessionId: opts.sessionId,
          approveOperationId: opts.approveOperationId,
          approve: opts.approve,
        }),
      },
      120000
    );
  }

  // ── Personas ──────────────────────────────────────────────────────────────

  /**
   * Create a persona. The body is already snake_case (the handler converts the
   * camelCase MCP args via camelToSnakeDeep and assembles persona_data), so this
   * stays loosely typed like createProject — the server re-validates the shape.
   */
  async createPersona(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/personas", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ── Features ─────────────────────────────────────────────────────────────

  async listFeatures(opts: ListFeaturesOptions): Promise<{ features: unknown[]; meta: unknown }> {
    const { project_id, ...rest } = opts;
    return this.request(`/api/crud/features${this.buildQuery({ project_id, ...rest })}`);
  }

  async getFeature(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/crud/features${this.buildQuery({ id, includeRelationships: true })}`
    );
  }

  async createFeature(data: CreateFeatureData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/features", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateFeature(id: string, data: UpdateFeatureData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/features", {
      method: "PUT",
      body: JSON.stringify({ id, ...data }),
    });
  }

  // ── User Stories ──────────────────────────────────────────────────────────

  async listUserStories(
    opts: ListStoriesOptions
  ): Promise<{ user_stories: unknown[]; meta: unknown }> {
    return this.request(
      `/api/crud/user-stories${this.buildQuery(opts as Record<string, string | number | boolean | undefined>)}`
    );
  }

  async getUserStory(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/crud/user-stories${this.buildQuery({ id, includeRelationships: true })}`
    );
  }

  async createUserStory(data: CreateUserStoryData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/user-stories", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateUserStory(id: string, data: UpdateUserStoryData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/user-stories", {
      method: "PUT",
      body: JSON.stringify({ id, ...data }),
    });
  }

  // ── Acceptance Criteria ───────────────────────────────────────────────────

  async listAcceptanceCriteria(
    opts: ListCriteriaOptions
  ): Promise<{ acceptance_criteria: unknown[]; meta: unknown }> {
    return this.request(
      `/api/crud/acceptance-criteria${this.buildQuery(opts as Record<string, string | number | boolean | undefined>)}`
    );
  }

  async getCriterion(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/crud/acceptance-criteria${this.buildQuery({ id })}`
    );
  }

  async createAcceptanceCriterion(data: CreateCriterionData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/acceptance-criteria", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAcceptanceCriterion(
    id: string,
    data: UpdateCriterionData
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/acceptance-criteria", {
      method: "PUT",
      body: JSON.stringify({ id, ...data }),
    });
  }

  // ── Prompts (server-expanded slash commands) ───────────────────────────────

  /**
   * Fetch a server-expanded prompt body by name. The prompt text is single-
   * sourced in the VibeMap app and returned as plain text; this server wraps it
   * into an MCP GetPromptResult.
   *
   * `projectId` is optional because the bootstrap prompt (`new_project`) has no
   * project yet — `buildQuery` drops undefined params, so it is simply absent
   * from the query string rather than sent empty.
   */
  async getPrompt(
    name: string,
    opts: { projectId?: string; localPath?: string }
  ): Promise<string> {
    const res = await this.request<{ name: string; text: string }>(
      `/api/mcp/prompts${this.buildQuery({ name, projectId: opts.projectId, localPath: opts.localPath })}`
    );
    return res.text;
  }

  // ── Tasks (AI Generation) ─────────────────────────────────────────────────

  async submitTask(data: SubmitTaskData): Promise<{ sessionId: string }> {
    return this.request<{ sessionId: string }>("/api/tasks/submit", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getTaskStatus(sessionId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/tasks/${sessionId}/status`);
  }

  // ── Kanban Tracker (typed transitions) ────────────────────────────────────

  async getNextReadyCriterion(projectId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/kanban/projects/${projectId}/next-ready`
    );
  }

  async claimCriterion(criterionId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/mcp/kanban/criterion/${criterionId}/claim`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async reportProgress(criterionId: string, summary: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/kanban/criterion/${criterionId}/progress`,
      { method: "POST", body: JSON.stringify({ summary }) }
    );
  }

  async submitForReview(
    criterionId: string,
    gitSha: string,
    diffUrl: string,
    notes?: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/kanban/criterion/${criterionId}/submit-for-review`,
      { method: "POST", body: JSON.stringify({ git_sha: gitSha, diff_url: diffUrl, notes }) }
    );
  }

  async resolveReview(
    criterionId: string,
    outcome: "passed" | "failed",
    testRunUrl?: string,
    notes?: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/kanban/criterion/${criterionId}/resolve-review`,
      { method: "POST", body: JSON.stringify({ outcome, test_run_url: testRunUrl, notes }) }
    );
  }

  async blockCriterion(
    criterionId: string,
    category: "spec_unclear" | "missing_dep" | "external_blocker" | "other",
    reason: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/mcp/kanban/criterion/${criterionId}/block`, {
      method: "POST",
      body: JSON.stringify({ category, reason }),
    });
  }

  async unblockCriterion(
    criterionId: string,
    resolution: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/api/mcp/kanban/criterion/${criterionId}/unblock`,
      { method: "POST", body: JSON.stringify({ resolution }) }
    );
  }

  async listKanbanEvents(
    projectId: string,
    since?: string,
    limit = 200
  ): Promise<Record<string, unknown>> {
    const qp = new URLSearchParams();
    if (since) qp.set("since", since);
    qp.set("limit", String(limit));
    return this.request<Record<string, unknown>>(
      `/api/mcp/kanban/projects/${projectId}/events?${qp.toString()}`
    );
  }
}
