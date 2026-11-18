import { z } from "zod/v4";

const verdict = z.enum(["PASS", "CHANGES REQUESTED"]);
const shortLine = z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/);

export const reviewSchema = z
  .strictObject({
    standards: verdict,
    spec: z.enum(["PASS", "CHANGES REQUESTED", "NO SPEC AVAILABLE"]),
    fixes: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullable()
      .describe(
        "A short plain-text diff sketch of the committed review fixes, without code fences. Null when no fixes were committed."
      ),
    checks: shortLine.describe(
      "One line with actual verification results, including checks that were skipped or blocked."
    ),
    evidence: z
      .array(
        z.strictObject({
          filename: z
            .string()
            .regex(/^[a-zA-Z0-9_-]+\.png$/)
            .describe(
              "The PNG filename in /tmp/evidence, without its directory."
            ),
          caption: shortLine.describe(
            "Name the revision or state and the visible result this screenshot demonstrates."
          ),
        })
      )
      .max(4)
      .describe(
        "Up to two before-and-after pairs demonstrating visual review fixes, in reading order."
      ),
    comments: z
      .array(
        z.strictObject({
          path: z
            .string()
            .min(1)
            .describe("The file, relative to the repository root."),
          line: z
            .number()
            .int()
            .positive()
            .describe(
              "A line in the file as it is now, inside a hunk of the diff against the base. A comment outside the hunks is dropped."
            ),
          body: z
            .string()
            .min(1)
            .describe(
              "The finding, in Markdown: the rule or spec line it breaks, and what to do instead."
            ),
        })
      )
      .describe("One entry per finding you left unfixed. Empty is fine."),
  })
  .describe("The review's compact summary and inline comments.");
