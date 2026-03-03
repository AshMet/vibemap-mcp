import fetch from "node-fetch";
// ─── Client ──────────────────────────────────────────────────────────────────
export class VibeMapClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async request(endpoint, options = {}) {
        const url = `${this.config.baseUrl}${endpoint}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
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
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(errorBody.error || `HTTP ${response.status}`);
            }
            return response.json();
        }
        finally {
            clearTimeout(timeout);
        }
    }
    buildQuery(params) {
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
    async listProjects() {
        return this.request("/api/crud/projects");
    }
    async getProject(id) {
        return this.request(`/api/crud/projects${this.buildQuery({ id, includeAnalysis: true })}`);
    }
    async createProject(data) {
        return this.request("/api/crud/projects", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    // ── Features ─────────────────────────────────────────────────────────────
    async listFeatures(opts) {
        const { project_id, ...rest } = opts;
        return this.request(`/api/crud/features${this.buildQuery({ project_id, ...rest })}`);
    }
    async getFeature(id) {
        return this.request(`/api/crud/features${this.buildQuery({ id, includeRelationships: true })}`);
    }
    async createFeature(data) {
        return this.request("/api/crud/features", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    async updateFeature(id, data) {
        return this.request("/api/crud/features", {
            method: "PUT",
            body: JSON.stringify({ id, ...data }),
        });
    }
    // ── User Stories ──────────────────────────────────────────────────────────
    async listUserStories(opts) {
        return this.request(`/api/crud/user-stories${this.buildQuery(opts)}`);
    }
    async getUserStory(id) {
        return this.request(`/api/crud/user-stories${this.buildQuery({ id, includeRelationships: true })}`);
    }
    async createUserStory(data) {
        return this.request("/api/crud/user-stories", {
            method: "POST",
            body: JSON.stringify(data),
        });
    }
    async updateUserStory(id, data) {
        return this.request("/api/crud/user-stories", {
            method: "PUT",
            body: JSON.stringify({ id, ...data }),
        });
    }
    // ── Acceptance Criteria ───────────────────────────────────────────────────
    async listAcceptanceCriteria(opts) {
        return this.request(`/api/crud/acceptance-criteria${this.buildQuery(opts)}`);
    }
    async getCriterion(id) {
        return this.request(`/api/crud/acceptance-criteria${this.buildQuery({ id })}`);
    }
    async updateAcceptanceCriterion(id, data) {
        return this.request("/api/crud/acceptance-criteria", {
            method: "PUT",
            body: JSON.stringify({ id, ...data }),
        });
    }
    // ── Tasks (AI Generation) ─────────────────────────────────────────────────
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
