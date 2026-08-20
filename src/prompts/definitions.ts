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

/**
 * Prompts that take NO projectId. `new_project` is the bootstrap: it is the
 * prompt that CREATES a project, so requiring one would make it unreachable —
 * which is exactly the gap that left a freshly-connected server with no way in.
 * `handleGetPrompt` consults this set instead of demanding projectId blindly.
 */
export const PROJECTLESS_PROMPTS = new Set(["new_project"]);

export const PROMPT_DEFINITIONS: Prompt[] = [
  {
    name: "new_project",
    description:
      "Create a NEW VibeMap project. Runs a short guided interview (project name, then the five questions VibeMap's web app asks about your product), assembles a strong description, persists it with vibemap_create_project, and hands off to the authoring chain. The only prompt that needs no projectId — start here.",
    arguments: [],
  },
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
    name: "author_personas",
    description:
      "STAGE 1 of 5 — author just the PERSONAS (bring-your-own-agent): the distinct kinds of user the product serves, persisted via vibemap_create_persona. Same standard as author_idea, but one stage so you can review before moving on. Hands off to author_features.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "author_features",
    description:
      "STAGE 2 of 5 — author just the FEATURES (bring-your-own-agent): the product's user-facing capabilities, grounded on the personas, persisted via vibemap_create_feature. Hands off to author_stories.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "author_stories",
    description:
      "STAGE 3 of 5 — author just the USER STORIES (bring-your-own-agent): 2-3+ per feature, reusing persona roles, persisted via vibemap_create_user_story. Hands off to author_criteria.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "author_criteria",
    description:
      "STAGE 4 of 5 — author just the ACCEPTANCE CRITERIA (bring-your-own-agent): BDD Given/When/Then per story, at minimum a happy path, an error scenario and an edge case, persisted via vibemap_create_acceptance_criterion. Hands off to author_pages.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "author_pages",
    description:
      "STAGE 5 of 5 — author just the PAGES (bring-your-own-agent): the screens/routes that deliver the features, persisted via vibemap_create_page. Hands off to author_schema.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "author_schema",
    description:
      "Author the project's DATABASE SCHEMA (bring-your-own-agent) — tables → columns → relationships — persisted into VibeMap via vibemap_create_schema. Its own step: run AFTER the rest of the spec exists, grounded on the spec (idea-first) or the codebase's models/migrations (code-first, pass localPath). Your agent does the thinking on your tokens.",
    arguments: [PROJECT_ARG, LOCAL_PATH_ARG],
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
