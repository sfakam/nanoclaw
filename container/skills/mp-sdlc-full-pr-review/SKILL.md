<!-- Installed from marketplace plugin: sdlc/full-pr-review -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: full-pr-review
description: Full PR review — code review + Bitbucket comments + Jira ticket cross-check. Orchestrates bitbucket, code-analyst, and jira-ticket-review skills.
argument-hint: "[list|list mine|<PR#>|<branch-name>]"
---

Perform a comprehensive pull request review. This orchestrates multiple skills — use them rather than reimplementing their logic.

## Tool usage policy

**Always use MCP tools** (`get_pr`, `get_pr_diff`, `get_pr_files`, `list_pr_comments`, `post_inline_comment`, `post_pr_comment`, `find_prs_by_reviewer`, etc.) for all Bitbucket operations. Fall back to `curl` only if an MCP call fails with a connection or transport error — never as a default or because it's more convenient. This applies equally in interactive sessions and when running as a background agent.

## Step 1: Identify the PR

Use `/bitbucket $ARGUMENTS` to identify the target PR. If no argument, list open PRs and ask which to review.

To find PRs where the current user is listed as reviewer across all repos, use `find_prs_by_reviewer` (Bitbucket Server only).

## Step 2: Check for Prior Review

Use `list_pr_comments` to fetch all comments on the PR. Look for a general (non-inline) comment containing the marker `<!-- claude-review -->`. This marker is added by Step 7 when a review completes.

If found:
- Extract the reviewer name and timestamp from the comment
- Show to the user: "This PR was already reviewed by **[name]** on [date]. [N] inline comments were posted."
- Ask: "Run another review anyway?" — wait for confirmation before proceeding
- If the user confirms: **re-call `get_pr` before proceeding** — the branch may have been pushed to since the initial fetch. Use the freshly returned `fromRef.latestCommit` for all subsequent diff and file fetches.

If not found, proceed normally.

## Step 2.5: Collect Other Reviewer Comments

Using the comments already fetched in Step 2, scan for comments from reviewers who are **not** the PR author and **not** Claude Code (i.e. not posted by the authenticated user running this review).

For each such comment:
- Note the reviewer's display name
- Note the comment text (truncate to one line for the summary)
- Cross-reference the diff from Step 3 to determine whether the issue raised appears to have been addressed in the current state of the PR
  - ✅ **Fixed** — the diff or current file state shows the change was made
  - ⏳ **Still open** — no corresponding change found in the diff
  - ❓ **Cannot determine** — the comment is a question or too ambiguous to assess from the diff alone

Group the results by reviewer. This data is used in Step 7 to populate the "Prior review items" table.

If there are no comments from other reviewers, skip this section.

## Step 3: Checkout & Gather Context

1. From the PR metadata, note the source branch, target branch, title, and description
2. Sync branches before diffing:
   - Run `git fetch origin` to get latest remote state
   - Update the local target branch: `git branch -f <target_branch> origin/<target_branch>` (ensures the local target matches remote, avoiding stale diffs)
   - Then `git checkout <source_branch>` if not already on it
3. Try to extract a Jira ticket from the branch name (patterns: `prefix/PLX-123`, `PLX-123-desc`)

## Step 4: Code Review

Use `/code-analyst <target_branch>` to perform the phased analysis. Collect all findings.

## Step 5: Jira Cross-check (if ticket found)

If a Jira ticket was extracted, use `/jira-ticket-review <PLX-123>` to:
- Pull ticket context (acceptance criteria, description)
- Check if the code changes address the acceptance criteria
- Identify gaps in either direction
- Suggest test cases
- **Check ticket status**: a ticket with an open PR should be in a review state (e.g., "Code Review", "In Review"). If the ticket is still in "Open", "To Do", or "In Progress", flag this to the reviewer and offer to transition it to the correct state via `/jira`

## Step 5.5: Load Suppression Rules

Before posting any findings, check if `.review_instructions.md` exists in the repo root:
- If a local checkout is available: read the file from disk
- Otherwise: use `get_file_content` to fetch it from the PR source branch (ref: the source branch `fromRef.displayId`)

If the file exists, parse it and extract all suppressed topics, files, and patterns (look for "Do Not Flag" sections or equivalent headings). Build a suppression list to use in Step 6.

**Important:** if `.review_instructions.md` does not exist, skip this step and proceed normally.

## Step 6: Post Findings to Bitbucket

**Before posting each finding, check it against the suppression list from Step 5.5.**
- If the finding's file, topic, or description matches a suppressed rule: **skip it entirely** — do not post it, do not resolve it, do not mention it in inline comments
- Suppressed findings should only appear in the review summary (Step 7/8) as a suppressed count, not as Bitbucket comments
- The goal is: suppressed findings must never touch Bitbucket at all

For each non-suppressed finding, call `post_inline_comment` on the specific file and line:

```
[severity] Category — Description

<explanation with context>

Suggested fix: <concrete recommendation>

---
*Reviewed by Claude Code ([model])*
```

**The attribution footer is mandatory on every inline comment — no exceptions.** It must appear as the last line, separated from the finding body by a horizontal rule (`---`). Replace `[model]` with the actual model powering the current session (e.g., `claude-opus-4-6`, `claude-sonnet-4-6`) — do not hardcode a model name.

Post findings as you go — do not batch. Confirmation rules:
- `[suggestion]`, `[nit]`, `[question]` → post automatically
- `[critical]`, `[warning]` → show the finding to the user and ask for confirmation before posting

## Step 7: Post Review Marker

After all inline comments are posted, use `post_pr_comment` to post a general PR comment with the review summary and marker.

Always use the following table-based format for the summary comment. Every section that has rows must be a table — never use inline lists or pipe-separated text for findings.

**If this is a re-review** (prior `<!-- claude-review -->` comment existed), include the "Prior Claude review items" table. Omit it on first review. Always include the "Prior review items" table for each other reviewer if Step 2.5 found any comments, regardless of whether this is a first or re-review.

```
**Code Review Summary — [PR title]**

**Prior Claude review items:** (re-review only — omit entire section on first review)

| Prior issue | Status |
|-------------|--------|
| 🔴 Description of fixed critical | ✅ Fixed |
| 🟡 Description of fixed warning | ✅ Fixed |
| 🔵 Description of fixed nit | ✅ Fixed |

**Prior review items — [Reviewer Name]:** (one table per reviewer from Step 2.5 — omit entire section if no other reviewer comments)

| Prior issue | Status |
|-------------|--------|
| One-line summary of their comment | ✅ Fixed |
| One-line summary of their comment | ⏳ Still open |
| One-line summary of their comment | ❓ Cannot determine |

**Suppressed per `.review_instructions.md`:** (omit entire section if 0)

| Finding | Reason |
|---------|--------|
| 🔴 Description | One-line reason from the instructions file |

**Open findings:**

| Severity | File | Issue |
|----------|------|-------|
| 🔴 Critical | `path/to/file.go:42` | Short description |
| 🟡 Medium | `path/to/file.go:99` | Short description |

- Findings: X critical, Y warning, Z suggestion, W nit
- Suppressed: N findings skipped per `.review_instructions.md` (omit this line if 0)
- Jira: PLX-123 (coverage: complete/partial/gaps found)
- Reviewed by: [user's name or "Claude Code"]

<!-- claude-review -->
```

This marker allows future `/full-pr-review` runs to detect that a review has already been performed.

## Step 8: Summary for Reviewer

Display a summary to the user (do NOT post this to Bitbucket — the marker comment above is the only general comment):

- What the PR does (one sentence)
- Jira ticket link if found
- Finding count by severity
- Ticket coverage gaps (from jira-ticket-review, if applicable)
- Test coverage summary (from code-analyst Phase D):
  - Tests included in the PR
  - Missing unit/integration tests
  - Suggested test cases (merge suggestions from both code-analyst and jira-ticket-review, deduplicate)
- Overall assessment

Then ask the user if they want to set a verdict:
- Any critical findings    → `request_changes`
- Any warning findings     → `request_changes`
- Nits or suggestions only → `approve_pr`
- No findings              → `approve_pr`
- User can also choose to skip the verdict entirely
