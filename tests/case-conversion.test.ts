import { describe, expect, it } from "vitest";
import { camelToSnake, camelToSnakeDeep } from "../src/utils";

describe("camelToSnake", () => {
  it("converts camelCase to snake_case", () => {
    expect(camelToSnake("primaryObjectives")).toBe("primary_objectives");
    expect(camelToSnake("projectId")).toBe("project_id");
    expect(camelToSnake("ageRange")).toBe("age_range");
  });

  it("leaves already-lowercase keys unchanged", () => {
    expect(camelToSnake("name")).toBe("name");
    expect(camelToSnake("values")).toBe("values");
  });
});

describe("camelToSnakeDeep", () => {
  it("converts nested object keys", () => {
    const input = {
      projectId: "p1",
      goalsAndNeeds: { primaryObjectives: ["a"], problemsToSolve: ["b"] },
    };
    expect(camelToSnakeDeep(input)).toEqual({
      project_id: "p1",
      goals_and_needs: { primary_objectives: ["a"], problems_to_solve: ["b"] },
    });
  });

  it("preserves primitive values including strings inside arrays", () => {
    const input = { psychographics: { values: ["Speed", "QualityFirst"] } };
    // Array string values must NOT be case-converted — only keys are.
    expect(camelToSnakeDeep(input)).toEqual({
      psychographics: { values: ["Speed", "QualityFirst"] },
    });
  });

  it("recurses into objects nested inside arrays", () => {
    const input = { items: [{ fooBar: 1 }, { bazQux: 2 }] };
    expect(camelToSnakeDeep(input)).toEqual({
      items: [{ foo_bar: 1 }, { baz_qux: 2 }],
    });
  });

  it("passes through null and primitives", () => {
    expect(camelToSnakeDeep(null)).toBeNull();
    expect(camelToSnakeDeep("aString")).toBe("aString");
    expect(camelToSnakeDeep(42)).toBe(42);
  });
});
