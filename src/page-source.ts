// Pure response-shaping helpers for the get_page_source MCP tool.
// Kept free of I/O so they can be unit-tested without the Supabase/HTTP layer.

export interface PageRecord {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  source_code?: unknown;
  project_id?: unknown;
  relationships?: { sections?: unknown[] } | null;
  [key: string]: unknown;
}

export interface SectionSource {
  id: string | null;
  name: string | null;
  source_code: string | null;
}

export interface PageSourceResponse {
  page: {
    id: string | null;
    name: string | null;
    path: string | null;
    source_code: string | null;
  };
  sections: SectionSource[];
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Shape a raw page record (as returned by GET /api/crud/pages with
 * includeRelationships=true) into the export-friendly response: the page's own
 * metadata + source_code, plus one entry per section with its source_code.
 */
export function formatPageSourceResponse(
  page: PageRecord,
  sections: unknown[] = []
): PageSourceResponse {
  const sectionList = (sections ?? []).map((raw): SectionSource => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return {
      id: asStringOrNull(s.id),
      name: asStringOrNull(s.name),
      source_code: asStringOrNull(s.source_code),
    };
  });

  return {
    page: {
      id: asStringOrNull(page.id),
      name: asStringOrNull(page.name),
      path: asStringOrNull(page.path),
      source_code: asStringOrNull(page.source_code),
    },
    sections: sectionList,
  };
}
