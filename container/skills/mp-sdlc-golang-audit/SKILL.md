<!-- Installed from marketplace plugin: sdlc/golang-audit -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: golang-audit
description: Audit an entire Go repository, project, or folder against Akamai InfraSec Golang coding standards. Reviews all .go files — not just recent changes — covering project layout, naming, error handling, concurrency, logging, config, testing, HTTP, SOLID, and more. Use when onboarding a codebase, assessing technical debt, or doing a full standards compliance check.
argument-hint: "[<path>] [--package <pkg>] [--skip-tests] [--summary-only]"
---

Perform a full Go coding standards audit across an entire repository or folder.

## Step 1: Parse Arguments

Parse `$ARGUMENTS`:

- `<path>` — directory to audit (default: current working directory `.`)
- `--package <pkg>` — restrict audit to a specific package path pattern (e.g. `internal/service`)
- `--skip-tests` — exclude `_test.go` files from the audit
- `--summary-only` — skip per-file details, output only the summary table

## Step 2: Discover Go Files

```bash
# Find all .go files under the target path
find <path> -name "*.go" -not -path "*/vendor/*" -not -path "*/.git/*" | sort

# If --skip-tests is set, exclude test files
find <path> -name "*.go" -not -name "*_test.go" -not -path "*/vendor/*" | sort

# Count for planning
find <path> -name "*.go" -not -path "*/vendor/*" | wc -l
```

Collect the module name and Go version:
```bash
head -5 <path>/go.mod 2>/dev/null || find <path> -name "go.mod" -maxdepth 2 | head -1 | xargs head -5
```

## Step 3: Group Files by Package

Group discovered `.go` files by their directory (= package). Process one package at a time to stay within context limits for large codebases.

```bash
find <path> -name "*.go" -not -path "*/vendor/*" | xargs -I{} dirname {} | sort -u
```

If the total file count exceeds 80 files, process packages in batches and aggregate findings at the end.

## Step 4: Audit Each Package

For each package directory, read all `.go` files in it and run the `golang-standards-reviewer` agent with the **full file contents** (not a diff).

Instruct the agent:
> You are auditing the full source of package `<package-path>`, not a diff. Review every file for violations of Akamai InfraSec Go coding standards. Apply all 14 sections including SOLID principles. For each finding, cite the exact file and line number.

Collect the agent's output per package.

## Step 5: Project-Level Checks

After per-package review, run these project-level checks that cannot be assessed per-file:

### Layout Compliance
```bash
# Check for banned package names
find <path> -type d \( -name "utils" -o -name "helpers" -o -name "common" -o -name "base" \) \
  -not -path "*/vendor/*"

# Check cmd/ structure — each binary should have its own subdirectory
ls <path>/cmd/ 2>/dev/null

# Check for business logic leaking into main.go files
for f in $(find <path>/cmd -name "main.go" 2>/dev/null); do
  wc -l "$f"
done
```

### Dependency Hygiene
```bash
# Check go.mod is tidy (no unused deps)
cd <path> && go mod verify 2>&1 | head -10

# Check for replace directives without CVE comments
grep -n "^replace" <path>/go.mod 2>/dev/null
```

### CI / Linter Config
```bash
# Check golangci-lint config exists
ls <path>/.golangci.yaml <path>/.golangci.yml 2>/dev/null

# Check for race detector in CI
grep -r "race" <path>/Makefile <path>/Jenkinsfile <path>/.github 2>/dev/null | grep "test" | head -5
```

### Interface Location Check
```bash
# Find interfaces — flag any defined in a package that also contains the implementation
grep -rn "^type .* interface" <path> --include="*.go" -l | grep -v "_test.go" | grep -v "vendor"
```

## Step 6: Aggregate All Findings

Collect findings from all packages and project-level checks:

1. **Deduplicate** identical violations across files
2. **Group by severity**: 🚨 Critical → ⚠️ Important → 💡 Style
3. **Group by standards section**: Package Declarations, Project Layout, Naming, Error Handling, Concurrency, Logging, Config, Testing, HTTP, Messaging, DI, Code Style, CI, SOLID
4. **Count violations per package** for the summary table

## Step 7: Output

```markdown
## Go Codebase Audit — <module-name>

**Scope:** <path> | **Go version:** <version> | **Files audited:** N | **Packages:** N

---

### 🚨 Critical Issues (N total)

#### <package/path>

**[Section] — Description** (file: `<file>:<line>`)
Why it matters: <one sentence>.
Fix: <specific correction>

---

### ⚠️ Important Issues (N total)

#### <package/path>
...

---

### 💡 Style / Suggestions (N total)
...

---

### Package Compliance Summary

| Package | 🚨 Critical | ⚠️ Important | 💡 Style | Status |
|---------|------------|-------------|---------|--------|
| `internal/service` | 2 | 3 | 1 | ❌ Needs work |
| `internal/config` | 0 | 1 | 0 | ⚠️ Minor issues |
| `pkg/rabbitmq` | 0 | 0 | 2 | ✅ Good |
| `cmd/netrecon` | 1 | 0 | 0 | ❌ Needs work |

---

### Standards Coverage Summary

| Standard | Violations | Worst offender |
|----------|-----------|----------------|
| Error Handling | N | `pkg/service/alert_service.go` |
| Concurrency | N | `pkg/sflow/processor.go` |
| SOLID — DIP | N | `internal/app/app.go` |
| Naming | N | — |
| ... | | |

---

### Top Recommendations (Priority Order)

1. **<highest impact fix>** — affects N files
2. **<second priority>** — affects N files
3. **<third priority>** — affects N files

---

### Overall Verdict

**NEEDS WORK** / **MINOR ISSUES** / **CLEAN**

- Total files: N
- Files with critical issues: N  
- Files with no issues: N (N%)
- Estimated remediation effort: low / medium / high
```

**Verdict guide:**

| Verdict | Condition |
|---------|-----------|
| `CLEAN` | Zero critical, zero important issues |
| `MINOR ISSUES` | Zero critical, one or more important |
| `NEEDS WORK` | One or more critical issues |
