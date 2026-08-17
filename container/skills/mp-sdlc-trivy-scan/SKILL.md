<!-- Installed from marketplace plugin: sdlc/trivy-scan -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: trivy-scan
description: Run Trivy vulnerability scan on a local project. Reports findings grouped by severity with package details, CVE links, and fix versions. Use when checking a repo for known vulnerabilities.
argument-hint: "<path>"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep
---

# Trivy Vulnerability Scan

Run a vulnerability scan using Trivy and present the results. Automatically detects whether the project is a Kubernetes component (via `skaffold.yaml`) and uses Docker image scanning, or falls back to filesystem scanning.

## Step 1: Determine Scan Target and Options

Parse `$ARGUMENTS` for:
- **path**: The directory to scan (default: current working directory, or `$ORCH_CODE_ROOT/<repo>` if a repo name is given)

If no path is provided, use the current working directory.

## Step 2: Check Trivy Installation

```bash
command -v trivy && trivy --version
```

If Trivy is not installed, tell the user and suggest:
- **macOS (brew):** `brew install trivy`
- **Other:** `curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh`

Stop here if Trivy is not available.

## Step 3: Detect Scan Mode

Check if the target directory contains a `skaffold.yaml` file:

```bash
ls -la <path>/skaffold.yaml 2>/dev/null
```

- **If `skaffold.yaml` exists** → this is a Kubernetes component. Use **Image Scan Mode** (Step 4A).
- **If no `skaffold.yaml`** → use **Filesystem Scan Mode** (Step 4B).

Tell the user which mode was detected.

## Step 4: Check for .plxci.yaml

```bash
# Check if target has a .plxci.yaml file
ls -la <path>/.plxci.yaml 2>/dev/null
```

If present, read the file and extract the `ignore.vulnerabilities` list. Note the ignored CVEs and their reasons — mention them in the report so the user knows what's being suppressed.

The `.plxci.yaml` format:
```yaml
ignore:
  vulnerabilities:
    - id: "CVE-XXXX-YYYY"
      reason: "explanation"
      ticket: "PLX-1234"   # optional Jira ticket
```

## Step 5A: Image Scan Mode (Kubernetes components)

When `skaffold.yaml` is present, build Docker images locally and scan them with `trivy image`.

### 5A.1: Parse skaffold.yaml

Read `skaffold.yaml` and extract the artifacts list. Each artifact has:
- **image**: The full image name (e.g., `registry.spock.tn.akamai.com/plx/tyk-gateway`)
- **context**: The build context directory (e.g., `components/tyk-gateway`)
- **docker.buildArgs**: Build arguments (e.g., `CTX_PATH`, `DOCKER_REGISTRY`)

Derive a short local tag for each artifact from the image name (e.g., `ux-gateway/tyk-gateway` from the last two path segments, or `<project>/<component>` from the context path).

### 5A.2: Check Docker availability

```bash
docker info --format '{{.ServerVersion}}' 2>/dev/null
```

If Docker is not running or not installed, stop and tell the user Docker is required for image scanning of Kubernetes components.

### 5A.3: Build images locally

For each artifact in the skaffold config, build the Docker image. The key build args to override for local builds:
- **`DOCKER_REGISTRY=docker.io`** — the Dockerfiles default to the internal Akamai registry (`docker.akamai.com/images`) which requires VPN/TLS certs. Override to `docker.io` for local builds.
- **`CTX_PATH=.`** — the Dockerfiles use `CTX_PATH` for `COPY` instructions. In CI, this is a repo-relative path; locally with the component directory as context, it must be `.`.

```bash
docker build \
  -t <local-tag> \
  --build-arg DOCKER_REGISTRY=docker.io \
  --build-arg CTX_PATH=. \
  -f <context>/Dockerfile \
  <context>/ \
  2>&1
```

Build images sequentially (parallel builds can cause resource contention). Report progress as each image builds. If a build fails, report the error and continue with the remaining images.

### 5A.4: Scan each image

For each successfully built image, run:

```bash
trivy image \
  --format json \
  --quiet \
  <local-tag>
```

Collect the JSON results from all image scans.

### 5A.5: Clean up images

After all scans complete, remove the locally built images to free disk space:

```bash
docker rmi <local-tag-1> <local-tag-2> ... 2>/dev/null
```

### Notes on Image Scan Mode

- Image scanning detects vulnerabilities in the **final container image**, including OS packages (Alpine apk), compiled Go binaries, Python packages, JARs, etc. This is more accurate than filesystem scanning because it reflects what actually runs in production.
- If a build fails because of missing base images from the internal registry and `DOCKER_REGISTRY` override doesn't help (e.g., the Dockerfile hardcodes an internal image), note it and suggest the user build manually or connect to VPN.
- The scan may find vulnerabilities in base image OS packages (e.g., `zlib` in Alpine) that aren't visible in a filesystem scan.

## Step 5B: Filesystem Scan Mode (non-Kubernetes projects)

```bash
trivy fs \
  --format json \
  --quiet \
  <path>
```

Capture the JSON output. If the scan fails, check:
- Whether the path exists and contains scannable files
- Whether the DB update failed (rate limited or network error) — follow the recovery steps below

## Step 6: DB Update Failure Recovery

Trivy auto-updates its DB on each run. If this fails (rate limiting, network issues), pull from the internal Akamai mirror using `oras`:

```bash
# Pull DB from internal mirror
oras pull --cert-file ~/.certs/svcPlxSpock.crt --key-file ~/.certs/svcPlxSpock.key --ca-file ~/.certs/akamai_ca_list.pem bos.docker.akamai.com/images/aquasec/trivy-db:2

# Pull Java DB from internal mirror
oras pull --cert-file ~/.certs/svcPlxSpock.crt --key-file ~/.certs/svcPlxSpock.key --ca-file ~/.certs/akamai_ca_list.pem bos.docker.akamai.com/images/aquasec/trivy-java-db:1

# Extract to Trivy cache
mkdir -p ~/.cache/trivy/db
tar -xzf db.tar.gz -C ~/.cache/trivy/db
mkdir -p ~/.cache/trivy/java-db
tar -xzf javadb.tar.gz -C ~/.cache/trivy/java-db
```

After manual DB recovery, re-run the scan with `--skip-db-update` to avoid hitting the public registry again.

## Step 7: Parse and Present Results

From the JSON output (one per image in Image Scan Mode, or one for Filesystem Scan Mode), extract and present:

### Summary Table

For **Image Scan Mode**, show a per-image summary:

| Image | Target | Type | Total | Critical | High |
|-------|--------|------|-------|----------|------|

For **Filesystem Scan Mode**:

| Target | Type | Total | Critical | High | Medium | Low |
|--------|------|-------|----------|------|--------|-----|

### Detailed Findings (grouped by severity)

For each vulnerability found:

```
[SEVERITY] CVE-ID — Package@Version
  Title: <vulnerability title>
  Fixed Version: <fixed version or "no fix available">
  Installed: <current version>
  Description: <first 2 sentences of description>
  Reference: <primary URL>
```

Group by severity: CRITICAL first, then HIGH, MEDIUM, LOW.

In Image Scan Mode, identify **cross-cutting vulnerabilities** that appear in multiple images (e.g., Alpine base OS packages, shared Go stdlib version). Present these once with a note about which images are affected, rather than repeating them for each image.

### Ignored Vulnerabilities (.plxci.yaml)

If a `.plxci.yaml` file exists, list which CVEs are being suppressed, their reasons, and any associated Jira tickets.

### Recommendations

Based on the findings:
1. Count how many vulnerabilities have available fixes — suggest `trivy-fix` for those
2. Flag any vulnerabilities with no fix available — these may need `.plxci.yaml` ignore entries
3. If the DB is stale (check `Metadata` in the JSON for `NextUpdate` being in the past), suggest updating

For **Image Scan Mode**, additionally recommend:
- **Alpine base OS fixes**: If Alpine packages like `zlib` or `libpng` are vulnerable across images, suggest updating the base image tag or adding `apk upgrade` to Dockerfiles
- **Go stdlib fixes**: If the Go stdlib version is vulnerable, suggest bumping the Go version in Dockerfiles (e.g., `golang:1.25-alpine` → `golang:1.26-alpine`)
- **Go module fixes**: If third-party Go modules are vulnerable, suggest updating them in the component's `go.mod`

## Step 8: PR Comment Format (optional)

If the user asks for PR-ready output or mentions a PR, format the findings as a concise markdown comment suitable for posting to a Bitbucket PR:

```markdown
## Trivy Vulnerability Scan

**Target:** <path>
**Scan mode:** <Image Scan (N images) | Filesystem Scan>
**Scan date:** <date>
**Findings:** N vulnerabilities (X critical, Y high)

<collapsed details with full findings>
```

Mention that `/trivy-fix` can be used to attempt automated remediation.
