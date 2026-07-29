import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Single source of truth for the MCP tool list.
 *
 * `handleListTools` returns this array verbatim, and any additional transport
 * (e.g. a future Streamable-HTTP server) can import it to advertise the same
 * tool set. The dispatch switch in `index.ts` must have a matching `case` for
 * every `name` here — `tests/tools.test.ts` asserts the exposed set matches
 * `EXPECTED_TOOL_NAMES` exactly, so adding/removing a tool here without wiring
 * its handler (or vice versa) fails CI.
 */
export const TOOL_DEFINITIONS: Tool[] = [
  // ── Group 1: Projects ──────────────────────────────────────────────────
  {
    name: "vibemap_list_projects",
    description:
      "List all VibeMap projects for the authenticated user. Returns project IDs, names, descriptions, and status.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "vibemap_create_project",
    description:
      "Create a new VibeMap project. Use this when starting from an existing codebase — create the project first, then call vibemap_analyze_codebase with the returned project ID.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name (3-100 characters)",
        },
        description: {
          type: "string",
          description:
            "Detailed project description (50+ characters). The more detail, the better the AI analysis.",
        },
      },
      required: ["name", "description"],
    },
  },
  {
    name: "vibemap_get_project_context",
    description:
      "Retrieve the full context of a VibeMap project including features, user stories, personas, pages, and database schema. Use this before building a feature to understand all the specs.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The VibeMap project ID" },
        includeFeatures: { type: "boolean", default: true },
        includeStories: { type: "boolean", default: true },
        includePersonas: { type: "boolean", default: true },
        includePages: { type: "boolean", default: true },
        includeSchema: { type: "boolean", default: true },
      },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_get_atomic_blueprint",
    description:
      "Retrieve a code-shaped atomic blueprint of a VibeMap project — relationships hydrated, Kanban metadata stripped, with synthesized interactions and entity state machines. Designed for LLM coders building the application end-to-end. Prefer this over vibemap_get_project_context when generating code; the blueprint omits PM narrative and process metadata to maximise signal-per-token.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The VibeMap project ID" },
      },
      required: ["projectId"],
    },
  },

  {
    name: "vibemap_list_access_rules",
    description:
      'List a VibeMap project\'s access-control rules: table-level rules (per persona/role, with can_select/insert/update/delete and structured op_conditions predicates like "own rows only") and page-level rules (can_view/create_content/edit/delete with predicates), plus an advisory reconciliation summary flagging page↔table drift. Use this to generate correct RLS policies and route/UI authorization — the atomic blueprint only carries page-level conditions, so call this for table-level (RLS) access control.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The VibeMap project ID" },
      },
      required: ["projectId"],
    },
  },

  {
    name: "vibemap_list_changesets",
    description:
      "List a VibeMap project's version-control changesets (most recent first) with a per-changeset op count. Every write you make through this server is wrapped in a changeset, so use this to see the changesets your own edits produced, audit who/what changed the project, or review recent edit history. Pass includeOps=true to inline each changeset's individual operations (entity_type, op, diff).",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The VibeMap project ID" },
        limit: {
          type: "number",
          description: "Max changesets to return (1-200, default 50)",
        },
        includeOps: {
          type: "boolean",
          description: "Inline each changeset's individual ops + diffs (default false)",
        },
      },
      required: ["projectId"],
    },
  },

  {
    name: "vibemap_get_page_source",
    description:
      "Retrieve a VibeMap page's generated source code so you can pull it straight into a repo. Returns the page's own source_code plus the source_code of each of its sections. Use this to export a generated page into your codebase instead of copy-pasting.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "The VibeMap project ID" },
        pageId: { type: "string", description: "The page ID to export" },
      },
      required: ["projectId", "pageId"],
    },
  },

  // ── Group 1b: Personas & Pages (spec authoring) ────────────────────────
  {
    name: "vibemap_create_persona",
    description:
      "Create a user persona in a VibeMap project. Personas are the cast of users the spec is written for — author them FIRST, then reference each persona's role (userRole) when writing user stories. Match the depth VibeMap's own generator produces: fill the structured blocks so the persona is rich and semantically searchable, not just a name. Existing personas are visible via vibemap_get_project_context — enrich, don't duplicate. All params are camelCase.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string", description: "Persona's first name" },
        userRole: {
          type: "string",
          description:
            "Canonical role this persona represents (e.g. 'admin', 'diver'). User stories reference this role.",
        },
        tagline: { type: "string", description: "Brief one-line descriptor" },
        avatarDescription: { type: "string", description: "Brief visual description" },
        demographics: {
          type: "object",
          description: "Who they are",
          properties: {
            ageRange: { type: "string" },
            gender: { type: "string" },
            location: { type: "string" },
            education: { type: "string" },
            incomeLevel: { type: "string" },
            occupation: { type: "string" },
            familyStructure: { type: "string" },
          },
        },
        psychographics: {
          type: "object",
          description: "What drives them",
          properties: {
            values: { type: "array", items: { type: "string" } },
            personalityTraits: { type: "array", items: { type: "string" } },
            motivations: { type: "array", items: { type: "string" } },
            aspirations: { type: "array", items: { type: "string" } },
          },
        },
        goalsAndNeeds: {
          type: "object",
          description: "What they are trying to achieve",
          properties: {
            primaryObjectives: { type: "array", items: { type: "string" } },
            problemsToSolve: { type: "array", items: { type: "string" } },
            functionalNeeds: { type: "array", items: { type: "string" } },
            emotionalNeeds: { type: "array", items: { type: "string" } },
          },
        },
        painPoints: {
          type: "object",
          description: "What frustrates or blocks them",
          properties: {
            currentChallenges: { type: "array", items: { type: "string" } },
            barriers: { type: "array", items: { type: "string" } },
            skillGaps: { type: "array", items: { type: "string" } },
          },
        },
        productSpecific: {
          type: "object",
          description: "How they relate to this product",
          properties: {
            featurePriorities: { type: "array", items: { type: "string" } },
            primaryUseCases: { type: "array", items: { type: "string" } },
            technicalProficiency: { type: "string" },
            priceSensitivity: { type: "string" },
          },
        },
        communicationPreferences: {
          type: "object",
          description: "How to reach them",
          properties: {
            contentPreferences: { type: "array", items: { type: "string" } },
            messagingResponse: { type: "string" },
          },
        },
        narrative: {
          type: "object",
          description: "Their voice",
          properties: {
            quote: { type: "string" },
            keyFrustrations: { type: "string" },
          },
        },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "vibemap_create_page",
    description:
      "Create a page/screen in a VibeMap project's page inventory. Author pages after features, stories, and criteria to capture the app's screens and routes. Existing pages are visible via vibemap_get_project_context — enrich, don't duplicate.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string", description: "Page name (e.g. 'Dashboard')" },
        path: { type: "string", description: "Route path (e.g. '/dashboard')" },
        description: { type: "string", description: "What this page is for" },
        status: { type: "string", enum: ["draft", "confirmed"], default: "draft" },
      },
      required: ["projectId", "name"],
    },
  },

  // ── Group 2: Features ──────────────────────────────────────────────────
  {
    name: "vibemap_list_features",
    description:
      "List features for a VibeMap project. Supports filtering by status, priority, category, and search. Returns paginated results.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: { type: "string", enum: ["draft", "open", "in_progress", "completed"] },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        category: { type: "string", enum: ["core", "enhancement", "infrastructure"] },
        search: { type: "string" },
        limit: { type: "number", default: 50 },
        offset: { type: "number", default: 0 },
      },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_create_feature",
    description:
      "Create a new feature in a VibeMap project. Use this when reverse-engineering a codebase to register discovered capabilities.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
        category: {
          type: "string",
          enum: ["core", "enhancement", "infrastructure"],
          default: "core",
        },
        complexity: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
        effort: { type: "string", enum: ["xs", "s", "m", "l", "xl"], default: "m" },
        business_value: { type: "string", enum: ["low", "medium", "high"], default: "medium" },
      },
      required: ["projectId", "name"],
    },
  },
  {
    name: "vibemap_update_feature",
    description: "Update an existing feature's fields or status in VibeMap.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        featureId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        category: { type: "string", enum: ["core", "enhancement", "infrastructure"] },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
        effort: { type: "string", enum: ["xs", "s", "m", "l", "xl"] },
        business_value: { type: "string", enum: ["low", "medium", "high"] },
        status: { type: "string", enum: ["draft", "open", "in_progress", "completed"] },
      },
      required: ["featureId"],
    },
  },

  // ── Group 3: User Stories ──────────────────────────────────────────────
  {
    name: "vibemap_list_user_stories",
    description:
      "List user stories for a project or feature. Filter by status, priority. Returns paginated results with full story detail.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Filter by project (use featureId for more specific results)",
        },
        featureId: { type: "string", description: "Filter by specific feature" },
        status: {
          type: "string",
          enum: ["draft", "has_criteria", "open", "in_progress", "completed"],
        },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        search: { type: "string" },
        limit: { type: "number", default: 50 },
        offset: { type: "number", default: 0 },
      },
    },
  },
  {
    name: "vibemap_create_user_story",
    description:
      "Create a new user story inside a VibeMap feature. Provide the user role, action, and expected outcome.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        featureId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"], default: "medium" },
        userRole: { type: "string", description: "e.g., 'admin', 'developer', 'guest'" },
        iWantTo: { type: "string", description: "What the user wants to do" },
        soThat: { type: "string", description: "The benefit / outcome" },
        estimatedEffort: { type: "number", default: 0 },
      },
      required: ["featureId", "title", "description"],
    },
  },
  {
    name: "vibemap_update_user_story",
    description: "Update an existing user story's fields or status in VibeMap.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        storyId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        status: {
          type: "string",
          enum: ["draft", "has_criteria", "open", "in_progress", "completed"],
        },
        estimatedEffort: { type: "number" },
        userRole: { type: "string" },
        iWantTo: { type: "string" },
        soThat: { type: "string" },
      },
      required: ["storyId"],
    },
  },

  // ── Group 4: Acceptance Criteria ───────────────────────────────────────
  {
    name: "vibemap_list_acceptance_criteria",
    description:
      "List acceptance criteria for a story, feature, or project. Returns BDD-formatted criteria (Given/When/Then) with status.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        storyId: { type: "string" },
        featureId: { type: "string" },
        projectId: { type: "string" },
        status: { type: "string", enum: ["draft", "pending", "passed", "failed"] },
        limit: { type: "number", default: 50 },
        offset: { type: "number", default: 0 },
      },
    },
  },
  {
    name: "vibemap_create_acceptance_criterion",
    description:
      "Create a new acceptance criterion for a user story in BDD format (Given/When/Then). Use this to flesh out what 'done' means for a story before or during implementation. You can call this multiple times to add multiple scenarios (happy path, error cases, edge cases) to the same story.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        storyId: {
          type: "string",
          description: "ID of the user story this criterion belongs to",
        },
        givenCondition: { type: "string", description: "Precondition / context ('Given …')" },
        whenAction: { type: "string", description: "Action performed ('When …')" },
        thenOutcome: { type: "string", description: "Expected result ('Then …')" },
        description: { type: "string", description: "Optional plain-text summary" },
        scenarioCategory: {
          type: "string",
          enum: ["happy_path", "error_scenario", "edge_case"],
          default: "happy_path",
        },
        status: {
          type: "string",
          enum: ["draft", "pending", "passed", "failed"],
          default: "draft",
        },
      },
      required: ["storyId", "givenCondition", "whenAction", "thenOutcome"],
    },
  },
  {
    name: "vibemap_update_acceptance_criterion",
    description:
      "Update an acceptance criterion's status or content. Use status 'passed' when your code satisfies the criterion, 'failed' when it does not.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        criterionId: { type: "string" },
        status: { type: "string", enum: ["draft", "pending", "passed", "failed"] },
        givenCondition: { type: "string" },
        whenAction: { type: "string" },
        thenOutcome: { type: "string" },
        description: { type: "string" },
        scenarioCategory: {
          type: "string",
          enum: ["happy_path", "error_scenario", "edge_case"],
        },
      },
      required: ["criterionId"],
    },
  },

  // ── Group 5: Kanban Tracking ───────────────────────────────────────────
  {
    name: "vibemap_update_kanban_status",
    description:
      "[DEPRECATED — use the typed transition tools (claim, report_progress, submit_for_review, resolve_review, block, unblock) instead. This tool will be removed in a future release.] Atomically advance or update the kanban status of a feature, user story, or acceptance criterion. Validates allowed state transitions and prevents invalid moves. Call this when you start or finish implementing something.\n\nFeature stages: draft → open → in_progress → completed\nStory stages: draft → has_criteria → open → in_progress → completed\nCriterion stages: draft → pending → passed | failed",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        entityType: {
          type: "string",
          enum: ["feature", "story", "criterion"],
          description: "Type of item to update",
        },
        entityId: { type: "string", description: "ID of the feature, story, or criterion" },
        newStatus: { type: "string", description: "Target kanban status" },
        notes: {
          type: "string",
          description: "Optional context about why this transition was made",
        },
      },
      required: ["entityType", "entityId", "newStatus"],
    },
  },
  {
    name: "vibemap_get_kanban_board",
    description:
      "Get a real-time kanban board view of a project grouped by status columns. Shows features with their stories nested underneath. Ideal for an IDE agent to understand what's planned, in progress, and done.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        includeCriteria: {
          type: "boolean",
          default: false,
          description: "Include acceptance criteria counts per story",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_get_next_ready_criterion",
    description:
      "Get the highest-priority acceptance criterion in `ready` status for the given project. Returns the criterion to work on next, or null if nothing is ready.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: { type: "string", description: "Project UUID" },
      },
    },
  },
  {
    name: "vibemap_claim_criterion",
    description:
      "Atomically claim an acceptance criterion for implementation. Transitions ready → in_progress. Returns 409 (race) if another agent already claimed it.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId"],
      properties: {
        criterionId: { type: "string", description: "Acceptance criterion UUID" },
      },
    },
  },
  {
    name: "vibemap_report_progress",
    description:
      "Append a progress event to the criterion timeline without changing its status. Used to surface intermediate work for visibility.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "summary"],
      properties: {
        criterionId: { type: "string" },
        summary: { type: "string", description: "Short progress note (1-2000 chars)" },
      },
    },
  },
  {
    name: "vibemap_submit_for_review",
    description:
      "Submit completed work for review. Transitions in_progress → in_review. Requires a git SHA and a diff URL as evidence.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "gitSha", "diffUrl"],
      properties: {
        criterionId: { type: "string" },
        gitSha: { type: "string", description: "7+ char commit SHA" },
        diffUrl: {
          type: "string",
          description: "URL to view the diff (PR link or compare URL)",
        },
        notes: {
          type: "string",
          description: "Optional notes for the reviewer (max 2000 chars)",
        },
      },
    },
  },
  {
    name: "vibemap_resolve_review",
    description:
      "Resolve a criterion in review. Transitions in_review → passed | failed. NOTE: agents (env_token:agent) cannot self-resolve their own work — this tool requires a CI-scoped token (env_token:ci) or a session user.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "outcome"],
      properties: {
        criterionId: { type: "string" },
        outcome: { type: "string", enum: ["passed", "failed"] },
        testRunUrl: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "vibemap_block_criterion",
    description:
      "Mark a criterion as blocked. Transitions any-active-status → blocked. Use this when external dependency, ambiguity, or environmental issue prevents progress.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "category", "reason"],
      properties: {
        criterionId: { type: "string" },
        category: {
          type: "string",
          enum: ["spec_unclear", "missing_dep", "external_blocker", "other"],
        },
        reason: {
          type: "string",
          description: "Human-readable explanation (1-2000 chars)",
        },
      },
    },
  },
  {
    name: "vibemap_unblock_criterion",
    description:
      "Unblock a criterion. Transitions blocked → prior_status (recorded when block was set; defaults to ready).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "resolution"],
      properties: {
        criterionId: { type: "string" },
        resolution: {
          type: "string",
          description: "How the blocker was resolved (1-2000 chars)",
        },
      },
    },
  },
  {
    name: "vibemap_list_kanban_events",
    description:
      "List kanban transition events for a project, newest first. Use `since` to fetch only events after a timestamp (for reconnect-backfill).",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: { type: "string" },
        since: {
          type: "string",
          description: "ISO timestamp; only events strictly after this are returned",
        },
        limit: {
          type: "number",
          description: "Max events to return (default 200, max 1000)",
        },
      },
    },
  },

  // ── Group 6: Codebase Analysis ─────────────────────────────────────────
  {
    name: "vibemap_scan_codebase",
    description:
      "Scan a local directory and return a formatted tree view plus file statistics. Use this to explore and understand an existing codebase before syncing to VibeMap.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        localPath: {
          type: "string",
          description: "Absolute path to the local project directory",
        },
        depth: { type: "number", default: 4, description: "Max directory depth to traverse" },
      },
      required: ["localPath"],
    },
  },
  {
    name: "vibemap_analyze_codebase",
    description:
      "Scan a local codebase and submit it to VibeMap for AI-powered reverse engineering. The server-side generation persists FEATURES from the code digest. It does NOT persist user stories or acceptance criteria — after the features task completes (poll vibemap_get_generation_status), create those yourself with vibemap_create_user_story and vibemap_create_acceptance_criterion, using your full codebase access for accuracy. Returns a sessionId to poll.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The VibeMap project to populate with discovered specs",
        },
        localPath: {
          type: "string",
          description: "Absolute path to the local project directory",
        },
        depth: { type: "number", default: 4 },
        taskTitle: { type: "string", default: "Reverse Engineer Codebase" },
      },
      required: ["projectId", "localPath"],
    },
  },

  {
    name: "vibemap_submit_code_map",
    description:
      "Submit a structural code map of the user's codebase to VibeMap (rendered on the project's Codebase tab). Build it yourself from your codebase access: one node per meaningful unit (page/route, API endpoint, data model, service, module, config), edges for imports/routes/reads/writes. Node kinds: page|api|model|service|module|config. Layers: ui|api|data|services|shared. Edge kinds: imports|routes|reads|writes. Use repo-relative paths as node ids. Max 500 nodes — aggregate small files into their module. Re-submitting replaces the project's map and resets it to draft for the user to re-confirm.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project to attach the map to" },
        map: {
          type: "object",
          description:
            "{ nodes: [{id,label,kind,path,layer,summary?}], edges: [{source,target,kind}], stats?: {totalFiles,scannedAt} }",
          properties: {
            nodes: { type: "array" },
            edges: { type: "array" },
            stats: { type: "object" },
          },
          required: ["nodes", "edges"],
        },
        anchor: {
          type: "object",
          description: "Optional sync anchor: { commitSha?, scannedAt? } (git rev-parse HEAD)",
          properties: { commitSha: { type: "string" }, scannedAt: { type: "string" } },
        },
      },
      required: ["projectId", "map"],
    },
  },
  {
    name: "vibemap_get_code_map",
    description:
      "Fetch the project's current code map (status draft|confirmed, nodes/edges, sync anchor incl. any drift report). Use before re-submitting to preserve the user's hidden-node curation where possible.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_sync_changes",
    description:
      "Report codebase changes since the last sync so VibeMap can flag spec drift. Workflow: 1) call vibemap_get_code_map and read anchor.commitSha; 2) run `git diff --name-only <commitSha>..HEAD` (plus untracked files from `git status --porcelain`); 3) call this tool with the changed paths and your current HEAD sha. The response lists affected map units and features — update the stale specs with vibemap_update_feature / vibemap_update_user_story / vibemap_update_acceptance_criterion (all changeset-audited), then re-submit the code map with vibemap_submit_code_map to clear the drift.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project id" },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Repo-relative paths changed since anchor.commitSha (max 2000)",
        },
        headSha: { type: "string", description: "Current HEAD commit sha (git rev-parse HEAD)" },
      },
      required: ["projectId", "changedFiles"],
    },
  },

  // ── Group 7: Generation Status ─────────────────────────────────────────
  {
    name: "vibemap_get_generation_status",
    description:
      "Poll the status of a VibeMap AI generation task (e.g., reverse engineering or spec generation). Use the sessionId returned by vibemap_analyze_codebase.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID from vibemap_analyze_codebase" },
      },
      required: ["sessionId"],
    },
  },
];
