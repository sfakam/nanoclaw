<!-- Installed from marketplace plugin: sdlc/bitbucket -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: bitbucket
description: Interact with Bitbucket pull requests. Use when you need to list, inspect, comment on, or review PRs.
argument-hint: "[list|list mine|<PR#>|<branch-name>]"
user-invocable: false
---

Interact with Bitbucket using the Bitbucket MCP tools. If the MCP server is unavailable, fall back to direct `curl` calls as described in the **Fallback** section below.

## Setup

Detect the Bitbucket project and repo from `git remote -v`. Parse the URL to extract project key and repo slug. If detection fails, check CLAUDE.md for Bitbucket project/repo config.

## Arguments

Arguments: $ARGUMENTS

Parse the arguments:
- If empty or "list" → call `list_prs` to show open PRs
- If "list mine" → call `list_prs` filtered by current user
- If a number (e.g., "123") → call `get_pr` to show PR details
- If text (e.g., "feature/my-thing") → call `list_prs`, find PR whose source branch matches

## Available Operations

**Always use MCP tools first.** Fall back to `curl` only if the MCP server returns a connection error or is explicitly unavailable.

You have access to these Bitbucket MCP tools:
- `list_prs` — list pull requests in a repo (filterable by state, author)
- `find_prs_by_reviewer` — find all open PRs across all repos where the authenticated user is a reviewer (Bitbucket Server only; uses the dashboard API)
- `get_pr` — get PR details (title, description, reviewers, branches)
- `get_pr_diff` — get full diff via API (use local git when possible)
- `get_pr_files` — list changed files
- `get_file_content` — read file at a specific branch/commit
- `post_inline_comment` — comment on specific file+line
- `post_pr_comment` — general PR-level comment
- `reply_to_comment` — reply to existing thread
- `list_pr_comments` — list all comments (inline + general, with resolved status)
- `resolve_comment` — mark a comment as resolved
- `approve_pr` — approve a PR
- `request_changes` — mark as needs work
- `unapprove_pr` — remove approval

Prefer local git operations over API calls when the branch is checked out.

## Fallback (MCP unavailable)

**Only use this section if an MCP tool call fails with a connection/transport error.** Do not reach for `curl` because it seems simpler or because you are running as a background agent — MCP tools work in all Claude Code execution contexts.

If the Bitbucket MCP server is not present in the session, use `curl` with mTLS client certificates:

```bash
CERT=~/.certs/$USER.crt
KEY=~/.certs/$USER.key
CA=~/.certs/akamai_ca_list.pem
BASE=https://api.git.source.akamai.com/rest/api/1.0/projects/NS/repos/<REPO>
```

> All repos are in project key `NS`.

### Read operations

```bash
# PR metadata
curl -s --cert $CERT --key $KEY --cacert $CA "$BASE/pull-requests/<PR_NUMBER>"

# PR diff (paginate with ?start=N if truncated)
curl -s --cert $CERT --key $KEY --cacert $CA "$BASE/pull-requests/<PR_NUMBER>/diff"
```

For large PRs, prefer fetching the diff via git:

```bash
git fetch origin "refs/pull-requests/<PR_NUMBER>/from:refs/remotes/pr/<PR_NUMBER>"
git diff origin/master...pr/<PR_NUMBER> -- . ':(exclude)vendor'
```

### Write operations

Write comment payloads to a temp file to avoid shell escaping issues with complex markdown:

```bash
cat > /tmp/payload.json <<'EOF'
{
  "text": "<comment markdown>",
  "anchor": {
    "line": <line_number>,
    "lineType": "<ADDED|REMOVED|CONTEXT>",
    "fileType": "TO",
    "path": "<file/path>"
  }
}
EOF

curl -s --cert $CERT --key $KEY --cacert $CA \
  -X POST -H "Content-Type: application/json" \
  -d @/tmp/payload.json \
  "$BASE/pull-requests/<PR_NUMBER>/comments"
```

Use `"lineType": "ADDED"` for `+` lines, `"lineType": "REMOVED"` for `-` lines, `"lineType": "CONTEXT"` for unchanged lines.

Always verify the response contains `"id":` — errors return `{"errors": [...]}` instead.
