import fetch from "node-fetch";
export class VibePlanClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async request(endpoint, options = {}) {
        const url = `${this.config.baseUrl}${endpoint}`;
        console.error(`[FETCH] ${options.method || "GET"} ${url}`);
        // Create an AbortController for timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.config.apiKey}`,
                    ...options.headers,
                },
            });
            console.error(`[FETCH] Response: ${response.status} ${response.statusText}`);
            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(error.error || `HTTP ${response.status}`);
            }
            return response.json();
        }
        catch (err) {
            console.error(`[FETCH] Error: ${err instanceof Error ? err.message : String(err)}`);
            throw err;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    // Project Operations
    async listProjects() {
        return this.request("/api/crud/projects");
    }
    async getProject(id) {
        return this.request(`/api/crud/projects?id=${id}&includeAnalysis=true`);
    }
    async createProject(data) {
        return this.request("/api/crud/projects", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    // Feature Operations
    async listFeatures(projectId) {
        return this.request(`/api/crud/features?project_id=${projectId}`);
    }
    async createFeature(data) {
        return this.request("/api/crud/features", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    // User Story Operations
    async listUserStories(projectId) {
        return this.request(`/api/crud/user-stories?project_id=${projectId}`);
    }
    async updateUserStory(id, data) {
        return this.request("/api/crud/user-stories", {
            method: "PUT",
            body: JSON.stringify({ id, ...data }),
        });
    }
    // Task Operations (Generation)
    async submitTask(data) {
        return this.request("/api/tasks/submit", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    async getTaskStatus(sessionId) {
        return this.request(`/api/tasks/${sessionId}/status`);
    }
}
