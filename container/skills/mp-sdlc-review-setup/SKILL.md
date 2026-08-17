<!-- Installed from marketplace plugin: sdlc/review-setup -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: review-setup
description: Bootstrap a repo for automatic pre-push code review via Claude CLI. Creates config and installs git hook.
argument-hint: "[init|status|remove]"
---

Set up automatic code review on `git push` for the current repository. Installs a pre-push hook that reviews diffs via `claude -p` in headless mode.

## Step 1: Parse Command

- `init` (default): set up review hook
- `status`: show current config and hook status
- `remove`: remove hook and config

If `$ARGUMENTS` is `status`, skip to **Status Check**.
If `$ARGUMENTS` is `remove`, skip to **Remove**.

## Step 2: Prerequisite Check

Verify required tools:

```bash
command -v claude && claude --version
command -v jq && jq --version
```

If either is missing, tell the user what to install and stop.

## Step 3: Detect Repo Context

Gather info to suggest defaults:

```bash
git rev-parse --show-toplevel          # repo root
git branch -r --format='%(refname:short)'  # remote branches
git branch --format='%(refname:short)'     # local branches
```

From the branch list, identify:
- Common branch patterns (feature/*, bugfix/*, hotfix/*)
- Default/target branches (main, master, dev, develop, release/*)

## Step 4: Gather Configuration

Ask the user (with detected defaults):

1. **Branch patterns** — which branches should trigger review?
   Default: `["feature/*", "bugfix/*", "hotfix/*"]`

2. **Budget** — max USD per review?
   Default: `0.50`

3. **Block severity** — which severities block the push?
   Default: `["critical"]`
   Options: `critical`, `warning`, `suggestion`

4. **Max diff lines** — skip review if diff exceeds this?
   Default: `5000`

5. **Exclude paths** — paths to skip (lock files, generated code)?
   Default: `["*.lock", "*.generated.*"]`

## Step 5: Create Config

Write `.claude/review.json` in the repo root:

```json
{
  "enabled": true,
  "branches": ["feature/*", "bugfix/*", "hotfix/*"],
  "model": "opus",
  "budget": 0.50,
  "blockOn": ["critical"],
  "maxDiffLines": 5000,
  "excludePaths": ["*.lock", "*.generated.*"]
}
```

Create the `.claude/` directory if it doesn't exist.

Add `.claude/` to `.gitignore` if not already present:
- If `.gitignore` exists, append `.claude/` only if it isn't already listed
- If `.gitignore` does not exist, create it with `.claude/` as the sole entry

## Step 6: Install Hook

Write the pre-push hook to `.git/hooks/pre-push`. The complete hook script is below — write it verbatim:

<details>
<summary>pre-push hook script</summary>

```bash
#!/usr/bin/env bash
# pre-push hook — automatic code review via Claude Code CLI
# Bypass: SKIP_REVIEW=1 git push
# Dry run: DRY_RUN=1 git push

set -euo pipefail

# ---------------------------------------------------------------------------
# Bypass checks
# ---------------------------------------------------------------------------

if [[ -n "${SKIP_REVIEW:-}" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

if ! command -v claude &>/dev/null; then
  echo "[review-hook] claude CLI not found — skipping review"
  exit 0
fi

if ! command -v jq &>/dev/null; then
  echo "[review-hook] jq not found — skipping review"
  exit 0
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG="$REPO_ROOT/.claude/review.json"

if [[ ! -f "$CONFIG" ]]; then
  exit 0
fi

ENABLED=$(jq -r '.enabled // true' "$CONFIG")
if [[ "$ENABLED" != "true" ]]; then
  exit 0
fi

# Read config with defaults
MODEL=$(jq -r '.model // "opus"' "$CONFIG")
BUDGET=$(jq -r '.budget // 0.50' "$CONFIG")
MAX_DIFF_LINES=$(jq -r '.maxDiffLines // 5000' "$CONFIG")

# Read arrays (portable — no mapfile, works on Bash 3.2+/macOS)
BRANCHES=()
while IFS= read -r line; do [[ -n "$line" ]] && BRANCHES+=("$line"); done < <(jq -r '.branches[]? // empty' "$CONFIG")
BLOCK_ON=()
while IFS= read -r line; do [[ -n "$line" ]] && BLOCK_ON+=("$line"); done < <(jq -r '.blockOn[]? // empty' "$CONFIG")
EXCLUDE_PATHS=()
while IFS= read -r line; do [[ -n "$line" ]] && EXCLUDE_PATHS+=("$line"); done < <(jq -r '.excludePaths[]? // empty' "$CONFIG")

# Defaults if empty
if [[ ${#BRANCHES[@]} -eq 0 ]]; then
  BRANCHES=("feature/*" "bugfix/*" "hotfix/*")
fi

if [[ ${#BLOCK_ON[@]} -eq 0 ]]; then
  BLOCK_ON=("critical")
fi

# ---------------------------------------------------------------------------
# Color output (TTY-aware)
# ---------------------------------------------------------------------------

if [[ -t 1 ]]; then
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' YELLOW='' GREEN='' CYAN='' BOLD='' RESET=''
fi

# ---------------------------------------------------------------------------
# Branch matching
# ---------------------------------------------------------------------------

matches_pattern() {
  local value="$1"
  shift
  local has_positive=false
  local matched_positive=false
  local excluded=false

  for pattern in "$@"; do
    if [[ "$pattern" == !* ]]; then
      # Negation pattern — strip the '!' prefix
      local neg_pattern="${pattern#!}"
      # shellcheck disable=SC2254
      case "$value" in
        $neg_pattern) excluded=true ;;
      esac
    else
      has_positive=true
      # shellcheck disable=SC2254
      case "$value" in
        $pattern) matched_positive=true ;;
      esac
    fi
  done

  # If excluded, no match
  if [[ "$excluded" == true ]]; then
    return 1
  fi

  # If there are positive patterns, must match at least one
  if [[ "$has_positive" == true ]]; then
    if [[ "$matched_positive" == true ]]; then
      return 0
    else
      return 1
    fi
  fi

  # No positive patterns and not excluded — match
  return 0
}

# ---------------------------------------------------------------------------
# Parse pre-push stdin
# ---------------------------------------------------------------------------

REVIEW_REF=""
LOCAL_SHA=""
REMOTE_SHA=""
ZERO="0000000000000000000000000000000000000000"

while read -r local_ref local_sha remote_ref remote_sha; do
  # Skip branch deletions
  if [[ "$local_sha" == "$ZERO" ]]; then
    continue
  fi

  # Extract short branch name from ref
  branch="${local_ref#refs/heads/}"

  if matches_pattern "$branch" "${BRANCHES[@]}"; then
    REVIEW_REF="$branch"
    LOCAL_SHA="$local_sha"
    REMOTE_SHA="$remote_sha"
    break  # Review first matching ref only
  fi
done

if [[ -z "$REVIEW_REF" ]]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Generate diff
# ---------------------------------------------------------------------------

# New branch — diff against merge-base with default branch
if [[ "$REMOTE_SHA" == "$ZERO" ]]; then
  DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
  MERGE_BASE=$(git merge-base "$DEFAULT_BRANCH" "$LOCAL_SHA" 2>/dev/null || echo "$DEFAULT_BRANCH")
  DIFF_RANGE="$MERGE_BASE..$LOCAL_SHA"
else
  DIFF_RANGE="$REMOTE_SHA..$LOCAL_SHA"
fi

# Build path exclusion args for git diff
EXCLUDE_ARGS=()
for pattern in "${EXCLUDE_PATHS[@]}"; do
  EXCLUDE_ARGS+=(":(exclude)$pattern")
done

DIFF=$(git diff "$DIFF_RANGE" -- . "${EXCLUDE_ARGS[@]}" 2>/dev/null || true)

if [[ -z "$DIFF" ]]; then
  exit 0
fi

# Check diff size
DIFF_LINES=$(echo "$DIFF" | wc -l)
if [[ "$DIFF_LINES" -gt "$MAX_DIFF_LINES" ]]; then
  echo -e "${YELLOW}[review-hook]${RESET} Diff too large ($DIFF_LINES lines > $MAX_DIFF_LINES max) — skipping review"
  exit 0
fi

# ---------------------------------------------------------------------------
# Review prompt
# ---------------------------------------------------------------------------

read -r -d '' REVIEW_PROMPT << 'PROMPT' || true
You are a code reviewer running as a git pre-push hook. Perform a focused review of the provided diff. Be concise and high-signal — quality over quantity.

## Output Formatting

Your output is rendered directly in a bash/zsh terminal — NOT in a markdown renderer. Follow these rules:
- Do NOT use markdown (no bold, no headings, no code fences, no italic)
- Use plain text with indentation and spacing for structure
- Use UPPERCASE labels for section headers (e.g., CRITICAL, WARNINGS, SUGGESTIONS)
- Use ASCII separators if needed (e.g., ---) to group findings
- File paths and code snippets should be unquoted or use single quotes if needed for clarity

## Instructions

1. If a `.review_instructions.md` file exists in the repo root, read it for project-specific review guidelines. Treat these as authoritative — check strict compliance.
2. Review the diff through five lenses:

### Structural Analysis
- What do the changes do? Are they cohesive?
- Any missing pieces (e.g., migration without rollback, new API without tests)?

### Code Quality & Correctness
- Logic errors, edge cases, off-by-one, null handling
- Naming, structure, consistency with surrounding code
- Performance: N+1 queries, unnecessary allocations, hot-path concerns

### Error Handling Audit
- Scan all catch blocks, error callbacks, and fallback logic in the diff
- Flag: empty catch blocks, overly broad catches that hide unrelated errors, log-and-continue patterns
- Check: are error messages actionable and specific, not generic?
- Verify: do fallbacks mask underlying problems? Will users/operators understand what went wrong?
- Check for project-specific logging patterns (from .review_instructions.md) if defined

### Test Coverage Gaps
- Do changed code paths have corresponding tests?
- Are error paths and edge cases tested (not just happy path)?
- Are negative test cases present for validation logic?
- Rate each gap by criticality (how likely is this to cause a prod issue?)
- Do NOT flag missing tests for trivial changes (logging, comments, config)

### Security (>80% confidence only)
- Input validation: injection, path traversal, XXE
- Auth: bypass, privilege escalation, session flaws
- Crypto: hardcoded secrets, weak algorithms
- Code execution: unsafe deserialization, eval, XSS
- Data exposure: sensitive data logging, PII leaks
Do NOT flag theoretical issues, test-only files, or framework-handled concerns.

## Confidence Scoring

Rate each finding using this rubric — only these three values:
- 100 — reproducible from the diff alone; no inference required
- 80 — one inferential step required (e.g., tracing a call to its definition)
- 60 — two or more inferential steps, or requires platform/domain knowledge

Only report findings with confidence >= 80.

## Output Format

For each finding (confidence >= 80 only):

  [severity] Category — Description (confidence: N)

    Explanation with context.

    File: path/to/file.go:42
    Fix:  <concrete recommendation>

Severity levels: [critical], [warning], [suggestion], [nit]
Max 3 nits. Every criticism includes a suggestion.

If no high-confidence issues found, say so briefly.

## Verdict

End your response with exactly one of these as the very last line — no bullets, no trailing text after it:
EXIT_CODE: 0 — no critical/blocking issues
EXIT_CODE: 1 — critical issues that should be fixed before pushing
PROMPT

# ---------------------------------------------------------------------------
# Invoke Claude
# ---------------------------------------------------------------------------

echo -e "${CYAN}${BOLD}[review-hook]${RESET} Reviewing ${BOLD}$REVIEW_REF${RESET} ($DIFF_LINES lines changed)..."

if [[ -n "${DRY_RUN:-}" ]]; then
  echo -e "${YELLOW}[review-hook]${RESET} Dry run — would review $DIFF_LINES lines on branch $REVIEW_REF"
  echo -e "  Model: $MODEL | Budget: \$$BUDGET | Block on: ${BLOCK_ON[*]}"
  exit 0
fi

REVIEW_OUTPUT=$(echo "$DIFF" | claude -p \
  "$REVIEW_PROMPT

Review this diff being pushed to branch '$REVIEW_REF'. The diff follows on stdin." \
  --model "$MODEL" \
  --permission-mode dontAsk \
  --no-session-persistence \
  --output-format text \
  --max-budget-usd "$BUDGET" \
  --tools "Read,Grep,Glob" \
  --verbose 0 \
  2>/dev/null) || {
  echo -e "${YELLOW}[review-hook]${RESET} Claude review failed — pushing anyway"
  exit 0
}

# ---------------------------------------------------------------------------
# Display results
# ---------------------------------------------------------------------------

echo ""
echo -e "${CYAN}${BOLD}━━━ Code Review ━━━${RESET}"
echo ""
echo "$REVIEW_OUTPUT"
echo ""
echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ---------------------------------------------------------------------------
# Parse verdict
# ---------------------------------------------------------------------------

VERDICT=$(echo "$REVIEW_OUTPUT" | grep '^EXIT_CODE:' | awk '{print $2}' | tail -1 || true)

# No fallback — if EXIT_CODE line is missing, block the push
if [[ -z "$VERDICT" ]]; then
  echo -e "${RED}[review-hook]${RESET} Claude did not return a verdict — blocking push as a safety default."
  echo -e "  Bypass: ${BOLD}SKIP_REVIEW=1 git push${RESET}"
  exit 1
fi

# Map EXIT_CODE values to readable verdict
if [[ "$VERDICT" == "0" ]]; then
  VERDICT="PASS"
elif [[ "$VERDICT" == "1" ]]; then
  VERDICT="BLOCK"
else
  echo -e "${RED}[review-hook]${RESET} Unexpected EXIT_CODE value '$VERDICT' (expected 0 or 1) — blocking push."
  exit 1
fi

if [[ "$VERDICT" == "BLOCK" ]]; then
  echo -e "${RED}${BOLD}[review-hook] BLOCKED${RESET} — critical issues found. Fix before pushing."
  echo -e "  Bypass: ${BOLD}SKIP_REVIEW=1 git push${RESET}"
  exit 1
else
  echo -e "${GREEN}${BOLD}[review-hook] PASSED${RESET}"
  exit 0
fi
```

</details>

After writing, make it executable:

```bash
chmod +x .git/hooks/pre-push
```

If a pre-push hook already exists, warn the user and ask whether to overwrite or append.

## Step 7: Validate

Run checks:

```bash
# Hook exists and is executable
test -x .git/hooks/pre-push && echo "Hook installed"

# Config is valid JSON
jq . .claude/review.json >/dev/null 2>&1 && echo "Config valid"

# Dry run
DRY_RUN=1 git push --dry-run 2>&1 || true
```

Show summary:

```
Review hook installed for <repo-name>

  Config:    .claude/review.json
  Hook:      .git/hooks/pre-push
  Branches:  feature/*, bugfix/*, hotfix/*
  Model:     opus
  Budget:    $0.50/review
  Block on:  [critical]

  Bypass:    SKIP_REVIEW=1 git push
  Dry run:   DRY_RUN=1 git push
  Disable:   set "enabled": false in .claude/review.json
  Remove:    /review-setup remove
```

---

## Status Check

When `$ARGUMENTS` is `status`:

1. Check if `.claude/review.json` exists — show config or "not configured"
2. Check if `.git/hooks/pre-push` exists and is executable
3. Show both in a summary table

## Remove

When `$ARGUMENTS` is `remove`:

1. Confirm with user before proceeding
2. Remove `.git/hooks/pre-push` (only if it's the review hook — check for the marker comment)
3. Optionally remove `.claude/review.json` (ask user)
4. Confirm removal
