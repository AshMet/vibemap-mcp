import fetch, { type RequestInit } from "node-fetch";

export interface VibeConfig {
  baseUrl: string;
  apiKey: string;
}

// ─── Status types that match the real backend schemas ────────────────────────

export type FeatureStatus = "draft" | "open" | "in_progress" | "completed";
export type StoryStatus = "draft" | "has_criteria" | "open" | "in_progress" | "completed";
export type CriterionStatus = "draft" | "pending" | "passed" | "failed";
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

export interface SubmitTaskData {
  title: string;
  prompt: string;
  projectId: string;
  taskType: string;
  additionalData?: Record<string, unknown>;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class VibeMapClient {
  private config: VibeConfig;

  constructor(config: VibeConfig) {
    this.config = config;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

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
        throw new Error((errorBody as Record<string, unknown>).error as string || `HTTP ${response.status}`);
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
    return this.request<Record<string, unknown>>(`/api/crud/projects${this.buildQuery({ id, includeAnalysis: true })}`);
  }

  async createProject(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/projects", {
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
    return this.request<Record<string, unknown>>(`/api/crud/features${this.buildQuery({ id, includeRelationships: true })}`);
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

  async listUserStories(opts: ListStoriesOptions): Promise<{ user_stories: unknown[]; meta: unknown }> {
    return this.request(`/api/crud/user-stories${this.buildQuery(opts as Record<string, string | number | boolean | undefined>)}`);
  }

  async getUserStory(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/crud/user-stories${this.buildQuery({ id, includeRelationships: true })}`);
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

  async listAcceptanceCriteria(opts: ListCriteriaOptions): Promise<{ acceptance_criteria: unknown[]; meta: unknown }> {
    return this.request(`/api/crud/acceptance-criteria${this.buildQuery(opts as Record<string, string | number | boolean | undefined>)}`);
  }

  async getCriterion(id: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`/api/crud/acceptance-criteria${this.buildQuery({ id })}`);
  }

  async createAcceptanceCriterion(data: CreateCriterionData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/acceptance-criteria", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAcceptanceCriterion(id: string, data: UpdateCriterionData): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/crud/acceptance-criteria", {
      method: "PUT",
      body: JSON.stringify({ id, ...data }),
    });
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
}
