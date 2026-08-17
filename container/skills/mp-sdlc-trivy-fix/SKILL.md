<!-- Installed from marketplace plugin: sdlc/trivy-fix -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: trivy-fix
description: Fix Trivy vulnerabilities by updating dependencies and managing .plxci.yaml ignore entries. Updates packages with available fixes, generates ignore entries with AI-written reasons, and cleans up obsolete ignores.
argument-hint: "<path> [--auto] [--ignore-only] [--cleanup]"
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Trivy Vulnerability Fix

Attempt to remediate vulnerabilities found by Trivy through dependency updates and `.plxci.yaml` ignore management.

## Step 1: Parse Arguments

Parse `$ARGUMENTS` for:
- **path**: The directory to scan/fix (default: current working directory)
- **--auto**: Skip confirmation prompts — update all fixable dependencies and generate ignores for the rest
- **--ignore-only**: Only manage `.plxci.yaml` ignores — do not update dependencies
- **--cleanup**: Only clean up obsolete `.plxci.yaml` ignore entries (no scan or fix)

## Step 2: Detect Scan Mode

Check if the target directory contains a `skaffold.yaml` file:

```bash
ls -la <path>/skaffold.yaml 2>/dev/null
```

- **If `skaffold.yaml` exists** → this is a Kubernetes component. Use **Image Scan Mode**.
- **If no `skaffold.yaml`** → use **Filesystem Scan Mode**.

Tell the user which mode was detected.

## Step 3: Run Scan (unless --cleanup)

If not in cleanup-only mode, run a scan to get the current vulnerability state.

### Filesystem Scan Mode

```bash
trivy fs \
  --format json \
  --quiet \
  <path>
```

### Image Scan Mode (Kubernetes components)

When `skaffold.yaml` is present, build Docker images locally and scan them with `trivy image`.

1. **Parse `skaffold.yaml`** — extract artifacts (image name, context path, buildArgs)
2. **Check Docker** — verify Docker is running (`docker info`)
3. **Build each image** sequentially with local overrides:
   ```bash
   docker build \
     -t <local-tag> \
     --build-arg DOCKER_REGISTRY=docker.io \
     --build-arg CTX_PATH=. \
     -f <context>/Dockerfile \
     <context>/
   ```
4. **Scan each image:**
   ```bash
   trivy image \
     --format json \
     --quiet \
     <local-tag>
   ```
5. **Clean up images** after all scans complete:
   ```bash
   docker rmi <local-tag-1> <local-tag-2> ... 2>/dev/null
   ```

Collect all scan results (one per image) and merge them for the categorization step. Deduplicate vulnerabilities that appear across multiple images (e.g., shared Alpine base OS packages, Go stdlib) — track them once but note which images are affected.

### Categorization

Parse the JSON and categorize vulnerabilities into:
1. **Fixable**: A `FixedVersion` is available
2. **Unfixable**: No fix available yet

For Image Scan Mode, additionally categorize by fix approach:
- **OS package updates** (e.g., `zlib`, `libpng`) → fix by updating base image or adding `apk upgrade` to Dockerfiles
- **Go stdlib updates** → fix by bumping the Go version in Dockerfiles
- **Go module updates** → fix by updating dependencies in the component's `go.mod`
- **Other language packages** (Python, Java, etc.) → fix in respective dependency files

### DB Update Failure Recovery

If the scan fails due to a DB update error (rate limiting, network issues), pull from the internal Akamai mirror:

```bash
oras pull --cert-file ~/.certs/svcPlxSpock.crt --key-file ~/.certs/svcPlxSpock.key --ca-file ~/.certs/akamai_ca_list.pem bos.docker.akamai.com/images/aquasec/trivy-db:2
oras pull --cert-file ~/.certs/svcPlxSpock.crt --key-file ~/.certs/svcPlxSpock.key --ca-file ~/.certs/akamai_ca_list.pem bos.docker.akamai.com/images/aquasec/trivy-java-db:1

mkdir -p ~/.cache/trivy/db && tar -xzf db.tar.gz -C ~/.cache/trivy/db
mkdir -p ~/.cache/trivy/java-db && tar -xzf javadb.tar.gz -C ~/.cache/trivy/java-db
```

Then re-run with `--skip-db-update`.

## Step 4: Detect Package Manager

Identify the project's package manager(s) by checking for:

| File | Package Manager | Update Command |
|------|----------------|----------------|
| `build.sbt` | sbt (Scala) | Manual — edit version in `build.sbt` or `Dependencies.scala` |
| `pom.xml` | Maven (Java) | Edit `<version>` tag in `pom.xml` |
| `build.gradle` / `build.gradle.kts` | Gradle (Java/Kotlin) | Edit version in build file |
| `go.mod` | Go modules | `go get <pkg>@<version>` |
| `requirements.txt` / `pyproject.toml` | pip / uv (Python) | Edit version constraint, then `uv sync` or `pip install` |
| `package.json` | npm / bun (JS/TS) | `npm update <pkg>` or `bun update <pkg>` |
| `Gemfile` | Bundler (Ruby) | `bundle update <gem>` |
| `Cargo.toml` | Cargo (Rust) | `cargo update -p <pkg>` |

## Step 5: Fix Fixable Vulnerabilities

For each fixable vulnerability:

1. Identify the package and its fixed version from the scan results
2. Determine the fix approach based on vulnerability type and scan mode

### Image Scan Mode — Fix by Category

When in Image Scan Mode, vulnerabilities fall into distinct categories that require different fix approaches:

**OS package vulnerabilities** (e.g., `zlib`, `libpng`, `openssl` from Alpine):
- Locate the Dockerfile for the affected image(s) in the component directory
- If the base image tag is pinned (e.g., `alpine:3.23.3`), check if a newer tag includes the fix
- Otherwise, add `RUN apk upgrade --no-cache` after the `FROM` line, or pin the specific package: `RUN apk add --no-cache zlib>=1.3.2-r0`
- Show the user what will change before applying (unless `--auto`)

**Go stdlib vulnerabilities** (package name `stdlib`):
- These are fixed by bumping the Go compiler version in the Dockerfile
- Locate the `FROM golang:<version>` line in the affected component's Dockerfile
- Update to the fixed Go version (e.g., `golang:1.25-alpine` → `golang:1.26-alpine`)

**Go module vulnerabilities** (e.g., `google.golang.org/grpc`, `golang.org/x/crypto`):
- Locate the component's `go.mod` file (in the context directory from skaffold)
- Use `go get <pkg>@<fixed-version>` followed by `go mod tidy`

**Other language packages** (Python, Java, Node, etc.):
- Fix in the respective dependency files within the component directory

### Filesystem Scan Mode — Fix by Dependency Type

**Direct Dependencies:**
- Locate the dependency declaration in the appropriate build file
- Update the version constraint to include the fixed version
- Show the user what will change before applying (unless `--auto`)

**Transitive Dependencies:**
- Identify which direct dependency pulls in the vulnerable transitive dep
- Check if updating the direct dependency resolves the transitive vulnerability
- If not, note it as requiring manual intervention (e.g., override, exclusion, or waiting for upstream)

### Regenerate Lock Files

After updates, re-run the package manager's install/lock command to regenerate lock files:

```bash
# Examples:
bun install          # for bun projects
uv sync              # for Python/uv projects
go mod tidy          # for Go projects
mvn dependency:tree  # to verify Maven changes
```

### Verify Fixes

Re-scan after updates to confirm vulnerabilities are resolved. Use the same scan mode that was detected in Step 2:

- **Filesystem Mode**: `trivy fs --format json --quiet <path>`
- **Image Scan Mode**: Rebuild the affected images and re-scan with `trivy image` (only rebuild images whose components were modified)

Report which vulnerabilities were fixed and which remain.

## Step 6: Generate .plxci.yaml Ignore Entries

For vulnerabilities that **cannot be fixed** (no fix version available), generate `.plxci.yaml` ignore entries with meaningful reasons.

### .plxci.yaml Ignore Format

The project uses `.plxci.yaml` (not `.trivyignore`) for vulnerability management in the PLX CI pipeline:

```yaml
ignore:
  vulnerabilities:
    - id: "CVE-XXXX-YYYY"
      reason: "Detailed explanation of why this CVE is ignored"
      ticket: "PLX-1234"   # optional — Jira ticket tracking the exception
```

Both `id` and `reason` fields are **required** — the CI pipeline (`beat`) enforces this.

### Writing Ignore Reasons

For each unfixable vulnerability, generate a reason that includes:
1. **Why it can't be fixed** — no upstream patch available, or fix requires a major version bump with breaking changes
2. **Risk assessment** — whether the vulnerability is exploitable in the project's context (e.g., a server-side vuln in a CLI tool may be low risk)
3. **Mitigation** — any compensating controls in place or recommended

Read the vulnerability description and the project context to write a specific, useful reason — not a generic "no fix available" placeholder. The `reason` field is mandatory and enforced by CI, so make it genuinely informative.

Present all proposed ignore entries to the user for review before writing (unless `--auto`).

### Writing the File

- If `.plxci.yaml` already exists, read it, parse the YAML, and append new entries under `ignore.vulnerabilities` (preserve all other sections like `scan_fs`, `eol`, `plxcd`)
- If it doesn't exist, create it with the `ignore.vulnerabilities` section
- Keep entries sorted by CVE ID within the vulnerabilities list
- If the user mentions a Jira ticket, include the `ticket` field

## Step 7: Clean Up Obsolete Ignores

Check each CVE in `.plxci.yaml` `ignore.vulnerabilities` against the current scan results:

1. **Run a full scan** (all severities) to get the complete vulnerability list
2. **Compare** each ignored CVE against the scan results
3. **Remove entries** where:
   - The CVE no longer appears in the scan (vulnerability was removed from DB or dependency was updated)
   - The CVE now has a fix available (should be fixed instead of ignored)
4. **Report** what was cleaned up and why

**Important:** Removing obsolete ignore entries prevents build failures — if a CVE is removed from the Trivy DB but still listed in `.plxci.yaml`, the CI pipeline may fail.

For **Filesystem Scan Mode**:
```bash
# Get all current CVEs from a full scan
trivy fs --format json --quiet <path> | \
  python3 -c "import json,sys; d=json.load(sys.stdin); cves=set(); [cves.update(v['VulnerabilityID'] for v in r.get('Vulnerabilities',[])) for r in d.get('Results',[]) if r.get('Vulnerabilities')]; print('\n'.join(sorted(cves)))"
```

For **Image Scan Mode**, rebuild and scan all images (see Step 3), then collect all CVEs across all image scan results.

Parse `.plxci.yaml`, compare the `ignore.vulnerabilities[].id` values against the scan results, and remove stale entries. Write the updated YAML back, preserving all other sections.

This step always runs (even without `--cleanup`) as a final housekeeping step. When run with `--cleanup`, this is the only step that executes.

## Step 8: Summary

Present a summary of all actions taken:

```
## Trivy Fix Summary

### Dependencies Updated
- <package>: <old-version> -> <new-version> (fixes CVE-XXXX-YYYY)

### Ignore Entries Added
- CVE-XXXX-YYYY: <package> — <brief reason>

### Obsolete Ignores Removed
- CVE-XXXX-YYYY: <reason for removal>

### Remaining Issues
- <any vulnerabilities that couldn't be addressed>

### Next Steps
- <recommendations for manual intervention if needed>
```

If any dependency updates were made, remind the user to run tests before committing.
