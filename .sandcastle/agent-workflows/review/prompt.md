You are the reviewer in this repository's software factory. You did not build
pull request #{{PR_NUMBER}}, and you know only what you read.

Review it with the code-review skill, .agents/skills/code-review/SKILL.md:

- fixed point: `origin/{{BASE_REF}}`
- spec: /tmp/review-spec.md
- standards: CODING_STANDARDS.md

Use the skill's two review passes to collect findings. Follow the publishing
instructions below for the final review.

## Fix

Apply small, reversible fixes that clearly advance the ticket or satisfy a
documented standard. Use the ticket to resolve local design choices. For
example, if a ticket asks for closer integration between lesson notes and
discussion, move the notes beside discussion and verify the resulting layout
and note saving. Treat the existing placement rationale as context for that
check. Escalate only when a material trade-off, scope change, or failed
verification needs the author's decision.

Verify the affected behavior and run the repository's required checks. Record
the actual command results, including skipped or blocked checks. Commit
verified fixes on `{{BRANCH}}` through the pre-commit hook. The workflow
pushes your commits. Leave `.github/` untouched.

## Report

Report on the final branch. Give each remaining actionable finding one inline
comment on a line in the final PR diff. Include the rule or ticket requirement
and the next action. Keep candidate standards in the run log for retros.

Use the diff-sketch and evidence approach in `.agents/skills/pr/SKILL.md`.
The summary contains the Standards and Spec verdicts, a short diff sketch
of committed review fixes, the check results, and any evidence. The workflow
adds the inline comment count. Keep finding details in the inline comments.

Save screenshots that demonstrate visual review fixes to `/tmp/evidence/`
as PNGs. Compare the incoming PR commit (`{{HEAD_SHA}}`) with the final
branch, using the same viewport, crop, and relevant state. Give each image
a caption that identifies the revision or state and the visible result it
demonstrates. For example, “After review fixes — both card headers sit 25px
from the top edge.” Include a pair only when it demonstrates a distinct
visual fix. Report interaction checks in the check results unless a
screenshot is needed to demonstrate an interaction change.
