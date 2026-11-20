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

/**
 * Shared tail for every `gen_*` description. The leading sentence of each is the
 * command's `summary` from the app's registry, verbatim, so the IDE picker and
 * the in-app command picker read identically.
 */
const METERED_NOTE =
  "Runs VibeMap's own generation pipeline — METERED: it uses VibeMap's models and draws down the project owner's token budget, unlike the author_* prompts which run on YOUR model. Asynchronous: the reply comes back with a sessionId to poll.";

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
  {
    name: "build_sprint",
    description:
      "Build the project's ready work in the repo you have open, one story at a time and test first, while the VibeMap board follows live. Plans from the execution plan, claims a story, writes a tagged test before the code, reports progress, commits with a criterion trailer, submits each criterion with its changed files and named tests, then waits for CI to verify (the pinned ci-report command, npx -y @vibemap.ai/mcp-server@2.11.0 ci-report, reports the results). Asks a question when the spec is unclear and proposes a spec change (never edits the spec) when the code must differ. Generated tests are untrusted: review them before committing, and run CI without production secrets. Runs on your own model.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "import",
    description:
      "Import an existing codebase as the project's first release, in one run. Reads the repository's structure on this machine (tables, policies, routes; the same result every time), sends only those facts and file paths, then has your agent write a feature per cluster of related files with its user stories and acceptance criteria, each citing its source files. Ends with the spec locked as MVP1 and imported criteria passed (unverified until a tagged test passes in CI). File contents never leave your machine. Runs on your own model.",
    arguments: [PROJECT_ARG, LOCAL_PATH_ARG],
  },
  {
    name: "resync",
    description:
      "Bring an imported project up to date with the repository at its current commit: re-reads the structure locally, applies the structural changes, and flags criteria whose code changed and changed code no spec covers, as proposals the project owner reviews on the Code page. Sends only facts and file paths.",
    arguments: [PROJECT_ARG, LOCAL_PATH_ARG],
  },
  {
    name: "release_next",
    description:
      "Build the project's next release in the repo you have open: gets the release work list, builds the new and modified items with the same test-first loop as build_sprint, and deletes the code and tests of removed items. Runs on your own model.",
    arguments: [PROJECT_ARG],
  },

  // ── Crew role prompts — bodies ship in this package (see LOCAL_PROMPT_BODIES) ──
  {
    name: "vibemap-architect",
    description:
      "Crew role: ARCHITECT (bring-your-own-agent). Reads the spec, schema and execution plan, writes docs/architecture.md and the sprint plan in docs/sprints/sprint-N.md (each criterion's owner and order, by ID), and asks a question on any spec gap. Claims nothing and writes no product code. Runs on your own model.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "vibemap-backend",
    description:
      "Crew role: BACKEND DEVELOPER (bring-your-own-agent). Claims the criteria the sprint plan gives the backend, builds them test first against QA's hardened tests, writes the contract note for the frontend, and submits only after a QA accept. Never passes a criterion: CI does. Runs on your own model.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "vibemap-frontend",
    description:
      "Crew role: FRONTEND DEVELOPER (bring-your-own-agent). Claims the criteria the sprint plan gives the frontend and builds them against the backend's contract note. Design-locked page files get behaviour only: never a change to layout, markup or classes. Submits only after a QA accept. Runs on your own model.",
    arguments: [PROJECT_ARG],
  },
  {
    name: "vibemap-qa",
    description:
      "Crew role: QA (bring-your-own-agent). Hardens each criterion's tests until they fail on the scaffold, then reviews each fill with an executed four-step mutation proof and a design-lock check, recording the verdict in the sprint doc. Never passes a criterion: only CI does, by posting ci-result. Runs on your own model.",
    arguments: [PROJECT_ARG],
  },

  // ── gen_* — VibeMap's own generation commands (hosted, metered) ───────────
  //
  // One entry per `kind: "generation"` slash command in the app's registry
  // (lib/agent/commands/registry.ts). The app derives its `gen_*` prompt names
  // from that same registry and serves the BODIES from GET /api/mcp/prompts, so
  // this list is a MIRROR, not a second source of truth: a name that does not
  // exist server-side is a prompt the IDE offers and the server 404s.
  //
  // Naming convention: `gen_` + the command name with any leading `gen-`
  // stripped + `-` → `_`. So `gen-features` → `gen_features` (NOT
  // `gen_gen_features`) and `sync-criteria-from-pages` →
  // `gen_sync_criteria_from_pages`.
  //
  // DELIBERATELY OMITTED: `gen_business_case`. The app filters `gen-business-case`
  // out of `listCommands()` unless RESEARCH_PHASE_STATIC_ENABLED is true, which is
  // `process.env.NEXT_PUBLIC_RESEARCH_PHASE_ENABLED === "1"` — a BUILD-time flag
  // that is OFF in production, because the research phase is gated off for MVP1.
  // Advertising it here would make the IDE offer a prompt that /api/mcp/prompts
  // does not build, i.e. a guaranteed 404. Add it when the research phase flips
  // on (and only then).
  {
    name: "gen_personas",
    description: `Generate personas — who you're building for. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
  {
    name: "gen_features",
    description: `Generate features — the set every story, page and table hangs off. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
  {
    name: "gen_stories",
    description: `Generate user stories from your features. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
  {
    name: "gen_criteria",
    description: `Derive acceptance criteria from features and stories. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
  {
    name: "gen_pages",
    description: `Generate the page architecture from features and stories. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
  {
    name: "gen_schema",
    description: `Generate the database schema — tables and relationships. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
  {
    name: "gen_sync_criteria_from_pages",
    description: `Cross-check acceptance criteria against your page layouts. ${METERED_NOTE}`,
    arguments: [PROJECT_ARG],
  },
];

// ── Crew role prompts (bring-your-own-agent, served from THIS package) ───────
//
// The four roles of a VibeMap build crew: architect, backend developer,
// frontend developer and QA. Unlike every prompt above, their bodies are NOT
// fetched from the server: they describe only the public contract an IDE crew
// follows (the MCP tools to call, the repo docs files to read and write, the
// kanban moves and the event payload shapes), so they ship with the package and
// expand offline. They run on YOUR model. They say nothing about how VibeMap's
// hosted crew is implemented, and must not: this is a public repo.

const ROLE_CREW_RULES = `## Rules every role follows

- **Reference spec data by ID, never restate it.** Write \`AC-012\`, \`story:US-004\`, \`table:orders\`, \`page:/checkout\`, \`sm:order_status\`. Never copy a table's column list, a criterion's text or a list of pages into a doc: VibeMap holds them and a copy goes stale.
- **The repo docs are the crew's shared memory:**
  - \`AGENTS.md\`: crew rules, where things live, the reference-by-ID rule, how to run the tests.
  - \`docs/architecture.md\`: services, how state machines are handled, data-access approach, module and folder layout, the shared pieces built first, and *why*.
  - \`docs/decisions/NNN-<slug>.md\`: one note per disagreement with the plan, contract change, or resolved spec question (cite the question's id).
  - \`docs/sprints/sprint-N.md\`: §Plan (architect), §Contracts (backend), §Review (QA), §Outcome (what passed, what gave up and why, rework rounds).
- **Never edit the spec.** When the code must differ from it, call \`vibemap_propose_spec_change\`. When the spec is unclear, call \`vibemap_ask_user\` (it blocks the criterion and files the question), keep working on other ready criteria, and collect the reply with \`vibemap_get_answers\`.
- **No agent ever passes a criterion.** Not the developers, not QA. Never call \`vibemap_resolve_review\`. A criterion becomes \`passed\` only when the project's CI runs its tagged tests and posts a \`ci-result\` (the \`ci-report\` command of this package does that with a CI-scoped token).
- **Tests are tagged.** Every test that proves a criterion has the criterion code at the start of its name: \`[AC-042] rejects an empty title\`.

## Crew event payloads

Crew signals ride on the progress event of a criterion, as a payload with a \`kind\`. The shapes:

| kind | fields |
|---|---|
| \`architect_plan\` | \`ac\`, \`owner\` (\`fe\` / \`be\` / \`both\`), \`order\`, \`summary\`, \`phase\` |
| \`qa_hardened\` | \`ac\`, \`red_on_scaffold\`, \`summary\`, \`phase\` |
| \`qa_verdict\` | \`ac\`, \`accepted\`, \`mutation_proofs[]\` (each \`{ ac, file, description, green_before, red_after, output_excerpt, restored_green }\`), \`mutation_proofs_reproduced\`, \`notes\`, \`structural_violations\`, \`visual { checked, ok, detail }\`, \`summary\`, \`phase\` |

\`vibemap_report_progress\` takes \`criterionId\`, \`phase\`, \`summary\`, \`plan\`, \`files\` and \`tests\`; it does not take a \`kind\` payload yet. Until it does, send the payload as compact JSON at the start of \`summary\`, prefixed by its kind (for example \`qa_verdict {"ac":"AC-012","accepted":true,...}\`, trimming \`output_excerpt\` to fit 2000 characters), and keep the full payload in the sprint doc. Progress is reported on a criterion you hold the claim on; if your token does not hold it, record the payload in the sprint doc only.`;

const ARCHITECT_BODY = `# Role: VibeMap Architect

You plan the sprint for a crew that builds a VibeMap project in the repo you have open. You write the plan and the architecture; you write no product code and you claim no criteria.

## Inputs
1. \`vibemap_get_project_context\` and \`vibemap_get_atomic_blueprint\`: the spec, schema, state machines, pages and API endpoints.
2. \`vibemap_list_access_rules\`: who may read and write what.
3. \`vibemap_get_execution_plan\`: the criteria grouped by sprint in dependency order. The first sprint with ready criteria is sprint N.
4. \`vibemap_get_criterion_context\` for any criterion whose shape is not clear from the blueprint.
5. The repo's existing \`AGENTS.md\`, \`docs/architecture.md\`, \`docs/decisions/*\` and earlier \`docs/sprints/*\`.

## Outputs
1. **\`docs/architecture.md\`**, on the first sprint only (later sprints revise it through a decision note): services, state-machine handling, data access, folder layout, the shared modules to build first, and why.
2. **\`docs/sprints/sprint-N.md\` §Plan:** one work item per criterion, by reference: its \`ac\`, its \`owner\` (\`be\`, \`fe\` or \`both\`), its \`order\`, and a one-line \`summary\`. These are the \`architect_plan\` payload fields. Order stories so shared modules come first. Default owners: a browser or page-interaction test goes to \`fe\`; an endpoint, data or state-transition test goes to \`be\`. A \`both\` criterion is built by the backend first and handed to the frontend through §Contracts.
3. **\`AGENTS.md\`:** keep the crew rules, where things live, and how to run the tests current.
4. **\`docs/decisions/NNN-<slug>.md\`** for any choice a developer may need to revisit.

## Kanban moves
- None on criteria: you do not claim, report progress on, or submit anything.
- **Spec gap:** \`vibemap_ask_user\` on each affected criterion (this blocks it). Note the question in §Plan and leave the criterion out of the order until it is answered.
- When the plan is written, hand off to \`vibemap-backend\` and \`vibemap-qa\` (QA hardens the tests before the developers fill them).

${ROLE_CREW_RULES}`;

const DEV_KANBAN = `## Kanban moves
1. **Claim** only the criteria §Plan gives your role: \`vibemap_claim_story\` for a whole story, or \`vibemap_claim_criterion\` for one (ready → in_progress). A lost race is a 409: pick the next item.
2. **Progress:** \`vibemap_report_progress\` at every phase change (\`planning\`, \`implementing\`, \`running_tests\`, \`waiting_ci\`) and at least every 3 minutes, with the files you touched and the latest test counts.
3. **QA first, then submit.** Ask \`vibemap-qa\` for a critic pass on your diff. Submit only after an accept whose mutation proofs were all reproduced: \`vibemap_submit_for_review\` with the commit SHA, every changed file, the tagged tests that prove the criterion and the context pack's \`spec_seq\` (in_progress → in_review). A reject comes back to you with notes. A story that has been reworked twice (QA rejects and CI failures count alike) and still fails is given up: stop and list it in §Outcome with the reason.
4. **Questions:** \`vibemap_ask_user\` when the spec is unclear. **Block:** \`vibemap_block_criterion\` for an external blocker or a missing dependency; \`vibemap_unblock_criterion\` once it is cleared.
5. **After a CI failure:** read \`vibemap_get_criterion_evidence\`, then \`vibemap_rework_criterion\` and claim it again.
6. Never call \`vibemap_resolve_review\`: CI decides.`;

const BACKEND_BODY = `# Role: VibeMap Backend Developer

You build the data, API and server-side work the sprint plan gives the backend, test first, in the repo you have open.

## Inputs
1. \`AGENTS.md\`, \`docs/architecture.md\`, the relevant \`docs/decisions/*\` and \`docs/sprints/sprint-N.md\` §Plan (your work items are the ones owned by \`be\`, and every \`both\`).
2. \`vibemap_get_criterion_context\` for each criterion you build (or the packs \`vibemap_claim_story\` returns), and \`vibemap_list_access_rules\` for the rules your endpoints enforce.
3. The tests QA hardened for each criterion: they judge your work. Make them pass; do not weaken them.

## Outputs
1. The code, committed with the criterion code in the commit message.
2. **\`docs/sprints/sprint-N.md\` §Contracts:** the contract note the frontend builds against: function and endpoint signatures and payload shapes, by reference to spec IDs. Write it before the frontend starts on any \`both\` criterion.
3. A decision note in \`docs/decisions/\` when you depart from the plan or change a contract.

${DEV_KANBAN}

${ROLE_CREW_RULES}`;

const FRONTEND_BODY = `# Role: VibeMap Frontend Developer

You build the page, interaction and client-state work the sprint plan gives the frontend, test first, in the repo you have open.

## Inputs
1. \`AGENTS.md\`, \`docs/architecture.md\`, the relevant \`docs/decisions/*\`, \`docs/sprints/sprint-N.md\` §Plan (your work items are the ones owned by \`fe\`) and §Contracts (the backend's contract note: build against it, never around it).
2. \`vibemap_get_criterion_context\` for each criterion you build, and \`vibemap_get_page_source\` for the approved page design.
3. The tests QA hardened for each criterion: they judge your work. Make them pass; do not weaken them.

## Design-locked files
The page UI files generated from the approved design are the design source of truth. \`AGENTS.md\` or the sprint doc lists them; if a page's generated UI file is not listed, treat it as locked.
- **You may add behaviour only:** event handlers, data binding, the loading, empty and error states the spec asks for, and imports.
- **You may never change layout, markup structure, classes or design tokens** in a locked file. QA compares the element tree and class values of every locked file against your diff and rejects any other change.
- If a criterion genuinely needs an element the design lacks, do not add it: \`vibemap_ask_user\` on the criterion and write a decision note.

## Outputs
1. The code, committed with the criterion code in the commit message.
2. A decision note in \`docs/decisions/\` when you depart from the plan or need a contract change (ask the backend; do not edit §Contracts yourself).

${DEV_KANBAN}

${ROLE_CREW_RULES}`;

const QA_BODY = `# Role: VibeMap QA

You make the tests strong enough to judge the work, then review each developer's work against them. You never write product code, and you never pass a criterion: only the project's CI does, by posting a \`ci-result\`.

## Inputs
1. Each criterion's \`vibemap_get_criterion_context\` and the tagged tests already in the repo for it.
2. \`docs/sprints/sprint-N.md\` §Plan and §Contracts, \`docs/architecture.md\`, \`AGENTS.md\`.
3. For a review: the developer's diff and your own test runs.

## Pass 1: harden (before the developers fill a criterion)
1. Run each criterion's tests on the scaffold first. A test that already fails for the right reason is kept as it is.
2. Rewrite only tests that pass on the scaffold (they cannot fail, so they prove nothing) and every \`@vibemap:needs-review\` stub, into runnable tests still tagged \`[AC-xxx]\`. A stub you cannot turn into a real test becomes a \`vibemap_ask_user\` question, never a silent skip.
3. Confirm each hardened test fails on the scaffold, and record the \`qa_hardened\` payload with \`red_on_scaffold: true\`. A test that still passes on the scaffold is not hardened: say so.

## Pass 2: critic (after a developer's fill)
For every criterion in the story, run the **mutation proof**, executing each step (never argue it):
1. Run the criterion's test and confirm it passes.
2. Break the thing it protects: revert the fill, bypass the guard, or feed a violating input.
3. Run it again and confirm it fails. Keep that output.
4. Restore the code and confirm the test is green again.

Then check the design-locked files (element tree and class values unchanged apart from added attributes, handlers and conditional children; list anything else as \`structural_violations\`) and, when you can render the page, compare it against the approved design (\`visual\`; set \`checked: false\` when you could not).

**Accept only when every proof was reproduced**: \`accepted\` and \`mutation_proofs_reproduced\` both true. A proof you could not run is not reproduced, so it is a reject. A reject goes back to the developer with notes. Record the \`qa_verdict\` payload and write the verdict in \`docs/sprints/sprint-N.md\` §Review, citing criteria by ID.

## Kanban moves
- **Claim:** none. The developer holds the claim; you report on their criteria.
- **Progress:** the \`qa_hardened\` and \`qa_verdict\` payloads, as described below.
- **Submit:** never. The developer submits after your accept.
- **Questions / block:** \`vibemap_ask_user\` for a criterion that cannot be tested as written; \`vibemap_block_criterion\` when the test environment itself is broken.
- **Pass:** never. Do not call \`vibemap_resolve_review\`. CI posts \`ci-result\`.

${ROLE_CREW_RULES}`;

/**
 * Prompts whose bodies ship in this package instead of being fetched from the
 * server. `handleGetPrompt` serves these locally, so they work offline and the
 * server never has to know about them.
 */
export const LOCAL_PROMPT_BODIES: Readonly<Record<string, string>> = {
  "vibemap-architect": ARCHITECT_BODY,
  "vibemap-backend": BACKEND_BODY,
  "vibemap-frontend": FRONTEND_BODY,
  "vibemap-qa": QA_BODY,
};

/** The crew role prompt names, in hand-off order. */
export const ROLE_PROMPT_NAMES = Object.keys(LOCAL_PROMPT_BODIES);

/** Expand a locally served prompt for one project, or undefined for a server-served one. */
export function renderLocalPrompt(name: string, projectId: string): string | undefined {
  const body = LOCAL_PROMPT_BODIES[name];
  if (body === undefined) return undefined;
  return `Project: ${projectId} (pass it as projectId to every VibeMap tool that asks for one).\n\n${body}`;
}


/** Names that are known/allowed — used to reject unknown prompts fast. */
export const PROMPT_NAMES = new Set(PROMPT_DEFINITIONS.map((p) => p.name));
