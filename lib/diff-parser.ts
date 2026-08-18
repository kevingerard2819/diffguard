import type { DiffFile, DiffLine } from "@/lib/domain";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
export const MAX_DIFF_BYTES = 500_000;
export const MAX_CHANGED_FILES = 50;

export function validateDiffEnvelope(input: string): void {
  if (!input.trim()) throw new Error("The diff is empty.");
  if (new TextEncoder().encode(input).byteLength > MAX_DIFF_BYTES) {
    throw new Error("This diff is larger than the 500 KB MVP limit.");
  }
  const fileCount = input.split(/\r?\n/).filter((line) => line.startsWith("diff --git ")).length;
  if (fileCount > MAX_CHANGED_FILES) {
    throw new Error(`This diff changes more than the ${MAX_CHANGED_FILES}-file MVP limit.`);
  }
  if (/^(?:GIT binary patch|Binary files .+ differ)$/m.test(input)) {
    throw new Error("Binary diffs are not supported. Review the text changes separately.");
  }
}

function cleanPath(value: string): string {
  const path = value.trim().split("\t")[0];
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

export function parseUnifiedDiff(input: string): DiffFile[] {
  validateDiffEnvelope(input);
  const text = input.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!text.includes("diff --git ")) {
    throw new Error("Expected a unified Git diff beginning with 'diff --git'.");
  }

  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffFile["hunks"][number] | null = null;
  let oldLine = 0;
  let newLine = 0;
  let fileIndex = -1;
  let hunkIndex = -1;
  let lineIndex = 0;

  for (const rawLine of text.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(rawLine);
      if (!match) continue;
      fileIndex += 1;
      hunkIndex = -1;
      currentFile = {
        oldPath: match[1],
        newPath: match[2],
        path: match[2],
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;
    if (rawLine.startsWith("--- ")) {
      currentFile.oldPath = cleanPath(rawLine.slice(4));
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      currentFile.newPath = cleanPath(rawLine.slice(4));
      currentFile.path =
        currentFile.newPath === "/dev/null" ? currentFile.oldPath : currentFile.newPath;
      continue;
    }

    const header = HUNK_HEADER.exec(rawLine);
    if (header) {
      hunkIndex += 1;
      lineIndex = 0;
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      currentHunk = { header: rawLine, lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || rawLine.startsWith("\\ No newline")) continue;
    const marker = rawLine[0];
    if (marker !== "+" && marker !== "-" && marker !== " ") continue;

    const kind: DiffLine["kind"] =
      marker === "+" ? "added" : marker === "-" ? "removed" : "context";
    currentHunk.lines.push({
      id: `DG-F${fileIndex + 1}-H${hunkIndex + 1}-L${lineIndex + 1}`,
      kind,
      content: rawLine.slice(1),
      oldLine: kind === "added" ? null : oldLine,
      newLine: kind === "removed" ? null : newLine,
      filePath: currentFile.path,
    });
    lineIndex += 1;

    if (kind === "added") {
      currentFile.additions += 1;
      newLine += 1;
    } else if (kind === "removed") {
      currentFile.deletions += 1;
      oldLine += 1;
    } else {
      oldLine += 1;
      newLine += 1;
    }
  }

  const parsed = files.filter((file) => file.hunks.length > 0);
  if (parsed.length === 0) throw new Error("The diff did not contain any parseable hunks.");
  return parsed;
}

export function flattenTrustedLines(files: DiffFile[]): DiffLine[] {
  return files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines));
}
