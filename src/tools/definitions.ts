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
      "Retrieve a code-shaped atomic blueprint of a VibeMap project — relationships hydrated, Kanban metadata stripped, with synthesized interactions and entity state machines. It covers the WHOLE project and can be very large on big projects (on the order of 150K tokens), so use it for one-off whole-project work such as an initial scaffold or an audit. While building a ticket, do not fetch it: call vibemap_get_criterion_context for the criterion you are working on instead, which returns only what that criterion needs, in a few thousand tokens. For general reading prefer vibemap_get_project_context.",
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
    name: "vibemap_get_review_plan",
    description:
      "Get the ordered list of what stands between a VibeMap project and being ready to build — the same walkthrough the Prepare map shows the user and the same one the in-app agent's briefs come from. Findings on their own are an unordered set, so use this instead of inventing your own priority: steps are grouped by finding kind, ordered so a fix never invalidates earlier work (access → data → surfaces → behaviour → detail → reconcile), and each carries why it matters, which map nodes it concerns, and how it is resolved (action.kind: fix | generate | reconcile | propose | navigate — `fix` and `generate` are automatic, `reconcile` and `propose` produce a change a human approves, `navigate` is a link with no automatic action). Check sources_failed — a non-empty list means some checks did not run, so an empty plan is NOT a clean bill of health. Read-only.",
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
        sinceSeq: {
          type: "number",
          description:
            "Cursor: only changesets after this sequence number, oldest first. The response includes the next cursor to pass on the following call.",
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
  {
    name: "vibemap_create_schema",
    description:
      "Persist a VibeMap project's database schema — tables, columns, and relationships — in one call. Author this LAST, after the rest of the spec exists, grounded on the spec (idea-first) or the codebase's models/migrations (code-first). One table per domain entity; give every table an `id` primary key and created_at/updated_at; set real Postgres column types + constraints; express foreign keys via each column's `foreignKey` (relationships auto-derive from these, so `relationships` is optional); add junction tables for many-to-many. All params are camelCase (this IS VibeMap's SchemaJSON). Existing schema is visible via vibemap_get_project_context (dbSchema) — the server keyed-reconciles, so re-running is safe. Table/page access rules are handled by the separate access-rules flow, not here.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        tables: {
          type: "array",
          description: "One entry per table (snake_case, plural names).",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Table name (snake_case, plural)" },
              description: { type: "string", description: "What this table stores" },
              columns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Column name (snake_case)" },
                    type: {
                      type: "string",
                      description: "Postgres type, e.g. UUID, TEXT, INTEGER, TIMESTAMPTZ, BOOLEAN",
                    },
                    primaryKey: { type: "boolean" },
                    nullable: { type: "boolean" },
                    unique: { type: "boolean" },
                    default: {
                      type: "string",
                      description: "SQL default, e.g. gen_random_uuid(), now()",
                    },
                    description: { type: "string" },
                    check: { type: "string", description: "CHECK constraint expression" },
                    maxLength: { type: "string", description: "VARCHAR/CHAR length" },
                    foreignKey: {
                      type: "object",
                      description: "FK reference — relationship auto-derives from this",
                      properties: {
                        table: { type: "string" },
                        column: { type: "string" },
                      },
                      required: ["table", "column"],
                    },
                  },
                  required: ["name", "type"],
                },
              },
            },
            required: ["name", "columns"],
          },
        },
        relationships: {
          type: "array",
          description:
            "Optional — foreign keys on columns auto-derive relationships. Provide only for relationships not expressed by a column FK.",
          items: {
            type: "object",
            properties: {
              sourceTable: { type: "string" },
              sourceColumn: { type: "string" },
              targetTable: { type: "string" },
              targetColumn: { type: "string" },
              sourceCardinality: { type: "string", enum: ["1", "N"] },
              targetCardinality: { type: "string", enum: ["1", "N"] },
              onDelete: { type: "string", description: "e.g. CASCADE, SET NULL" },
            },
            required: [
              "sourceTable",
              "sourceColumn",
              "targetTable",
              "targetColumn",
              "sourceCardinality",
              "targetCardinality",
            ],
          },
        },
      },
      required: ["projectId", "tables"],
    },
  },

  // ── Group 1b: Conversational Agent (Engine B — hosted, metered) ──────────
  {
    name: "vibemap_agent",
    description:
      "Drive VibeMap's full conversational agent for one turn — the same brain as the in-app chat sidebar, entered through MCP. Give it a natural-language `message` (ask a question, or request a change like 'add a persona for admins', 'generate user stories for the billing feature', 'rename the Orders page'). This is METERED: it runs on VibeMap's own models and draws down the project owner's VibeMap token budget — unlike the granular create_*/list_* tools, which run on your agent and are unmetered. Use it when you want VibeMap to do the thinking; use the granular tools when your own agent authors content. CONFIRMATION (two calls): a destructive or sensitive request (deletes, permission changes, paid pipelines) replies with `confirmationRequired: true`, a human-readable `plan`, and an `operationId` — show the plan to the user, then approve with a second call `{ projectId, approveOperationId }` (or `{ projectId, approve: true }`, or a natural 'yes'). Nothing changes until you approve. ASYNC: turns that kick off a generation (features, user stories, schema, business case, …) reply with `generationStarted: true` and start a background job — poll it with vibemap_get_generation_status, then read results with the list_* tools. MEMORY: omit `sessionId` and the agent auto-threads history per project across calls; pass back the `sessionId` from a prior reply to pin a thread.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project the agent operates on (you must own it)" },
        message: {
          type: "string",
          description:
            "Natural-language instruction or question. Required unless approving a pending operation.",
        },
        model: {
          type: "string",
          description: "Optional model id for the turn (defaults to VibeMap's economy model).",
        },
        sessionId: {
          type: "string",
          description:
            "Optional conversation thread (uuid). Omit to auto-thread history per project; pass the sessionId from a prior reply to continue that thread.",
        },
        approveOperationId: {
          type: "string",
          description:
            "Approve a specific pending operation returned by an earlier confirmationRequired reply.",
        },
        approve: {
          type: "boolean",
          description: "Approve the latest pending operation without quoting its operationId.",
        },
      },
      required: ["projectId"],
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
    description:
      "Update an existing feature's fields or status in VibeMap. For spec authoring only: while building a ticket, use vibemap_propose_spec_change instead, so a person reviews the change.",
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
    description:
      "Update an existing user story's fields or status in VibeMap. For spec authoring only: while building a ticket, use vibemap_propose_spec_change instead, so a person reviews the change.",
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
      "List acceptance criteria for a story, feature, or project. Returns BDD-formatted criteria (Given/When/Then) with their current status. Status is read-only here: it only moves through the claim, report-progress, submit-for-review and block/unblock tools, and a criterion is marked passed or failed by CI or a human reviewer, never by the agent that built it.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        storyId: { type: "string" },
        featureId: { type: "string" },
        projectId: { type: "string" },
        status: {
          type: "string",
          enum: ["draft", "ready", "in_progress", "in_review", "passed", "failed", "blocked"],
          description: "Filter by current status",
        },
        limit: { type: "number", default: 50 },
        offset: { type: "number", default: 0 },
      },
    },
  },
  {
    name: "vibemap_create_acceptance_criterion",
    description:
      "Create a new acceptance criterion for a user story in BDD format (Given/When/Then). Use this to flesh out what 'done' means for a story before or during implementation. You can call this multiple times to add multiple scenarios (happy path, error cases, edge cases) to the same story. New criteria always start as drafts; they become available to build once the spec is approved.",
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
      },
      required: ["storyId", "givenCondition", "whenAction", "thenOutcome"],
    },
  },
  {
    name: "vibemap_update_acceptance_criterion",
    description:
      "Update the content of an acceptance criterion (Given/When/Then, description, scenario category). This tool does not change status. To work on a criterion use vibemap_claim_criterion (or vibemap_claim_story), then vibemap_report_progress, then vibemap_submit_for_review when your code satisfies it; CI or a human reviewer decides whether it passes. For spec authoring only: while building a ticket, use vibemap_propose_spec_change instead, so a person reviews the change.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        criterionId: { type: "string" },
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
      "[DEPRECATED — use the typed transition tools (claim, report_progress, submit_for_review, resolve_review, block, unblock) instead. This tool will be removed in a future release.] Atomically advance or update the kanban status of a feature or user story. Validates allowed state transitions and prevents invalid moves. Works for features and user stories only. Acceptance criteria cannot be moved with this tool: use vibemap_claim_criterion, vibemap_report_progress, vibemap_submit_for_review, vibemap_block_criterion and vibemap_unblock_criterion, which record who moved what and why.\n\nFeature stages: draft → open → in_progress → completed\nStory stages: draft → has_criteria → open → in_progress → completed",
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
      "Get the next acceptance criterion to work on for the given project, plus the other ready criteria of the same story (`bundle`) so the whole story can be built together. When nothing can be claimed, `criterion` is null and `reason` says why (for example awaiting approval, awaiting review, failed and needing rework, blocked, or everything passed), with `blocking` listing the criteria behind it. `skipped_sprints` lists earlier sprints that still have leftovers waiting on a person or CI. Pass releaseId to scope the answer to one release.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        releaseId: {
          type: "string",
          description: "Optional release UUID; defaults to the project's active release",
        },
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
      "Report what you are doing on a criterion you have claimed, without changing its status. This is the heartbeat the board shows live: call it at every phase change (planning, writing_test, implementing, running_tests, waiting_ci) and at least every 3 minutes while working. Optionally attach your step plan, the files you have touched and the latest test counts.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "phase"],
      properties: {
        criterionId: { type: "string" },
        phase: {
          type: "string",
          enum: ["planning", "writing_test", "implementing", "running_tests", "waiting_ci"],
          description: "What you are doing right now",
        },
        summary: { type: "string", description: "Short progress note (1-2000 chars)" },
        plan: {
          type: "array",
          description: "Your step plan; resend it with done flags updated as you go (max 50)",
          items: {
            type: "object",
            properties: {
              step: { type: "string", description: "One step (1-500 chars)" },
              done: { type: "boolean" },
            },
            required: ["step", "done"],
          },
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Repo-relative paths you have changed so far (max 200)",
        },
        tests: {
          type: "object",
          description: "Latest local test counts",
          properties: {
            passed: { type: "number" },
            failed: { type: "number" },
            total: { type: "number" },
          },
          required: ["passed", "failed", "total"],
        },
      },
    },
  },
  {
    name: "vibemap_submit_for_review",
    description:
      "Submit completed work for review. Transitions in_progress -> in_review. Requires the commit SHA, the files you changed and the named tests that prove the criterion (each test name should start with the criterion's code, for example `[AC-042] rejects an empty title`). A passing local run does not finish the criterion: CI (or a person) decides, and only a passing CI run marks it verified.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "gitSha", "changedFiles", "tests"],
      properties: {
        criterionId: { type: "string" },
        gitSha: { type: "string", description: "7+ char commit SHA of the work" },
        baseSha: {
          type: "string",
          description: "Commit SHA the work was based on (7+ chars)",
        },
        specSeq: {
          type: "number",
          description:
            "The spec sequence number from the context pack you built against, so a later spec change can be detected",
        },
        diffUrl: {
          type: "string",
          description: "Optional URL to view the diff (PR link or compare URL)",
        },
        changedFiles: {
          type: "array",
          description: "Every file the work changed (at least one)",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Repo-relative path" },
              status: { type: "string", enum: ["added", "modified", "deleted", "renamed"] },
              additions: { type: "number" },
              deletions: { type: "number" },
            },
            required: ["path", "status"],
          },
        },
        tests: {
          type: "array",
          description: "The named tests that prove the criterion (at least one)",
          items: {
            type: "object",
            properties: {
              file: { type: "string", description: "Repo-relative test file" },
              name: { type: "string", description: "Full test name, tagged like `[AC-042] ...`" },
              acCodes: {
                type: "array",
                items: { type: "string" },
                description: "Criterion codes this test proves, like AC-042",
              },
            },
            required: ["file", "name", "acCodes"],
          },
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
      "Mark a criterion as blocked. Transitions any-active-status → blocked. Use this when external dependency or an environmental issue prevents progress. For an unclear spec, prefer vibemap_ask_user, which also files a question for a person to answer.",
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
  {
    name: "vibemap_claim_story",
    description:
      "Claim every claimable acceptance criterion of one story in a single call, so the whole story is built together. The response lists what was claimed, what was skipped and why, and a context pack for each claimed criterion (the same pack vibemap_get_criterion_context returns). All or nothing: if another agent wins a race, nothing is left claimed by this call. Packs that do not fit are listed as omitted; fetch them one by one.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["storyId"],
      properties: {
        storyId: { type: "string", description: "User story UUID" },
        includeSource: {
          type: "boolean",
          description: "Include the source of related code in each pack (default false)",
        },
      },
    },
  },
  {
    name: "vibemap_get_criterion_context",
    description:
      "Get everything needed to build one acceptance criterion, in a few thousand tokens: the criterion, its story and feature, the pages and interactions it touches, the data entities, access rules, related code and conventions. Use this during a build instead of the whole-project blueprint. The pack carries a `spec_seq` (pass it to vibemap_submit_for_review) and an etag, so re-checking mid-build is cheap.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId"],
      properties: {
        criterionId: { type: "string", description: "Acceptance criterion UUID" },
        includeSource: {
          type: "boolean",
          description: "Include the source of related code (default false)",
        },
      },
    },
  },
  {
    name: "vibemap_get_execution_plan",
    description:
      "Get the build order for a project: acceptance criteria grouped by sprint in dependency order, each with its state (ready, blocked, passed, and so on). Use it once at the start of a build session to see the whole route. Pass releaseId to plan only one release's new and modified work.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["projectId"],
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        releaseId: {
          type: "string",
          description: "Optional release UUID; defaults to the project's active release",
        },
      },
    },
  },
  {
    name: "vibemap_rework_criterion",
    description:
      "Send a criterion that failed review back to ready so you can build it again. Only the agent that built it can do this. The failing review's feedback (the failed test names and notes) is attached to the event and is also in the evidence history, so read it before you start. Then claim the criterion again.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId"],
      properties: {
        criterionId: { type: "string" },
        plan: {
          type: "string",
          description: "Optional short note on how you will fix it (max 2000 chars)",
        },
      },
    },
  },
  {
    name: "vibemap_get_criterion_evidence",
    description:
      "Get the submission history of a criterion: every attempt with the files changed, the named tests and the verdict, newest first. Use it after a failure to see which tests failed.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId"],
      properties: {
        criterionId: { type: "string" },
        limit: { type: "number", description: "Max attempts to return (1-50, default 20)" },
      },
    },
  },
  {
    name: "vibemap_ask_user",
    description:
      "Ask the project's owner a question when the spec is unclear. This blocks the criterion (category spec_unclear) and shows the question on the board, with your suggested options if you give any. Keep working on other ready criteria while you wait, then call vibemap_get_answers to collect the reply; once a person answers, the criterion is unblocked automatically.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId", "question"],
      properties: {
        criterionId: { type: "string" },
        question: { type: "string", description: "The question (1-2000 chars)" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional suggested answers the person can pick from (1-10)",
        },
        reason: {
          type: "string",
          description: "Optional context for the block; defaults to the question",
        },
      },
    },
  },
  {
    name: "vibemap_get_answers",
    description:
      "Collect the answers to questions you asked with vibemap_ask_user. Returns each answer for the criterion, and `waiting: true` while a question is still open. Pass `since` (ISO timestamp, for example the time you asked) to return only answers given after it.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["criterionId"],
      properties: {
        criterionId: { type: "string" },
        since: {
          type: "string",
          description: "ISO timestamp; only answers given after this are returned",
        },
      },
    },
  },
  {
    name: "vibemap_get_spec_delta",
    description:
      "See what changed in the spec since a sequence number (the `spec_seq` in your context pack), and which criteria that affects. `requires_rebuild` lists affected criteria that are already in progress, in review or passed. If `has_more` is true, call again with sinceSeq set to the returned `to_seq`.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["projectId", "sinceSeq"],
      properties: {
        projectId: { type: "string" },
        sinceSeq: { type: "number", description: "Sequence number to compare against" },
        limit: { type: "number", description: "Max changesets to cover (1-200, default 50)" },
      },
    },
  },
  {
    name: "vibemap_get_release_work_list",
    description:
      "Get a release's work list grouped as `new`, `modified` and `removed`. Each item has its material field changes, the commit it was last built at and its code paths. For removed items the code paths are the files to delete. Needs a plan with release management.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["releaseId"],
      properties: { releaseId: { type: "string", description: "Release UUID" } },
    },
  },
  {
    name: "vibemap_get_release_diff",
    description:
      "Get the raw diff of a release against its baseline: every listed item with its baseline row and the material field changes. Use vibemap_get_release_work_list for the actionable version. Needs a plan with release management.",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: "object",
      required: ["releaseId"],
      properties: { releaseId: { type: "string", description: "Release UUID" } },
    },
  },
  {
    name: "vibemap_propose_spec_change",
    description:
      "Propose a change to the spec when the code has to differ from it (for example a field the spec missed). This stages the proposal; it does NOT edit the spec. The review screen for staged proposals is coming, so until it ships the owner will not see it in the app: also list it in your final summary. While building, always use this instead of the update_* tools. Give the entity, the content fields you want changed with their new values (only that entity's content fields are accepted: not status, ids, codes, assignment or sprint) and a short rationale; add evidence (a file path, test name or error) if you have it. An identical pending proposal is returned instead of duplicated; at most 10 per minute and 50 pending per project.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: "object",
      required: ["projectId", "entity", "entityId", "fields", "rationale"],
      properties: {
        projectId: { type: "string" },
        entity: {
          type: "string",
          enum: ["feature", "user_story", "acceptance_criterion", "page", "persona"],
        },
        entityId: { type: "string", description: "UUID of the entity to change" },
        fields: {
          type: "object",
          description:
            "Content field names mapped to the new values you propose (max 20). Allowed by entity: feature (name, description, priority, category, complexity, effort, business_value); user_story (title, description, i_want_to, so_that, user_role, priority, estimated_effort); acceptance_criterion (title, description, given_condition, when_action, then_outcome, scenario_category); page (name, description, path, page_type, layout_intent, api_endpoints, ui_states, state_requirements, priority); persona (name, tagline, user_role, narrative, avatar_description, demographics, psychographics, goals_and_needs, pain_points, product_specific, behavioral_patterns, communication_preferences, user_journey).",
        },
        rationale: { type: "string", description: "Why the spec should change (1-2000 chars)" },
        evidence: {
          type: "string",
          description: "Optional supporting detail: file path, test name, error text (max 2000 chars)",
        },
        criterionId: {
          type: "string",
          description: "Optional criterion you were building when you found this",
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
      "Submit a structural code map of the user's codebase to VibeMap (rendered on the project's Codebase tab). Build it yourself from your codebase access: one node per meaningful unit (page/route, API endpoint, data model, service, module, config), edges for imports/routes/reads/writes. Node kinds: page|api|model|service|module|config. Layers: ui|api|data|services|shared. Edge kinds: imports|routes|reads|writes. Use repo-relative paths as node ids. Max 500 nodes — aggregate small files into their module. Re-submitting replaces the project's map and resets it to draft for the user to re-confirm; any existing drift report is kept.",
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
      "Report codebase changes since the last sync so VibeMap can flag spec drift. Workflow: 1) call vibemap_get_code_map and read anchor.commitSha; 2) run `git diff --name-only <commitSha>..HEAD` (plus untracked files from `git status --porcelain`); 3) call this tool with the changed paths and your current HEAD sha. The response lists affected map units and features — update the stale specs with vibemap_update_feature / vibemap_update_user_story / vibemap_update_acceptance_criterion (all changeset-audited). The drift report stays on the project until the flagged items are resolved or dismissed in VibeMap; re-submitting the code map does not clear it. While you are building a ticket, send spec changes through vibemap_propose_spec_change rather than editing the spec.",
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
        diffExcerpt: {
          type: "string",
          description:
            "Optional excerpt of the diff (max 20000 chars), shown to the project owner beside the affected specs",
        },
      },
      required: ["projectId", "changedFiles"],
    },
  },

  // ── Group 6b: Import an existing codebase ──────────────────────────────
  // What leaves the machine is stated in every description: structural facts,
  // file paths and the spec text the agent writes, never file contents.
  {
    name: "vibemap_extract_repo_facts",
    description:
      "Read the repository on this machine and return its structural facts: database tables and their row-level security policies (from SQL migrations or a Prisma schema), Next.js routes, and clusters of related files per route. Runs locally with no network call and no model, and sends nothing to VibeMap. The same code always gives the same facts. Use each cluster's id and files when you write the spec for vibemap_import_semantic.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        localPath: {
          type: "string",
          description: "Absolute path to the repository (defaults to the directory the server runs in)",
        },
      },
    },
  },
  {
    name: "vibemap_import_facts",
    description:
      "Import this repository's structure into a VibeMap project. Extracts the facts locally, then sends only the facts: table, column, foreign-key, policy and route definitions with their file paths. File contents never leave your machine. VibeMap turns them into the schema, access rules and one page per route, each linked to its file, and records a structural map of the repository (file paths only) if the project has none yet. Re-running on unchanged code writes nothing. Available on Pro and higher plans.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project to import into" },
        localPath: {
          type: "string",
          description: "Absolute path to the repository (defaults to the directory the server runs in)",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_import_semantic",
    description:
      "Send the features, user stories and acceptance criteria you wrote for an imported repository. One feature per cluster (clusterId from vibemap_extract_repo_facts); every feature, story and criterion cites sourceFiles, which must be files listed in the facts. Only the spec text you write and those file paths are sent. Re-sending the same items updates them in place and never duplicates them. Call vibemap_import_facts first. Shape: features[{clusterId, name, description?, priority?, category?, complexity?, effort?, businessValue?, sourceFiles, stories[{slug?, userRole, iWantTo, soThat, description?, priority?, sourceFiles, acceptanceCriteria[{given, when, then, description?, elementLabel?, sourceFiles}]}]}].",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project id" },
        features: {
          type: "array",
          description: "Features to import (1-500), each with its stories and their criteria",
          items: { type: "object" },
        },
      },
      required: ["projectId", "features"],
    },
  },
  {
    name: "vibemap_finalize_import",
    description:
      "Finish an import. Every imported acceptance criterion becomes passed (unverified: no test has confirmed it yet), the result is locked as release MVP1, and MVP2 opens for new work. Criteria VibeMap flagged as hard to test stay in review instead. Calling it again reports the existing MVP1 and changes nothing. Sends only the project id.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "VibeMap project id" } },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_resync",
    description:
      "Bring an imported project up to date with the repository at its current commit. Extracts the facts locally and sends only the facts, so VibeMap applies the structural changes since the last import (added, changed and removed tables, policies and routes). It then reports the changed file paths, so specs whose code changed are flagged: a passed criterion whose files changed, or changed code that no spec covers, becomes a proposal the project owner reviews on the Codebase tab. Pass changedFiles (for example from `git diff --name-only <last synced commit>..HEAD`) to include edits that did not change the structure.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project id" },
        localPath: {
          type: "string",
          description: "Absolute path to the repository (defaults to the directory the server runs in)",
        },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Optional extra repo-relative paths changed since the last sync (max 2000)",
        },
        diffExcerpt: {
          type: "string",
          description: "Optional excerpt of the diff (max 20000 chars), shown beside the proposals",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_resolve_drift",
    description:
      "Clear reported code drift once it is handled: after you updated the affected specs, or decided they need no change. Name the files, code map units (nodeIds) or criteria (criterionIds) to clear. The project's sync point moves to the new commit only when no drift is left.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project id" },
        files: { type: "array", items: { type: "string" }, description: "Repo-relative paths" },
        nodeIds: { type: "array", items: { type: "string" }, description: "Code map unit ids" },
        criterionIds: { type: "array", items: { type: "string" }, description: "Criterion ids" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "vibemap_resolve_code_drift_proposal",
    description:
      "Apply or dismiss one staged code-drift proposal. Applying it on a passed criterion marks the criterion as possibly stale so it gets re-verified; dismissing it keeps the spec as it is. Either way the proposal's files are cleared from the drift report. The project owner normally decides this on the Codebase tab: only call it when the user asks you to.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "VibeMap project id" },
        proposalId: { type: "string", description: "The proposal's id (UUID)" },
        decision: { type: "string", enum: ["apply", "dismiss"] },
      },
      required: ["projectId", "proposalId", "decision"],
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
