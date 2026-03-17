import { describe, expect, it } from "vitest";
import {
  buildMemoryExtractionPrompt,
  parseExtractedMemories,
} from "../extensions/memory/src/extract.ts";

describe("memory extraction helpers", () => {
  it("parses extracted memories from json", () => {
    const parsed = parseExtractedMemories(`
      {
        "memories": [
          {
            "scope": "domain",
            "kind": "command",
            "text": "Use spacectl for Spacelift.",
            "confidence": 0.91
          },
          {
            "scope": "project",
            "kind": "workflow",
            "text": "We deploy via preview pipeline first.",
            "confidence": 1.2
          },
          {
            "scope": "invalid",
            "kind": "note",
            "text": "Should be ignored",
            "confidence": 0.9
          }
        ]
      }
    `);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ scope: "domain", kind: "command" });
    expect(parsed[1].confidence).toBe(1);
  });

  it("parses fenced json and drops invalid rows", () => {
    const parsed = parseExtractedMemories(`
      \`\`\`json
      {"memories":[
        {"scope":"project","kind":"note","text":"  ","confidence":0.6},
        {"scope":"user","kind":"preference","text":"Prefer concise updates.","confidence":0.88}
      ]}
      \`\`\`
    `);

    expect(parsed).toEqual([
      {
        scope: "user",
        kind: "preference",
        text: "Prefer concise updates.",
        confidence: 0.88,
      },
    ]);
  });

  it("builds extraction prompt with conversation block", () => {
    const prompt = buildMemoryExtractionPrompt({
      projectName: "lovelace",
      repoRoot: "/Users/alice/projects/lovelace",
      currentTaskRef: "PROJ-1",
      conversationText: "User: spacectl is the cli for spacelift",
    });

    expect(prompt).toContain("Return ONLY valid JSON");
    expect(prompt).toContain("Project: lovelace");
    expect(prompt).toContain("<conversation>");
    expect(prompt).toContain("spacectl is the cli for spacelift");
  });
});
