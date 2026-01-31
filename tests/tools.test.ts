import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCallTool, handleListTools } from "../src/index";
import { walkDir } from "../src/utils";
import { VibeMapClient } from "../src/vibe-client";

// Set env var for testing
process.env.VIBEMAP_API_KEY = "test-key";

// Mock the dependencies
vi.mock("../src/vibe-client", () => {
  return {
    VibeMapClient: vi.fn().mockImplementation(() => ({
      listProjects: vi.fn(),
      getProject: vi.fn(),
      listFeatures: vi.fn(),
      listUserStories: vi.fn(),
      submitTask: vi.fn(),
      updateUserStory: vi.fn(),
    })),
  };
});

vi.mock("../src/utils", () => {
  return {
    walkDir: vi.fn(),
  };
});

describe("MCP Tools", () => {
  const stableMockClient = {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    listFeatures: vi.fn(),
    listUserStories: vi.fn(),
    submitTask: vi.fn(),
    updateUserStory: vi.fn(),
  };

  vi.mocked(VibeMapClient).mockImplementation(() => stableMockClient as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleListTools", () => {
    it("returns the list of tools", async () => {
      const result = await handleListTools();
      expect(result.tools).toHaveLength(5);
    });
  });

  describe("handleCallTool", () => {
    it("handles list_projects", async () => {
      const mockProjects = [{ id: "1", name: "Test" }];
      stableMockClient.listProjects.mockResolvedValue(mockProjects);

      const request = {
        params: {
          name: "list_projects",
          arguments: {},
        },
      };

      const result = await handleCallTool(request as any);
      expect(result.content[0].text).toBe(JSON.stringify(mockProjects, null, 2));
    });

    it("handles get_project_context with custom options", async () => {
      const mockProject = {
        id: "1",
        name: "Project",
        analysis: {
          features: [{ id: "f1" }],
          personas: [{ id: "p1" }],
          pages: [{ id: "pg1" }],
          sections: [{ id: "sec1" }],
          dbSchema: { entities: [] },
        },
      };
      stableMockClient.getProject.mockResolvedValue(mockProject);
      stableMockClient.listUserStories.mockResolvedValue({ user_stories: [{ id: "s1" }] });

      const request = {
        params: {
          name: "get_project_context",
          arguments: {
            projectId: "1",
            includeFeatures: true,
            includeStories: true,
            includePersonas: true,
            includePages: true,
            includeSchema: true,
          },
        },
      };

      const result = await handleCallTool(request as any);
      const data = JSON.parse(result.content[0].text);
      expect(data.project.id).toBe("1");
      expect(data.project.analysis).toBeUndefined(); // Verify flattening
      expect(data.features).toHaveLength(1);
      expect(data.stories).toHaveLength(1);
      expect(data.personas).toHaveLength(1);
      expect(data.pages).toHaveLength(1);
      expect(data.sections).toHaveLength(1);
      expect(data.dbSchema).toBeDefined();
    });

    it("streamlines project context in get_project_context", async () => {
      const fullProject = {
        id: "1",
        name: "Project",
        slug: "project-slug",
        original_prompt: "original prompt",
        project_type: "web-app",
        business_context: { market: "big" },
        target_audience: { primary: ["devs"], secondary: ["managers"] },
        constraints: { budget: "10k", timeline: "1 month", other: "stuff" },
        assumptions: ["none"],
        risks: ["none"],
        goals: { success: "win" },
        future_considerations: ["none"],
        app_architecture_prefs: ["none"],
        analysis: {
          features: [],
          personas: [
            { id: "p1", name: "User", tagline: "A user", user_role: "admin", pain_points: {} },
          ],
        },
      };

      stableMockClient.getProject.mockResolvedValue(fullProject);
      stableMockClient.listFeatures.mockResolvedValue([]);

      const request = {
        params: {
          name: "get_project_context",
          arguments: { projectId: "1" },
        },
      };

      const result = await handleCallTool(request as any);
      const data = JSON.parse(result.content[0].text);
      const p = data.project;

      expect(p.name).toBe("Project");
      expect(p.slug).toBeUndefined();
      expect(p.original_prompt).toBeUndefined();
      expect(p.project_type).toBeUndefined();
      expect(p.business_context).toBeUndefined();
      expect(p.target_audience.primary).toEqual(["devs"]);
      expect(p.target_audience.secondary).toBeUndefined();
      expect(p.constraints.budget).toBeUndefined();
      expect(p.constraints.timeline).toBeUndefined();
      expect(p.constraints.other).toBe("stuff");
      expect(p.assumptions).toBeUndefined();
      expect(p.risks).toBeUndefined();
      expect(p.goals).toBeUndefined();
      expect(p.future_considerations).toBeUndefined();
      expect(p.app_architecture_prefs).toBeUndefined();
      expect(p.analysis).toBeUndefined();

      // Verify persona streamlining
      expect(data.personas[0].name).toBe("User");
      expect(data.personas[0].tagline).toBe("A user");
      expect(data.personas[0].pain_points).toBeUndefined();
    });

    it("handles scan_codebase", async () => {
      vi.mocked(walkDir).mockResolvedValue("structure-text");

      const request = {
        params: {
          name: "scan_codebase",
          arguments: { path: "/test", depth: 2 },
        },
      };

      const result = await handleCallTool(request as any);
      expect(result.content[0].text).toBe("structure-text");
      expect(walkDir).toHaveBeenCalledWith("/test", 2);
    });

    it("handles sync_to_vibemap", async () => {
      vi.mocked(walkDir).mockResolvedValue("structure-text");
      stableMockClient.submitTask.mockResolvedValue({ sessionId: "session-1" });

      const request = {
        params: {
          name: "sync_to_vibemap",
          arguments: { projectId: "1", localPath: "/test" },
        },
      };

      const result = await handleCallTool(request as any);
      expect(result.content[0].text).toContain("session-1");
    });

    it("throws error if API key missing", async () => {
      const originalKey = process.env.VIBEMAP_API_KEY;
      delete process.env.VIBEMAP_API_KEY;

      const request = {
        params: {
          name: "list_projects",
          arguments: {},
        },
      };

      await expect(handleCallTool(request as any)).rejects.toThrow("VIBEMAP_API_KEY");

      process.env.VIBEMAP_API_KEY = originalKey;
    });

    it("handles special characters in project ID", async () => {
      stableMockClient.getProject.mockResolvedValue({ id: "id!@#$%^&*()", name: "Project" });
      stableMockClient.listFeatures.mockResolvedValue([]);
      stableMockClient.listUserStories.mockResolvedValue([]);

      const request = {
        params: {
          name: "get_project_context",
          arguments: { projectId: "id!@#$%^&*()" },
        },
      };

      const result = await handleCallTool(request as any);
      expect(result.content[0].text).toContain("id!@#$%^&*()");
    });

    it("handles very long local path in sync_to_vibemap", async () => {
      const longPath = "a".repeat(1000);
      vi.mocked(walkDir).mockResolvedValue("structure");
      stableMockClient.submitTask.mockResolvedValue({ sessionId: "s1" });

      const request = {
        params: {
          name: "sync_to_vibemap",
          arguments: { projectId: "1", localPath: longPath },
        },
      };

      const result = await handleCallTool(request as any);
      expect(result.content[0].text).toContain("s1");
      expect(walkDir).toHaveBeenCalledWith(longPath, 3);
    });
  });
});
