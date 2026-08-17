<!-- Installed from marketplace plugin: sdlc/pr-resolve -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: pr-resolve
description: Check if PR review comments have been addressed by code changes and offer to resolve them. The dual of full-pr-review.
argument-hint: "[<PR#>|<branch-name>]"
---

Check whether review comments on a PR have been addressed and help resolve them.

## Step 1: Identify the PR

Use `/bitbucket $ARGUMENTS` to identify the target PR. If no argument, list open PRs and ask which one.

## Step 2: Gather Context

1. From the PR metadata, note the source branch and target branch
2. Run `git fetch origin` then `git checkout <source_branch>` if not already on it
3. Call `list_pr_comments` to get all unresolved comments on the PR

## Step 3: Analyze Each Unresolved Comment

For each unresolved inline comment:
1. Read the comment text to understand what was requested
2. Check for **code changes**: has the commented file+line changed since the comment?
3. Check for **author replies**: does the comment thread have a reply from the PR author explaining or justifying the current code? (Use `list_pr_comments` reply data to find threaded responses)
4. Categorize as:
   - **Addressed (code change)** — the code change directly fixes what was asked
   - **Addressed (author replied)** — no code change, but the author replied with a justification or explanation (e.g., "this is intentional because...")
   - **Partially addressed** — related change but doesn't fully resolve the concern
   - **Not addressed** — no relevant code change and no author reply
   - **No longer applicable** — the code/file was removed or completely rewritten

## Step 4: Present Findings

Display a summary to the user:

```
## Comment Resolution Status: PR #123

### Addressed — Code Change (ready to resolve)
- [comment-id] path/to/file.scala:42 — "fix null check" → Fixed: added Option wrapper
- [comment-id] path/to/file.scala:78 — "add test" → Added test in FooSpec.scala

### Addressed — Author Replied (ready to resolve)
- [comment-id] path/to/config.scala:30 — "why not use env var?" → Author: "intentional — this is a compile-time constant"

### Partially Addressed
- [comment-id] path/to/api.go:15 — "validate input" → Added nil check but no range validation

### Not Addressed
- [comment-id] path/to/handler.java:90 — "handle timeout case" → No changes to this code, no reply

### No Longer Applicable
- [comment-id] path/to/old.py:12 — file deleted
```

## Step 5: Resolve Comments

Ask the user which comments to resolve. Options:
- Resolve all **Addressed** comments (both code changes and author replies)
- Resolve all **Addressed** + **No longer applicable** comments
- Pick individually
- Skip (don't resolve any)

For each comment to resolve:
1. If addressed by code change: reply with a brief note on how it was fixed (e.g., "Fixed — added Option wrapper in commit abc123")
2. If addressed by author reply: reply acknowledging the explanation (e.g., "Acknowledged — makes sense, resolving")
3. Call `resolve_comment` to mark it resolved

For **Partially addressed** comments, offer to reply with what was done and ask the original reviewer for clarification.
