import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import type { z } from "zod/v4";
import { claudeAgent, outputDir, required, writeJson } from "../shared/common";
import { extractionPrompt } from "../shared/extraction-prompt";
import { runWithExtraction } from "../shared/run-with-extraction";
import { diffLines } from "./diff-lines";
import { reviewSchema } from "./review-schema";

const BASE_REF = required("BASE_REF");
const HEAD_SHA = required("HEAD_SHA");

const result = await runWithExtraction({
  name: "review",
  agent: claudeAgent(),
  sandbox: noSandbox(),
  logging: { type: "stdout" },
  promptFile: path.join(import.meta.dirname, "prompt.md"),
  promptArgs: {
    PR_NUMBER: required("PR_NUMBER"),
    BRANCH: required("BRANCH"),
    BASE_REF,
    HEAD_SHA,
  },
  output: sandcastle.Output.object({ tag: "review", schema: reviewSchema }),
  extractionPrompt: extractionPrompt("review", reviewSchema),
});

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// The diff after the agent's commits: the comments land on that.
const hunks = diffLines(git("diff", `origin/${BASE_REF}...HEAD`));
const {
  standards,
  spec,
  fixes,
  checks,
  evidence,
  comments: found,
}: z.infer<typeof reviewSchema> = result.output;
const commitId = git("rev-parse", "HEAD").trim();
const hasFixes = commitId !== HEAD_SHA;
const comments = found.filter(({ path: file, line }) => {
  if (hunks.get(file)?.has(line)) return true;
  console.error(`Dropping the comment on ${file}:${line}: not in the diff.`);
  return false;
});

// The request body for POST /repos/{owner}/{repo}/pulls/{n}/reviews.
writeJson("review-comments.json", {
  commit_id: commitId,
  event: "COMMENT",
  body: "Inline findings",
  comments: comments.map((comment) => ({ ...comment, side: "RIGHT" })),
});

const summary = [
  `**Standards** ${standards} · **Spec** ${spec} · **Inline comments** ${comments.length}`,
  "",
  `**Checks** ${checks}`,
];

if (hasFixes) {
  if (!fixes) throw new Error("The review committed fixes without a diff sketch.");
  summary.push("", "### Review fixes", "", "```diff", fixes, "```");
} else {
  summary.push("", "No review fixes committed.");
}

if (hasFixes && evidence.length > 0) {
  const evidenceDir = path.join(outputDir(), "review-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  summary.push("", "### Evidence");

  for (const { filename, caption } of evidence) {
    const screenshot = path.join(evidenceDir, filename);
    copyFileSync(path.join("/tmp/evidence", filename), screenshot);
    summary.push("", caption, "", `![Review evidence](${screenshot})`);
  }
}

writeFileSync(
  path.join(outputDir(), "review-summary.md"),
  summary.join("\n") + "\n"
);
