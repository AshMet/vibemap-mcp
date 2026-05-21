import { describe, expect, it } from "vitest";
import { formatPageSourceResponse } from "../src/page-source";

describe("formatPageSourceResponse", () => {
  it("shapes page metadata and section sources", () => {
    const out = formatPageSourceResponse(
      {
        id: "pg1",
        name: "Dashboard",
        path: "/dashboard",
        source_code: "export default function Page() {}",
        project_id: "proj-1",
      },
      [
        { id: "sec1", name: "Header", source_code: "<header/>" },
        { id: "sec2", name: "Body", source_code: "<main/>" },
      ]
    );

    expect(out.page).toEqual({
      id: "pg1",
      name: "Dashboard",
      path: "/dashboard",
      source_code: "export default function Page() {}",
    });
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0]).toEqual({
      id: "sec1",
      name: "Header",
      source_code: "<header/>",
    });
  });

  it("defaults to an empty sections array", () => {
    const out = formatPageSourceResponse({ id: "pg1", name: "X", path: "/x", source_code: "y" });
    expect(out.sections).toEqual([]);
  });

  it("coerces missing/non-string fields to null", () => {
    const out = formatPageSourceResponse({ id: "pg1" }, [
      { id: 123, name: undefined, source_code: null },
    ]);

    expect(out.page.name).toBeNull();
    expect(out.page.path).toBeNull();
    expect(out.page.source_code).toBeNull();
    expect(out.sections[0]).toEqual({ id: null, name: null, source_code: null });
  });

  it("tolerates a null sections argument", () => {
    const out = formatPageSourceResponse(
      { id: "pg1", name: "X", path: "/x", source_code: "y" },
      null as unknown as unknown[]
    );
    expect(out.sections).toEqual([]);
  });
});
