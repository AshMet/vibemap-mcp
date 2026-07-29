import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Static metadata for the MCP prompt primitives VibeMap exposes. IDE clients
 * (Claude Code et al.) surface these as slash commands — /mcp__vibemap__<name>.
 *
 * Only the NAMES / DESCRIPTIONS / ARGUMENTS live here; the prompt BODIES are
 * single-sourced in the VibeMap app (components/mcp-connect/snippets.ts) and
 * fetched at prompts/get time from GET /api/mcp/prompts. That keeps the
 * authoring "secret sauce" server-side (it expands from our server rather than
 * shipping in this npm package) and prevents drift with the in-app copy.
 */
const PROJECT_ARG = {
  name: "projectId",
  description: "The VibeMap project ID (UUID)",
  required: true,
};
const LOCAL_PATH_ARG = {
  name: "localPath",
  description: "Absolute path to the local repo (optional; defaults to the repo you have open)",
  required: false,
};

export const PROMPT_DEFINITIONS: Prompt[] = [
  {
    name: "author_spec",
    description:
      "Author a full product spec from your local CODEBASE (bring-your-own-agent, code-first): personas → features → user stories → acceptance criteria → pages, persisted into VibeMap via the create_* tools. Your agent reads the whole repo and does the thinking on your tokens.",
    arguments: [PROJECT_ARG, LOCAL_PATH_ARG],
  },
  {
    name: "author_idea",
    description:
      "Author a full product spec from the project IDEA (bring-your-own-agent, idea-first): grounds on the project description + existing spec via VibeMap — no codebase needed. Same personas → … → pages graph.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "sync_changes",
    description:
      "Detect and reconcile spec drift between your codebase and VibeMap since the last sync, updating any stale features/stories/criteria.",
    arguments: [PROJECT_ARG, LOCAL_PATH_ARG],
  },
  {
    name: "code_map",
    description: "Build a structural code map of your codebase and submit it to VibeMap.",
    arguments: [PROJECT_ARG, LOCAL_PATH_ARG],
  },
  {
    name: "load_context",
    description:
      "Load a VibeMap project's full spec context (features, user stories, acceptance criteria) into your agent.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "kanban",
    description:
      "Show the VibeMap kanban board for a project so your agent knows what to work on next.",
    arguments: [PROJECT_ARG],
  },
];

/** Names that are known/allowed — used to reject unknown prompts fast. */
export const PROMPT_NAMES = new Set(PROMPT_DEFINITIONS.map((p) => p.name));
