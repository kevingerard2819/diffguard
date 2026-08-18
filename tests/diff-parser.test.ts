import { describe, expect, it } from "vitest";
import {
  flattenTrustedLines,
  MAX_DIFF_BYTES,
  parseUnifiedDiff,
} from "@/lib/diff-parser";
import { DEMO_DIFF } from "@/lib/fixtures";

describe("parseUnifiedDiff", () => {
  it("assigns stable trusted IDs and tracks both sides of the hunk", () => {
    const files = parseUnifiedDiff(DEMO_DIFF);
    const lines = flattenTrustedLines(files);
    expect(files).toHaveLength(2);
    expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
    expect(lines[0].id).toBe("DG-F1-H1-L1");
    expect(files[0]).toMatchObject({ path: "src/api/invoices.ts", additions: 4, deletions: 1 });
    expect(lines.find((line) => line.content.includes("SELECT"))).toMatchObject({
      kind: "added",
      newLine: 31,
      oldLine: null,
    });
  });

  it("rejects text that is not a unified Git diff", () => {
    expect(() => parseUnifiedDiff("const safe = true;")).toThrow(/unified Git diff/);
  });

  it("tracks stable IDs across multiple hunks", () => {
    const files = parseUnifiedDiff(`diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1,2 +1,2 @@
-const one = 1;
+const one = 2;
 const keep = true;
@@ -10 +10,2 @@
 export const end = true;
+export const extra = true;`);
    expect(files[0].hunks).toHaveLength(2);
    expect(files[0].hunks[1].lines[0].id).toBe("DG-F1-H2-L1");
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
  });

  it("handles renamed and deleted files", () => {
    const files = parseUnifiedDiff(`diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-export const oldName = true;
+export const newName = true;
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const gone = true;`);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ oldPath: "old.ts", newPath: "new.ts", path: "new.ts" });
    expect(files[1]).toMatchObject({ newPath: "/dev/null", path: "gone.ts", deletions: 1 });
  });

  it("ignores missing-newline markers and keeps diff-like source text", () => {
    const files = parseUnifiedDiff(`diff --git a/example.txt b/example.txt
--- a/example.txt
+++ b/example.txt
@@ -1 +1,2 @@
 context
+diff --git is text inside the changed file
\\ No newline at end of file`);
    const lines = flattenTrustedLines(files);
    expect(lines.some((line) => line.content === "diff --git is text inside the changed file")).toBe(true);
    expect(lines.some((line) => line.content.includes("No newline"))).toBe(false);
  });

  it("rejects empty, binary, oversized, and excessive-file inputs", () => {
    expect(() => parseUnifiedDiff("   ")).toThrow(/empty/i);
    expect(() => parseUnifiedDiff(`diff --git a/logo.png b/logo.png
new file mode 100644
GIT binary patch`)).toThrow(/binary/i);
    expect(() => parseUnifiedDiff(`diff --git a/a.ts b/a.ts\n${"x".repeat(MAX_DIFF_BYTES)}`))
      .toThrow(/500 KB/);

    const tooManyFiles = Array.from({ length: 51 }, (_, index) =>
      `diff --git a/f${index}.ts b/f${index}.ts\n--- a/f${index}.ts\n+++ b/f${index}.ts\n@@ -1 +1 @@\n-old\n+new`,
    ).join("\n");
    expect(() => parseUnifiedDiff(tooManyFiles)).toThrow(/50-file/);
  });
});
