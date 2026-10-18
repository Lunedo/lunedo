import { describe, expect, it } from "vitest";
import {
  isDiagramReply,
  isDiagramRequest,
  renderedProblem,
  sourceProblem,
  svgSize,
  syntaxProblem,
} from "./protocol.js";

describe("text diagram protocol", () => {
  it("refuses PlantUML sources that read files, addresses or the environment", () => {
    for (const line of [
      "!include https://evil.example/a.puml",
      "  !includeurl http://intranet/x",
      "!include_many /etc/passwd",
      "!includesub common.puml!PART",
      "!import lib",
      "!theme cerulean from https://evil.example/themes",
      '!$data = %load_json("http://evil.example/data.json")',
      'Alice -> Bob : %getenv("HOME")',
      '!if %file_exists("/etc/passwd")',
    ]) {
      expect(sourceProblem("plantuml", `@startuml\n${line}\n@enduml`), line).not.toBeNull();
    }
    expect(
      sourceProblem("plantuml", "@startuml\n!theme cerulean\nAlice -> Bob: include me\n@enduml"),
    ).toBeNull();
    expect(sourceProblem("mermaid", "%% !include x")).toBeNull();
  });

  it("refuses images that are too large or use HTML labels", () => {
    expect(renderedProblem('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>')).toBeNull();
    expect(renderedProblem('<svg width="30000" height="10"/>')).toBe("tooLarge");
    expect(renderedProblem('<svg viewBox="0 0 10 25000"/>')).toBe("tooLarge");
    expect(renderedProblem(`<svg>${"x".repeat(2 * 1024 * 1024)}</svg>`)).toBe("tooLarge");
    expect(renderedProblem("<svg><foreignObject/></svg>")).toBe("htmlLabels");
    expect(svgSize('<svg width="100%" viewBox="0 0 357.5 65">')).toEqual({ width: 357.5, height: 65 });
  });

  it("accepts only well-formed messages", () => {
    expect(isDiagramRequest({ type: "render", id: 1, diagram: "mermaid", source: "graph TD" })).toBe(true);
    expect(isDiagramRequest({ type: "render", id: 1, diagram: "drawio", source: "" })).toBe(false);
    expect(isDiagramRequest({ type: "render", id: "1", diagram: "mermaid", source: "" })).toBe(false);
    expect(isDiagramReply({ type: "ready" })).toBe(true);
    expect(isDiagramReply({ type: "rendered", id: 2, svg: "<svg/>" })).toBe(true);
    expect(isDiagramReply({ type: "failed", id: 2, reason: "syntax", detail: "" })).toBe(true);
    expect(isDiagramReply({ type: "rendered", svg: "<svg/>" })).toBe(false);
    expect(isDiagramReply(null)).toBe(false);
  });
});

describe("diagram syntax errors", () => {
  it("name the line of the person's own source, never past its end", () => {
    const source = "flowchart LR\nA[Start] --> B[Done\nB -->\n";
    const parser = Object.assign(
      new Error("Parse error on line 4:\n...B -->\n------^\nExpecting 'SQE', 'PE'"),
      {
        hash: { loc: { first_line: 4 } },
      },
    );
    expect(syntaxProblem("mermaid", source, parser).line).toBe(3);
    expect(
      syntaxProblem(
        "mermaid",
        "---\ntitle: Plan\n---\nflowchart LR\nA -->",
        new Error("Parse error on line 2"),
      ).line,
    ).toBe(5);
    expect(syntaxProblem("mermaid", "pie", new Error("Something odd")).line).toBeNull();
  });

  it("remove PlantUML placeholders and headers from the details", () => {
    const message = [
      "PlantUML version $version$",
      "$git.commit.id$",
      "[Unknown compile time]",
      "[From textarea (line 3)]",
      "",
      "Syntax Error? (Assumed diagram type: sequence)",
    ].join("\n");
    const problem = syntaxProblem(
      "plantuml",
      "@startuml\nAlice -> Bob\nthis is wrong\n@enduml",
      new Error(message),
    );
    expect(problem.line).toBe(3);
    expect(problem.detail).toBe("Syntax Error? (Assumed diagram type: sequence)");
    expect(problem.detail).not.toMatch(/\$/);
  });
});
