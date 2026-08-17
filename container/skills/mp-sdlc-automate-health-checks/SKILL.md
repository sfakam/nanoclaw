<!-- Installed from marketplace plugin: sdlc/automate-health-checks -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

# Health Check SNT Automator

**Usage:** `/sdlc:automate-health-checks <component-name>`
**Example:** `/sdlc:automate-health-checks spock-monitor`

End-to-end skill that converts template SNTs for a component into a combined smoke-test SNT, writes the pytest automation code using the `HealthCheck` framework, validates it on-cluster via skaffold, and opens a draft PR. The component name is passed as an argument; if omitted, the skill will ask for it interactively.

## Tool usage policy

Use MCP tools (`create_issue`, `update_issue`, `transition_issue`, `search_issues`, `get_issue_transitions`) for all Jira operations. Use `bash` + `jcurl` for Zephyr step endpoints and issue links (not covered by MCP). Redefine `jcurl()` inline in every bash block — never assume it is available from a prior block.

**kubectl restriction:** Only `get` and `list` operations are permitted. Never run `apply`, `create`, `delete`, `patch`, `exec`, `port-forward`, `rollout`, or any write operation.

**Never abort the skill run.** At every failure or decision point, present the user with options and wait for their direction. A user unfamiliar with automation must always see a clear next step — never a dead end or silent exit.

---

## Step 0 — Config Check

```bash
CONFIG="$HOME/.config/plx-snts/config.sh"
[ -f "$CONFIG" ] && source "$CONFIG" && echo "CONFIG_LOADED" || echo "SETUP_NEEDED"
```

If `SETUP_NEEDED`, run the one-time setup wizard:

**Q1 — Akamai username** (free text)
> "Your Akamai username — used for mTLS cert path `~/.certs/<username>.crt`"

**Q2 — Default team** (single-select):
| Team | ID | Team | ID |
|------|----|------|----|
| InTel.InfraSec | `1916` | C2UI.InfraSec | `1918` |
| Detection.InfraSec | `1864` | CX.InfraSec | `1920` |
| Orchestration.InfraSec | `1917` | SRE.InfraSec | `1921` |
| Dataplane.InfraSec | `1919` | QA.E2E.InfraSec | `2664` |

**Q3 — SNT label baseline** (single-select):
- **C2UI** — `component,kubernetes,UI,dart,spock`
- **Standard PLX** — `component,kubernetes,spock`
- **Custom** — enter your own comma-separated list

**Q4 — Summary component prefix** (free text, optional)
> "Prefix used before component in SNT summaries, e.g. `plx-ui`. Leave blank to use the component name as-is."

**Q5 — QA reviewer username** (free text)
> "Jira username of the person who reviews SNTs on your team."

Save config:
```bash
mkdir -p "$HOME/.config/plx-snts"
cat > "$HOME/.config/plx-snts/config.sh" <<'EOF'
PLX_USERNAME="<username>"
PLX_TEAM_ID="<team-id>"
PLX_LABEL_BASELINE="<comma-separated-labels>"
PLX_SUMMARY_PREFIX="<prefix-or-empty>"
PLX_QA_REVIEWER="<reviewer-username>"
EOF
```

Read the component name from the skill argument (the word after the skill name in the invocation, e.g. `/sdlc:automate-health-checks spock-monitor` → `COMPONENT=spock-monitor`).

If no argument was provided, ask `AskUserQuestion` (free text via Other):
> "Which component do you want to create health check automation for? (e.g. `spock-monitor`, `adam-engine`)"

Store the answer as `COMPONENT`. Confirm to the user: "Running health check automation for component: `{COMPONENT}`"

---

## Step 1 — Fetch Template SNTs

```
search_issues(
  jql="project = SNT AND type = Test AND component = {COMPONENT} AND labels = template_spock_application",
  fields=["summary", "description", "components", "labels", "priority", "id"]
)
```

Show table:
```
| SNT Key | Summary | Priority |
|---------|---------|----------|
```

If 0 results, do NOT exit. Show the message "No template SNTs found for component `{COMPONENT}`." then ask `AskUserQuestion` (single-select):
> "No template SNTs found. How do you want to proceed?"
- **Re-enter a different component name** → ask for a new value, store as `COMPONENT`, re-run Step 1
- **Continue without template SNTs — I'll describe the steps manually** → skip Steps 2–3; proceed to Step 4 with an empty step list; Steps 4b will generate the 6 mandatory validations from scratch

---

## Step 2 — Select SNTs to Automate

Before the first batch, tell the user: "Found N template SNTs for `{COMPONENT}`. I'll present them in batches of up to 4."

`AskUserQuestion` (multiSelect: true, batched ≤4 options per call):
> "Select template SNTs to combine into the automation smoke test — batch X of Y (items X–X of N):"

Each option: label = `SNT-KEY`, description = summary + priority.
After each batch except the last: "✅ Selections recorded — batch X done. Moving to batch X+1 of Y…"

Collect **all** selections across all batches before continuing.

---

## Step 3 — Fetch Zephyr Steps

For each selected SNT, use the numeric `id` returned by `search_issues`:

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
jcurl "https://track-api.akamai.com/jira/rest/zapi/latest/teststep/<numericId>" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
steps = data.get('stepBeanCollection', data if isinstance(data, list) else [])
for i, s in enumerate(steps, 1):
    step = s.get('step','').strip()
    data_field = s.get('data','').strip()
    result = s.get('result','').strip()
    print(f'STEP {i}|{step}|{data_field}|{result}')
"
```

Run this for each selected SNT. Collect all steps grouped by source SNT key. Show summary:
```
SNT-XXXX → N steps
SNT-YYYY → M steps
```

---

## Step 4 — kubectl Discovery + Propose Combined SNT

### 4a — kubectl Discovery

Ask `AskUserQuestion` (single-select):
> "I can run read-only kubectl commands (get/list only — no writes) to discover the pod structure for `{COMPONENT}`, so I can propose accurate SNT steps and check which of the 6 framework validations apply. May I proceed?"
- **Yes, run kubectl** → collect context + app name, then proceed
- **No, skip kubectl** → work from SNT step text only

If yes, ask for:
- **kubectl context** (e.g., `spock-dart-nss1-8`) — store as `KUBE_CTX`
- **app name** (partial string to grep, e.g., `spock-monitor`) — store as `APP_NAME`

Run these commands (read-only — no writes):

```bash
# Discover namespace
kubectl --context={KUBE_CTX} get pods -A | grep {APP_NAME}
```

From the discovered namespace (store as `NS`):

```bash
# Pod names and labels
kubectl --context={KUBE_CTX} get pods -n {NS} --show-labels

# Deployment selectors
kubectl --context={KUBE_CTX} get deployment -n {NS} -o json | python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d.get('items', []):
    name = item['metadata']['name']
    labels = item['spec']['selector'].get('matchLabels', {})
    containers = item['spec']['template']['spec'].get('containers', [])
    for c in containers:
        lp = c.get('livenessProbe', {})
        rp = c.get('readinessProbe', {})
    print(f'Deployment: {name}  labels: {labels}')
    print(f'  livenessProbe:  {lp}')
    print(f'  readinessProbe: {rp}')
"

# Services (to detect Prometheus endpoint)
kubectl --context={KUBE_CTX} get service -n {NS} --show-labels

# Configmaps (to detect TLS/cert config)
kubectl --context={KUBE_CTX} get configmap -n {NS} | grep -iE 'tls|cert|ssl|config'
```

Present the discovered information to the user:
```
Discovered for {COMPONENT}:
  Namespace:  {NS}
  Pods:       {pod names}
  Labels:     {label selectors}
  Liveness:   {probe config or "not found"}
  Readiness:  {probe config or "not found"}
  Services:   {service list — flag any with port 8080/9090/2112 as potential Prometheus}
  TLS config: {configmap names with tls/cert or "none found"}
```

Ask `AskUserQuestion` (single-select):
> "Does this look correct for `{COMPONENT}`?"
- **Yes, use this** → proceed with discovered data
- **Some values are wrong** → user corrects; update before proceeding

### 4b — Intelligent Step Consolidation

Using the Zephyr steps from Step 3 and the kubectl topology from Step 4a (if available), produce the consolidated SNT steps:

**Rules:**
1. **Ensure all 6 framework validations are represented.** Map collected steps to the 6 validations below. For any of the 6 that has no matching step in the source SNTs, add a step for it explicitly.
2. **Never remove** a step that maps to one of the 6 framework validations.
3. **Consolidate** 2–3 steps that cover the same verification theme into one well-phrased step. Examples:
   - "Navigate to pod" + "Check pod is running" + "Verify pod condition=Ready" → "Verify all `{COMPONENT}` pods are deployed and in Ready state"
   - "Check application logs for errors" + "Verify logs present in Elasticsearch" → "Verify pod logs are error-free and indexed in Elasticsearch"
   - "Check metric endpoint reachable" + "Verify Prometheus scraping" → "Verify Prometheus metrics endpoint is accessible and returns expected metrics"
4. **Order:** installation → logs+ES → Prometheus metrics → CPU/memory resources → liveness/readiness → secure comms
5. **Step format:** `Step | Test Data | Expected Result` — phrase Expected Result as a concrete observable outcome.

**The 6 mandatory framework validations:**
| # | Theme | Expected step text |
|---|---|---|
| 1 | Pod installation | Verify all pods are deployed and in Ready state |
| 2 | Logs + Elasticsearch | Verify pod logs are error-free and indexed in Elasticsearch |
| 3 | Prometheus metrics | Verify Prometheus metrics endpoint is accessible |
| 4 | CPU/memory resources | Verify pod CPU and memory requests are within defined limits |
| 5 | Liveness + readiness probes | Verify liveness and readiness probes are correctly configured |
| 6 | Secure communication | Verify application uses secure (TLS/HTTPS) communication |

Propose:
- **Summary:** `[{COMPONENT}] Health Check Smoke Test` (or `[{PLX_SUMMARY_PREFIX}-{COMPONENT}]` if prefix is set)
- **Labels:** split `PLX_LABEL_BASELINE` on commas + `smoke`
- **Components:** `[{COMPONENT}]`
- **Steps:** the consolidated, ordered list

Show the full proposed SNT (summary, labels, component, step table) to the user.

Ask `AskUserQuestion` (single-select):
> "Is this SNT ready to create?"
- **Yes, create it** → proceed
- **Adjust summary or steps** → user describes change; re-present (loop until approved)

---

## Step 5 — Create SNT + Post Steps

```
create_issue(
  project="SNT",
  issueType="Test",
  summary="[{COMPONENT}] Health Check Smoke Test",
  components=["{COMPONENT}"],
  labels=[...from PLX_LABEL_BASELINE split + "smoke"],
  customFields={ "customfield_16600": "{PLX_TEAM_ID}" }
)
```

Record returned `key` (e.g. `SNT-99999`) and numeric `id`. Report: `✅ Created {SNT-NEW-KEY}`

Immediately set assignee:
```
update_issue(issueKey="{SNT-NEW-KEY}", assignee="{PLX_USERNAME}")
```

Post each consolidated step to Zephyr. Redefine jcurl inline:

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
BODY=$(python3 -c "import json,sys; print(json.dumps({'step':sys.argv[1],'data':sys.argv[2],'result':sys.argv[3]}))" \
  "<step text>" "<test data>" "<expected result>")
jcurl -X POST -H "Content-Type: application/json" -d "$BODY" \
  "https://track-api.akamai.com/jira/rest/zapi/latest/teststep/<SNT-NEW-NUMERIC-ID>"
```

Verify each POST returns a numeric step ID. Report: `✅ Added N steps to {SNT-NEW-KEY}`

---

## Step 6 — Close Selected Template SNTs

Before closing anything, ask `AskUserQuestion` (single-select):
> "Which template SNTs should be closed?"
- **Close only the N I selected** → close only the SNTs chosen in Step 2
- **Close ALL `template_spock_application` SNTs for `{COMPONENT}`** → run a fresh search first:
  ```
  search_issues(jql="project = SNT AND component = {COMPONENT} AND labels = template_spock_application", fields=["summary","id"])
  ```
  Then close every result, not just the selected subset

For each SNT to close:
```
get_issue_transitions(issueKey="<SNT-TEMPLATE-KEY>")
```
Find the transition whose `name` is exactly `"Closed"`. Apply it:
```
transition_issue(issueKey="<SNT-TEMPLATE-KEY>", transitionId="<id>")
```

If "Closed" is not available for a given SNT, log `⚠ Could not close <SNT-KEY> — no "Closed" transition available` and continue (non-fatal).

Report: `✅ Closed N of M template SNTs`

---

## Step 7 — Move New SNT to "QA Accepted Manual"

This is the required workflow progression. Attempt it now; if unavailable, retry after Step 8 creates the Automation Link (which unlocks additional transitions).

```
get_issue_transitions(issueKey="{SNT-NEW-KEY}")
```
Find transition with `name` matching `"QA Accepted Manual"`. If found, apply it:
```
transition_issue(issueKey="{SNT-NEW-KEY}", transitionId="<id>")
```
Report: `✅ {SNT-NEW-KEY} → QA Accepted Manual`

**If "QA Accepted Manual" is not available from the current state:**

Do not abort. Proceed to Step 8 (Create PLXAUTO + Automation Link). After Step 8 completes, re-fetch transitions and retry:
```
get_issue_transitions(issueKey="{SNT-NEW-KEY}")
```
Apply "QA Accepted Manual" if it has appeared. Report: `✅ {SNT-NEW-KEY} → QA Accepted Manual (applied after Automation Link created)`

If it is still not available after Step 8, ask `AskUserQuestion` (single-select):
> "`QA Accepted Manual` is not yet available for `{SNT-NEW-KEY}`. The SNT may need to be reviewed by `{PLX_QA_REVIEWER}` first. How do you want to proceed?"
- **I'll get it reviewed — continue the skill and I'll confirm when it's done** → proceed; revisit before Step 9
- **Skip QA Accepted Manual and go straight to QA Accepted Automation** → log as skipped and continue

**Never abort.** Log the outcome and continue regardless of which path is taken.

---

## Step 8 — Create PLXAUTO Story + Link

```
create_issue(
  project="PLXAUTO",
  issueType="Story",
  summary="Automate health check SNTs for {COMPONENT}"
)
```

Record returned key as `PLXAUTO_KEY`. Report: `✅ Created {PLXAUTO_KEY}`

Immediately set assignee (same pattern as SNT in Step 5):
```
update_issue(issueKey="{PLXAUTO_KEY}", assignee="{PLX_USERNAME}")
```

Link the new SNT to the PLXAUTO story using the "Automation Link" relationship:

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
BODY=$(python3 -c "
import json, sys
print(json.dumps({
  'type': {'name': 'Automation Link'},
  'inwardIssue': {'key': sys.argv[1]},
  'outwardIssue': {'key': sys.argv[2]}
}))" "<SNT-NEW-KEY>" "<PLXAUTO_KEY>")
jcurl -X POST -H "Content-Type: application/json" -d "$BODY" \
  "https://track-api.akamai.com/jira/rest/api/2/issueLink"
```

An empty response body means success (HTTP 201). If an error is returned, fetch available link types to confirm the correct name:
```bash
jcurl "https://track-api.akamai.com/jira/rest/api/2/issueLinkType" | python3 -c "
import sys, json
for lt in json.load(sys.stdin).get('issueLinkTypes', []):
    print(lt['id'], lt['name'])
"
```

Report: `✅ Linked {SNT-NEW-KEY} → {PLXAUTO_KEY} (Automation Link)`

---

## Step 9 — Move New SNT to "QA Accepted Automation"

```
get_issue_transitions(issueKey="{SNT-NEW-KEY}")
```
Find transition `"QA Accepted Automation"`. Apply it:
```
transition_issue(issueKey="{SNT-NEW-KEY}", transitionId="<id>")
```
Report: `✅ {SNT-NEW-KEY} → QA Accepted Automation`

---

## Step 10 — Create Local Branch

First, verify the current working directory is the `secpytest` repository:
```bash
git remote -v | grep -q "secpytest" && echo "REPO_OK" || echo "WRONG_REPO"
```

If `WRONG_REPO`:
- Inform the user: "⚠ This skill is not currently running from the `secpytest` repository."
- Search for secpytest on the local machine:
```bash
find ~ -maxdepth 5 -type d -name "secpytest" 2>/dev/null | head -5
```
- Present the findings to the user and ask `AskUserQuestion` (single-select):
  > "Where is your secpytest repository?"
  - For each path found, add it as an option (label: the path, description: "Found on local machine")
  - Always include a final option: **Enter path manually** — "Type the full path to your secpytest clone"
  - If "Enter path manually" is selected, prompt for free text input via `AskUserQuestion` (Other)

- Once a path is confirmed, `cd` into it:
```bash
cd "<confirmed-path>"
git remote -v | grep -q "secpytest" && echo "REPO_CONFIRMED" || echo "STILL_WRONG"
```
- If `STILL_WRONG`: inform the user the path does not appear to be secpytest and ask them to try again (loop back to the path question). Do not abort.
- If `REPO_CONFIRMED`: continue — inform the user "✅ Now running from secpytest at `<confirmed-path>`."

Check for uncommitted work:
```bash
git status --short
```

If uncommitted changes exist, ask `AskUserQuestion` (single-select):
> "Uncommitted changes detected. How do you want to create the branch?"
- **Stash, switch, and unstash** — run `git stash -u`, create branch from master, then `git stash pop` after
- **Use Bitbucket REST API** — create the branch on the remote at master HEAD and push files via mTLS API; no local branch switch or stash needed (recommended when uncommitted work must not be interrupted)

**If stash selected:**
```bash
git stash -u
git checkout master
git pull origin master
git checkout -b {PLXAUTO_KEY}
```
After writing and committing the files in Step 14, run `git stash pop`.

If `git stash -u` fails or `git checkout master` is blocked, do not abort — automatically fall through to the Bitbucket REST API path below and inform the user: "Stash/checkout failed — switching to Bitbucket REST API approach instead."

**If Bitbucket REST API selected (or stash path failed):**

Get master's tip commit:
```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
MASTER_TIP=$(jcurl "https://api.git.source.akamai.com/rest/api/1.0/projects/NS/repos/secpytest/branches?filterText=master&limit=1" \
  | python3 -c "import sys,json; branches=json.load(sys.stdin)['values']; master=[b for b in branches if b['displayId']=='master'][0]; print(master['latestCommit'])")
echo "master tip: $MASTER_TIP"
```

Create the branch on the remote:
```bash
BODY=$(python3 -c "import json; print(json.dumps({'name': '{PLXAUTO_KEY}', 'startPoint': '$MASTER_TIP'}))")
RESP=$(jcurl -X POST -H "Content-Type: application/json" -d "$BODY" \
  "https://api.git.source.akamai.com/rest/api/1.0/projects/NS/repos/secpytest/branches")
echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Created:', d.get('displayId', d))"
```

If branch creation returns an error (e.g. branch already exists or permission denied), do not abort — ask `AskUserQuestion` (single-select):
> "Remote branch creation failed: `{error}`. How do you want to proceed?"
- **The branch already exists — use it** → proceed with the existing remote branch
- **I'll create the branch manually and confirm** → wait for user confirmation, then continue
- **Skip branch creation and continue to code generation** → write files locally only; branch/push can be done manually later

When using the REST API path, **skip the `git add` / `git commit` / `git push` in Step 14** and instead push each file via:
```bash
jcurl -X PUT "https://api.git.source.akamai.com/rest/api/1.0/projects/NS/repos/secpytest/browse/<filepath>" \
  -F "content=<$LOCAL_PATH;type=application/octet-stream" \
  -F "message={PLXAUTO_KEY}: Add health check automation for {COMPONENT}" \
  -F "branch={PLXAUTO_KEY}"
```
An empty or commit-id response means success. Run once per file (constants, __init__.py, test file).

**Never abort at any point in this step.** Always present the user with a forward path.

Report: `✅ Created branch {PLXAUTO_KEY}`

---

## Step 11 — Gather Code Generation Inputs

Check for existing files:
```bash
ls tests/component/{COMPONENT}/ 2>/dev/null || echo "DIR_MISSING"
ls tests/resources/helpers/constants/{component_underscored}_constants.py 2>/dev/null || echo "CONSTANTS_MISSING"
```

If kubectl was already run in Step 4 and the user confirmed the data, **reuse it** — do not ask again for namespace or pod info.

Ask `AskUserQuestion` for any remaining inputs:

**Q1 — Kubernetes namespace** (skip if already known from Step 4):
> "What is the Kubernetes namespace for `{COMPONENT}`? (e.g., `spock-system`, `adam`)"

**Q2 — Pod discovery mode** (single-select):
- **Use KubeConfigGenerator** — auto-discovers pods from namespace at test runtime (preferred for standard-labeled components)
- **Manual pod dict** — I'll specify pod-prefix → label-selector pairs

If manual: ask user to provide entries in format `pod-prefix:label-selector` (one per line, e.g. `spock-monitor:app=spock-monitor`).

---

## Step 12 — Resolve Unknowns + Generate Code

### 12a — Resolve config for all 6 validations

Attempt to resolve required config for each validation from (in order):
1. SNT step text (Step 3)
2. kubectl output (Step 4a)
3. Existing constants files in `tests/resources/helpers/constants/`

**Liveness/Readiness probes** — if exec command, HTTP path, or port is still unknown:

Ask `AskUserQuestion` (single-select):
> "I need liveness/readiness probe configuration for `{COMPONENT}`. How should I get it?"
- **Auto-fetch from kubectl** — run `kubectl get deployment -n {NS} -o jsonpath=...` now
- **Use a sensible default** — exec-based check (`/bin/sh -c "exit 0"`) as placeholder; update manually after
- **I'll provide the values** — enter exec command or HTTP path + port

If "Auto-fetch":
```bash
kubectl --context={KUBE_CTX} get deployment -n {NS} -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .spec.template.spec.containers[*]}  liveness: {.livenessProbe}{"\n"}  readiness: {.readinessProbe}{"\n"}{end}{end}'
```
Show result and confirm with user before using.

**Secure communication (TLS)** — if `https_enabled` or configmap name is unknown:

Ask `AskUserQuestion` (single-select):
> "I need TLS/secure communication config for `{COMPONENT}`. How should I determine it?"
- **Auto-detect from kubectl** — check for TLS configmaps/secrets in the namespace now
- **Assume HTTPS enabled** — set `https_enabled=True`, no configmap validation
- **I'll provide the values** — enter `https_enabled` (True/False) and optional configmap name

If "Auto-detect":
```bash
kubectl --context={KUBE_CTX} get configmap -n {NS} -o json | python3 -c "
import sys, json
cms = json.load(sys.stdin)['items']
for cm in cms:
    name = cm['metadata']['name']
    keys = list(cm.get('data', {}).keys())
    if any(k for k in keys if any(t in k.lower() for t in ['tls','cert','ssl','https'])):
        print(f'TLS configmap: {name}  keys: {keys}')
"
kubectl --context={KUBE_CTX} get secret -n {NS} --field-selector type=kubernetes.io/tls -o name
```
Show result and confirm with user.

### 12b — Write files

**File 0:** `tests/component/{COMPONENT}/__init__.py` — empty file (enables module reuse)

**File 1:** `tests/resources/helpers/constants/{component_underscored}_constants.py`

```python
NAMESPACE = "{NS}"
# Only include PODS if manual pod mode was chosen in Step 11:
# PODS = {
#     "{pod-prefix}": "{label-selector}",
# }
# Add any component-specific constants resolved above:
# LIVENESS_EXEC = "{exec-command-from-12a}"
# TLS_CONFIGMAP = "{configmap-name-from-12a}"
# Component-specific log keywords for secure comms validation (if applicable):
# SECURE_COMM_KEYWORDS = ["{keyword1}", "{keyword2}"]
```

**File 2:** `tests/component/{COMPONENT}/test_health_check_{component_underscored}.py`

Follow this structure (modelled on `test_health_check_spock_monitor.py`). All docstrings must be fully populated with real values from kubectl discovery and Step 12a — no placeholders left in the final output:

```python
import pytest
from tests.resources.helpers.utils.general_helper import with_steps
from tests.resources.helpers.kube.constant_generator import KubeConfigGenerator
# (or: from tests.resources.helpers.generic_health_check.health_model import KubeConfig)
from tests.resources.helpers.constants.{component_underscored}_constants import NAMESPACE
from tests.resources.helpers.generic_health_check.generic_health_check import HealthCheck
from tests.resources.helpers.constants.generic_constants import ELASTIC_SEARCH_URL, PROMETHEUS_URL
# Add imports for liveness/readiness, TLS as needed:
# from tests.resources.helpers.generic_health_check.health_model import Liveness, Readiness, Configmap


class Test{ComponentPascalCase}HealthCheck:

    kube_gen = KubeConfigGenerator(namespace=NAMESPACE)
    kube_config = kube_gen.get_kube_config_from_namespace()
    health_check = HealthCheck()

    # SNT-{SNT_NUMBER} Step 1
    @with_steps([])
    @pytest.mark.parametrize("pod_prefix, label", kube_config.pods.items())
    def test_SNT_{SNT_NUMBER}_application_installation(self, pod_prefix, label, **kwargs):
        """
        Step 1: Verify all {COMPONENT} pods are deployed and in Ready state.
        Expected: All replicas Running with all containers ready; condition=Ready.
        Namespace: {NS} | Label: {DISCOVERED_LABEL}
        """
        step = kwargs['step']
        step(f"Verify all '{pod_prefix}' pods are deployed and in Ready state in namespace {NAMESPACE}")
        self.health_check.verify_application_installation(
            pod_prefix, label, NAMESPACE, api_config=None, api_valuation=False, condition_type="Ready"
        )

    # SNT-{SNT_NUMBER} Step 2
    @with_steps([])
    @pytest.mark.parametrize("pod_prefix", kube_config.pods.keys())
    def test_SNT_{SNT_NUMBER}_application_log_elastic(self, pod_prefix, **kwargs):
        """
        Step 2: Verify pod logs are error-free and indexed in Elasticsearch.
        Expected: No critical errors in pod logs; logs are searchable in Elasticsearch.
        Namespace: {NS} | Pod prefix: {COMPONENT}
        """
        step = kwargs['step']
        step(f"Verify '{pod_prefix}' pod logs are error-free and indexed in Elasticsearch")
        self.health_check.verify_application_logs(
            pod_prefix, NAMESPACE,
            self.kube_config.log_custom_keywords,
            url=ELASTIC_SEARCH_URL,
            check_error=False,
            elastic_search=True,
            since_seconds=None
        )

    # SNT-{SNT_NUMBER} Step 3
    @with_steps([])
    def test_SNT_{SNT_NUMBER}_promethus_metric_validation(self, **kwargs):
        """
        Step 3: Verify Prometheus metrics endpoint is accessible and service monitor is UP.
        Expected: All service monitor targets report UP state and metrics are returned.
        Service monitor: {DISCOVERED_SERVICE_MONITOR} | Port: {DISCOVERED_METRICS_PORT}
        """
        step = kwargs['step']
        step("Verify Prometheus metrics endpoint is accessible and returning metrics for {COMPONENT}")
        assert self.health_check.promethus_validation(PROMETHEUS_URL), \
            f"Error retrieving metrics from {PROMETHEUS_URL}"

    # SNT-{SNT_NUMBER} Step 4
    @with_steps([])
    @pytest.mark.parametrize("pod_prefix", kube_config.pods.keys())
    def test_SNT_{SNT_NUMBER}_application_resources(self, pod_prefix, **kwargs):
        """
        Step 4: Verify {COMPONENT} pod CPU and memory requests/limits are within defined bounds.
        Expected: CPU and memory usage within requested limits; no resource overcommit detected.
        Namespace: {NS}
        """
        step = kwargs['step']
        step(f"Verify '{pod_prefix}' pod CPU and memory resources are within defined limits")
        self.health_check.verify_application_resources(pod_prefix, NAMESPACE)

    # SNT-{SNT_NUMBER} Step 5
    @with_steps([])
    @pytest.mark.parametrize("pod_name, label", kube_config.pods.items())
    def test_SNT_{SNT_NUMBER}_application_liveness_readiness(self, pod_name, label, **kwargs):
        """
        Step 5: Verify liveness and readiness probes are correctly configured for all containers.
        Expected: All probes pass; containers remain Running with no unexpected restarts.
        Liveness: {DISCOVERED_LIVENESS_PROBE}
        Readiness: {DISCOVERED_READINESS_PROBE}
        """
        step = kwargs['step']
        step(f"Verify liveness and readiness probes are correctly configured for '{pod_name}'")
        liveness = Liveness(...)   # filled from Step 12a discovery
        readiness = Readiness(...) # filled from Step 12a discovery
        self.health_check.verify_application_liveness_readiness(
            label, NAMESPACE,
            liveness_data=liveness,
            readiness_data=readiness
        )

    # SNT-{SNT_NUMBER} Step 6
    @with_steps([])
    @pytest.mark.parametrize("pod_prefix", kube_config.pods.keys())
    def test_SNT_{SNT_NUMBER}_application_secure_communication(self, pod_prefix, **kwargs):
        """
        Step 6: Verify {COMPONENT} uses secure communication (TLS/HTTPS or protocol-specific).
        Expected: {DISCOVERED_SECURE_COMMS_DESCRIPTION}
        TLS configmap: {DISCOVERED_TLS_CONFIGMAP} | HTTPS enabled: {True/False}
        """
        step = kwargs['step']
        step(f"Verify '{pod_prefix}' uses secure TLS/HTTPS communication")
        self.health_check.verify_application_secure_communication(
            pod_prefix, NAMESPACE,
            config_map=None,             # replace with Configmap(...) if TLS configmap found in 12a
            https_enabled=True,          # set from 12a
            config_map_validation=False  # set True if configmap found
        )
```

**Docstring rule:** Every placeholder in curly braces (`{NS}`, `{DISCOVERED_LABEL}`, etc.) must be replaced with the real value from kubectl discovery or Step 12a before writing the file. Never leave a placeholder in the final output shown to the user.

Replace `{SNT_NUMBER}` with the numeric part of `{SNT-NEW-KEY}` (e.g., `SNT-99999` → `99999`).
Replace `{ComponentPascalCase}` with PascalCase component name (e.g., `spock-monitor` → `SpockMonitor`).
Replace `{component_underscored}` with snake_case component name (e.g., `spock-monitor` → `spock_monitor`).

Show the user the **full content** of all three generated files. Ask `AskUserQuestion` (single-select):
> "Does this code look correct?"
- **Yes, looks good — run skaffold** → proceed to Step 13
- **I need to edit something first** → pause; user makes edits; ask again

---

## Step 13 — Skaffold Validation (before commit)

### 13a — Colima check

Before touching skaffold, verify Docker is running:
```bash
colima status 2>/dev/null | grep -q "running" && echo "COLIMA_RUNNING" || echo "COLIMA_STOPPED"
```
- **`COLIMA_STOPPED`**: Tell the user "Colima (Docker) is not running — starting it now…", then run `colima start`. Wait for it to finish. If it fails, ask `AskUserQuestion`: "Colima failed to start. Please start Docker manually and confirm when ready." — wait for confirmation before continuing.
- **`COLIMA_RUNNING`**: Proceed silently.

### 13b — Prepare skaffold.yaml

Save the current poc profile values so they can be restored:
```bash
grep -A2 'testFolder\|kubeContext\|cluster:' skaffold.yaml | head -10
```

Edit `skaffold.yaml` poc profile `setValues` — **local only, do NOT stage this file**:
- `testFolder`: `tests/component/{COMPONENT}/test_health_check_{component_underscored}.py`
- `kubeContext`: `spock-dart-nss1-8`
- `cluster`: `spock-dart-nss1-8`

### 13c — Start skaffold (once)

Check if a skaffold dev session is already running for this repo:
```bash
pgrep -f "skaffold dev.*poc" && echo "ALREADY_RUNNING" || echo "NOT_RUNNING"
```

- **`ALREADY_RUNNING`**: Do NOT start a new session. Identify the existing output file (check recent background task outputs). The running session will automatically pick up file changes — no restart needed.
- **`NOT_RUNNING`**: Start skaffold **once** in the background using `Bash` with `run_in_background: true`:
  ```bash
  skaffold dev --tail -p poc --cache-artifacts=false 2>&1
  ```
  Record the output file path returned. **Never start a second skaffold session during this skill run.**

### 13d — Parallel monitor + fix agents

Immediately after confirming skaffold is running, spawn **two agents in a single message** (both `run_in_background: true`):

**Agent 1 — Monitor:**
> "You are monitoring a skaffold dev run for the testplx framework in /Users/sdhal/secpytest.
>
> Output file: `{SKAFFOLD_OUTPUT_FILE}`
>
> Every 30 seconds, read the tail of that file and look for pytest summary lines containing `passed`, `failed`, or `error`. When you detect a complete test run (a line like `N failed, M passed in Xs`), send a message back to the main conversation via SendMessage with:
> - The full pytest summary line
> - A list of any FAILED test names and their error messages (one traceback per test, trimmed to the assertion line)
>
> Keep monitoring until you receive a message telling you to stop, or until a run shows 0 failures."

**Agent 2 — Fix:**
> "You are a pytest test fixer for the testplx framework in /Users/sdhal/secpytest.
>
> Wait for a message from the monitor agent or main conversation containing test failure details. When you receive one:
> 1. Read `tests/component/{COMPONENT}/test_health_check_{component_underscored}.py`
> 2. Read `tests/resources/helpers/constants/{component_underscored}_constants.py`
> 3. Fix **only** the failing test method(s). Do not change passing tests. Do not restart skaffold — it auto-detects file changes.
> 4. Common causes: wrong namespace, wrong label selector, wrong probe exec string or port, missing import, Configmap missing namespace field (use a subclass if needed).
> 5. Report exactly what you changed and why via SendMessage back to the main conversation.
>
> After fixing, wait for the next monitor report. Repeat until told to stop. Maximum 5 fix iterations total."

The main conversation stays live. When monitor or fix agents report back via SendMessage, process their updates and decide next action (accept the fix, escalate to user, etc.).

### 13e — Max iterations fallback

If tests still fail after 5 fix iterations, present the remaining failures clearly and ask `AskUserQuestion` (single-select):
> "Tests still failing after 5 fix attempts. How do you want to proceed?"
- **Document as known infrastructure limitation and continue to PR** → add a NOTE comment to each still-failing test docstring; proceed to Step 13f
- **Try more manual fixes** → describe the fix; apply it; monitor picks up the change
- **Skip skaffold and go straight to draft PR** → proceed to Step 13f without reverting (revert still happens)

### 13f — Post-run gate

Stop the monitor agent (SendMessage: "Stop monitoring"). Revert `skaffold.yaml` to the saved original values.

Report the final run summary: `✅ X passed, Y failed (documented)` or `✅ All N tests passed on spock-dart-nss1-8`.

Ask `AskUserQuestion` (single-select):
> "Skaffold run complete (X passed, Y known failures documented). Would you like to add any additional validations before committing?"
- **No, proceed to commit** → Step 14
- **Yes, describe what to add** → implement the change (skaffold auto-detects if still running); run the monitor cycle again; ask this question again when done

---

## Step 14 — Commit and Push

Ask `AskUserQuestion` (single-select):
> "All tests passed! Ready to commit and push the automation code?"
- **Yes, commit and push** → proceed
- **Not yet — I want to review first** → pause; ask again when user is ready

```bash
git add tests/component/{COMPONENT}/__init__.py \
        tests/component/{COMPONENT}/test_health_check_{component_underscored}.py \
        tests/resources/helpers/constants/{component_underscored}_constants.py
git status
git commit -m "$(cat <<'EOF'
{PLXAUTO_KEY}: Add health check automation for {COMPONENT}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push -u origin {PLXAUTO_KEY}
```

Report: `✅ Pushed branch {PLXAUTO_KEY}`

---

## Step 15 — Create Draft PR

### 15a — Capture skaffold run snippet

Before creating the PR, extract the final pytest summary from the skaffold output file:
```bash
grep -E "PASSED|FAILED|ERROR|passed|failed|error" {SKAFFOLD_OUTPUT_FILE} | tail -20
```
Store this as `SKAFFOLD_SNIPPET`. It will be embedded in the PR description.

### 15b — Build PR description

Compose the description string (store as `PR_DESCRIPTION`):

```
## Summary
- Adds automated health check smoke test for `{COMPONENT}` component
- New SNT: {SNT-NEW-KEY} (QA Accepted Automation)
- Linked PLXAUTO story: {PLXAUTO_KEY}
- All 6 framework validations covered: installation, logs+ES, Prometheus, resources, liveness/readiness, secure comms

## Last skaffold run (`spock-dart-nss1-8`)
```
{SKAFFOLD_SNIPPET}
```
{If any tests are known infrastructure failures, add a note for each, e.g.:
- `test_..._log_elastic`: Elasticsearch endpoint not reachable from POC cluster — validated on QA/SQA}

## Test plan
- [x] Skaffold run on `spock-dart-nss1-8`: X passed, Y documented failures
- [ ] Validate all tests pass on QA/SQA cluster
- [ ] PR reviewed and approved
- [ ] Merged to master
```

### 15c — Create draft PR via jcurl

The Bitbucket MCP `create_pr` tool does not support `draft: true`. Use `jcurl` directly:

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
BODY=$(python3 -c "
import json, sys
print(json.dumps({
  'title': sys.argv[1],
  'description': sys.argv[2],
  'fromRef': {'id': 'refs/heads/' + sys.argv[3], 'repository': {'slug': 'secpytest', 'project': {'key': 'NS'}}},
  'toRef':   {'id': 'refs/heads/master',          'repository': {'slug': 'secpytest', 'project': {'key': 'NS'}}},
  'draft': True
}))" \
  "{PLXAUTO_KEY}: Add health check automation for {COMPONENT}" \
  "$PR_DESCRIPTION" \
  "{PLXAUTO_KEY}")
PR_RESPONSE=$(jcurl -X POST -H "Content-Type: application/json" -d "$BODY" \
  "https://api.git.source.akamai.com/rest/api/1.0/projects/NS/repos/secpytest/pull-requests")
PR_ID=$(echo "$PR_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
PR_URL="https://git.source.akamai.com/projects/NS/repos/secpytest/pull-requests/${PR_ID}"
echo "PR URL: $PR_URL"
```

Store `PR_URL`. Report: `✅ Draft PR #${PR_ID}: {PR_URL}`

Tell the user:
> "✅ Draft PR created: {PR_URL} — review it and click **Ready for review** when you're satisfied."

---

## Step 16 — Move PLXAUTO to Code Review

```
get_issue_transitions(issueKey="{PLXAUTO_KEY}")
```
Find the transition named `"Code Review"` (exact match). Apply it:
```
transition_issue(issueKey="{PLXAUTO_KEY}", transitionId="<id>")
```
If "Code Review" is not found, log `⚠ Could not transition {PLXAUTO_KEY} — "Code Review" not available. Transitions found: {list}` and continue (non-fatal).

Report: `✅ {PLXAUTO_KEY} → Code Review`

---

Present the final completion summary:

```
🎉 Done! Here's what was completed for {COMPONENT}:
- ✅ Created {SNT-NEW-KEY} with N consolidated steps → QA Accepted Automation
- ✅ Closed N template SNTs
- ✅ Created {PLXAUTO_KEY} (assigned to {PLX_USERNAME}) → Code Review
- ✅ Linked {SNT-NEW-KEY} → {PLXAUTO_KEY} (Automation Link)
- ✅ Branch {PLXAUTO_KEY} pushed with 3 files (__init__.py, test file, constants)
- ✅ Skaffold run: X passed, Y documented failures
- ✅ Draft PR #{PR_ID}: {PR_URL}

Review the PR and click "Ready for review" when you're satisfied.
```
