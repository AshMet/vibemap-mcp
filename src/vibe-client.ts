import fetch, { RequestInit } from "node-fetch";

export interface VibeConfig {
  baseUrl: string;
  apiKey: string;
  projectId?: string;
}

export class VibePlanClient {
  private config: VibeConfig;

  constructor(config: VibeConfig) {
    this.config = config;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as any).error || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  // Project Operations
  async listProjects() {
    return this.request<any[]>("/api/crud/projects");
  }

  async getProject(id: string) {
    return this.request<any>(`/api/crud/projects?id=${id}&includeAnalysis=true`);
  }

  async createProject(data: any) {
    return this.request<any>("/api/crud/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Feature Operations
  async listFeatures(projectId: string) {
    return this.request<any>(`/api/crud/features?project_id=${projectId}`);
  }

  async createFeature(data: any) {
    return this.request<any>("/api/crud/features", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // User Story Operations
  async listUserStories(projectId: string) {
    return this.request<any>(`/api/crud/user-stories?project_id=${projectId}`);
  }

  async updateUserStory(id: string, data: any) {
    return this.request<any>("/api/crud/user-stories", {
      method: "PUT",
      body: JSON.stringify({ id, ...data }),
    });
  }

  // Task Operations (Generation)
  async submitTask(data: {
    title: string;
    prompt: string;
    projectId: string;
    taskType: string;
    additionalData?: any;
  }) {
    return this.request<{ sessionId: string }>("/api/tasks/submit", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getTaskStatus(sessionId: string) {
    return this.request<any>(`/api/tasks/${sessionId}/status`);
  }
}
