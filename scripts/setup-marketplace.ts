/**
 * setup-marketplace.ts
 *
 * One-time (and repeatable) setup for the Akamai plugin marketplace.
 * Run after cloning the Nanoclaw fork:
 *
 *   pnpm exec tsx scripts/setup-marketplace.ts
 *
 * What it does:
 *   1. Reads PLUGIN_MARKETPLACE_REPO from .env (or prompts for it)
 *   2. Clones / updates the marketplace repo to plugins/marketplace/
 *   3. For each configured plugin (plugins/config.json):
 *      - Copies skill markdown  → container/skills/mp-<plugin>-<skill>/SKILL.md
 *      - Copies agent markdown  → container/skills/mp-agents/SKILL.md (consolidated)
 *      - Collects MCP server entries → plugins/config.json (servers[])
 *   4. Prints the ncl command to register the bridge with an agent group
 *
 * Repeatable: re-run after marketplace updates to pull in new skills/agents.
 * Safe: only writes files inside container/skills/mp-* and plugins/; never
 * touches group files, .env, or data/.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const PROJECT_ROOT = path.resolve(process.cwd());
const MARKETPLACE_DIR = path.join(PROJECT_ROOT, 'plugins', 'marketplace');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'plugins', 'config.json');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'container', 'skills');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

// ── helpers ──────────────────────────────────────────────────────────────────

function readEnv(key: string): string {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eq = trimmed.indexOf('=');
      if (trimmed.slice(0, eq).trim() === key) {
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
  } catch { /* no .env */ }
  return '';
}

function writeEnv(key: string, value: string): void {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { /* create */ }
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith(key + '=') || l.trim().startsWith(`# ${key}`));
  if (idx !== -1) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); }));
}

function run(cmd: string, cwd = PROJECT_ROOT): void {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function runCapture(cmd: string, cwd = PROJECT_ROOT): string {
  return execSync(cmd, { cwd, encoding: 'utf-8' }).trim();
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 4);
  return end === -1 ? md : md.slice(end + 4).trimStart();
}

function readFrontmatter(md: string): Record<string, string> {
  if (!md.startsWith('---')) return {};
  const end = md.indexOf('\n---', 4);
  if (end === -1) return {};
  const yaml = md.slice(4, end);
  const result: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    result[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return result;
}

// ── plugin config types ───────────────────────────────────────────────────────

interface PluginEntry {
  name: string;
  dir: string;
  installMcpServers?: boolean;
  installSkills?: boolean;
  installAgents?: boolean;
}

interface BridgeServerEntry {
  name: string;
  plugin: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface PluginsConfig {
  bridge: { port: number; certsDir: string };
  marketplace: { plugins: PluginEntry[] };
  servers: BridgeServerEntry[];
}

// ── step 1: ensure marketplace repo URL ──────────────────────────────────────

async function ensureRepoUrl(): Promise<string> {
  let repoUrl = readEnv('PLUGIN_MARKETPLACE_REPO');
  if (!repoUrl) {
    console.log('\n─── Plugin Marketplace Setup ───────────────────────────────');
    console.log('Enter the git URL for the plugin marketplace repo.');
    console.log('Example: ssh://git@git.source.akamai.com:7999/ns/infrasec-agentic-plugins.git\n');
    repoUrl = await prompt('Marketplace repo URL: ');
    if (!repoUrl) {
      console.error('No URL provided. Aborting.');
      process.exit(1);
    }
    writeEnv('PLUGIN_MARKETPLACE_REPO', repoUrl);
    console.log('  ✓ Saved to .env');
  }
  return repoUrl;
}

// ── step 2: clone or update marketplace ──────────────────────────────────────

function syncMarketplace(repoUrl: string): void {
  if (fs.existsSync(path.join(MARKETPLACE_DIR, '.git'))) {
    console.log('\n→ Updating marketplace repo...');
    run('git fetch --tags --prune', MARKETPLACE_DIR);
    const defaultBranch = runCapture('git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo main', MARKETPLACE_DIR)
      .replace('origin/', '')
      .trim();
    run(`git checkout ${defaultBranch}`, MARKETPLACE_DIR);
    run(`git pull origin ${defaultBranch}`, MARKETPLACE_DIR);
  } else {
    console.log('\n→ Cloning marketplace repo...');
    fs.mkdirSync(MARKETPLACE_DIR, { recursive: true });
    run(`git clone "${repoUrl}" "${MARKETPLACE_DIR}"`);
  }

  const sha = runCapture('git rev-parse --short HEAD', MARKETPLACE_DIR);
  console.log(`  ✓ Marketplace at ${sha}`);
}

// ── step 3: install container skills from a plugin ───────────────────────────

function installPluginSkills(pluginDir: string, pluginName: string): number {
  const skillsDir = path.join(pluginDir, 'skills');
  if (!fs.existsSync(skillsDir)) return 0;

  let count = 0;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;

    const destDir = path.join(SKILLS_DIR, `mp-${pluginName}-${entry.name}`);
    const destMd = path.join(destDir, 'SKILL.md');
    fs.mkdirSync(destDir, { recursive: true });

    let content = fs.readFileSync(skillMd, 'utf-8');
    // Prepend a note so the agent knows which MCP server to use
    const note = `<!-- Installed from marketplace plugin: ${pluginName}/${entry.name} -->\n` +
      `<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->\n` +
      `<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->\n\n`;
    content = note + content;

    fs.writeFileSync(destMd, content);
    count++;
  }
  return count;
}

// ── step 4: install agent definitions as one consolidated skill ───────────────

function installAgentSkill(pluginDir: string, pluginName: string): number {
  const agentsDir = path.join(pluginDir, 'agents');
  if (!fs.existsSync(agentsDir)) return 0;

  const agents: { name: string; description: string; body: string }[] = [];
  for (const file of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
    const meta = readFrontmatter(content);
    const body = stripFrontmatter(content);
    agents.push({
      name: meta.name || path.basename(file, '.md'),
      description: meta.description || '',
      body,
    });
  }

  if (agents.length === 0) return 0;

  const skillDir = path.join(SKILLS_DIR, `mp-${pluginName}-agents`);
  fs.mkdirSync(skillDir, { recursive: true });

  const agentList = agents.map((a) => `- **${a.name}**: ${a.description}`).join('\n');
  const agentDetails = agents
    .map(
      (a) =>
        `### ${a.name}\n\n${a.description}\n\n` +
        `To use this agent, call the \`delegate_to_agent\` tool from the \`nanoclaw-plugins\` MCP server:\n` +
        `\`delegate_to_agent({ agent_name: "${a.name}", prompt: "<your task>" })\`\n`,
    )
    .join('\n---\n\n');

  const skill = `<!-- Installed from marketplace plugin: ${pluginName}/agents -->\n` +
    `# Specialized Agents (${pluginName})\n\n` +
    `You have access to the following specialized agents via the \`delegate_to_agent\` MCP tool.\n` +
    `Use them by calling \`mcp__nanoclaw-plugins__delegate_to_agent\` with the agent name and prompt.\n\n` +
    `## Available Agents\n\n${agentList}\n\n` +
    `## Agent Details\n\n${agentDetails}\n`;

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill);
  return agents.length;
}

// ── step 5: collect MCP server entries from .mcp.json ────────────────────────

function collectMcpServers(pluginDir: string, pluginName: string): BridgeServerEntry[] {
  const mcpJsonPath = path.join(pluginDir, '.mcp.json');
  if (!fs.existsSync(mcpJsonPath)) return [];

  const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8')) as {
    mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };

  const entries: BridgeServerEntry[] = [];
  for (const [serverName, cfg] of Object.entries(mcpJson.mcpServers ?? {})) {
    // Resolve ${CLAUDE_PLUGIN_ROOT} to the actual plugin directory path (relative to project root)
    const relPluginDir = path.relative(PROJECT_ROOT, pluginDir);
    const resolveArg = (a: string): string =>
      a.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, relPluginDir);

    entries.push({
      name: serverName,
      plugin: pluginName,
      command: resolveArg(cfg.command),
      args: cfg.args.map(resolveArg),
      env: cfg.env,
    });
  }
  return entries;
}

// ── step 6: clean up old mp-* skills that are no longer in the marketplace ───

function cleanStaleSkills(activeSkillDirs: Set<string>): void {
  if (!fs.existsSync(SKILLS_DIR)) return;
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('mp-')) continue;
    if (!activeSkillDirs.has(entry.name)) {
      fs.rmSync(path.join(SKILLS_DIR, entry.name), { recursive: true, force: true });
      console.log(`  ✓ Removed stale skill: ${entry.name}`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Nanoclaw Plugin Marketplace Setup\n');

  // Load current config
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Missing plugins/config.json. Expected at ${CONFIG_PATH}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as PluginsConfig;

  // Step 1: repo URL
  const repoUrl = await ensureRepoUrl();

  // Step 2: clone / update
  syncMarketplace(repoUrl);

  // Step 3-5: process each plugin
  const allServers: BridgeServerEntry[] = [];
  const activeSkillDirs = new Set<string>();
  let totalSkills = 0;
  let totalAgents = 0;

  for (const plugin of config.marketplace.plugins) {
    const pluginDir = path.join(MARKETPLACE_DIR, plugin.dir);
    if (!fs.existsSync(pluginDir)) {
      console.warn(`\n  ⚠ Plugin dir not found: ${plugin.dir} (check config.json or repo structure)`);
      continue;
    }

    console.log(`\n→ Processing plugin: ${plugin.name}`);

    if (plugin.installSkills !== false) {
      const n = installPluginSkills(pluginDir, plugin.name);
      if (n > 0) {
        console.log(`  ✓ ${n} skill(s) installed`);
        totalSkills += n;
        // Track installed skill dirs
        const skillsDir = path.join(pluginDir, 'skills');
        if (fs.existsSync(skillsDir)) {
          for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
            if (d.isDirectory()) activeSkillDirs.add(`mp-${plugin.name}-${d.name}`);
          }
        }
      }
    }

    if (plugin.installAgents) {
      const n = installAgentSkill(pluginDir, plugin.name);
      if (n > 0) {
        console.log(`  ✓ ${n} agent(s) available via delegate_to_agent`);
        totalAgents += n;
        activeSkillDirs.add(`mp-${plugin.name}-agents`);
      }
    }

    if (plugin.installMcpServers !== false) {
      const servers = collectMcpServers(pluginDir, plugin.name);
      allServers.push(...servers);
      if (servers.length > 0) console.log(`  ✓ ${servers.length} MCP server(s) configured`);
    }
  }

  // Remove stale skills from prior installs
  cleanStaleSkills(activeSkillDirs);

  // Write updated config with resolved server entries
  config.servers = allServers;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log('\n  ✓ plugins/config.json updated with server entries');

  // Summary
  console.log('\n─── Setup Complete ─────────────────────────────────────────');
  console.log(`  Skills installed : ${totalSkills}`);
  console.log(`  Agents available : ${totalAgents}`);
  console.log(`  MCP servers      : ${allServers.length}`);
  console.log(`  Bridge port      : ${config.bridge.port}`);

  if (allServers.length > 0) {
    console.log('\n─── Next Steps ─────────────────────────────────────────────');
    console.log('1. Import the plugin bridge in src/modules/index.ts:');
    console.log("     import '../plugin-bridge/index.js';");
    console.log('\n2. Rebuild and restart:');
    console.log('     pnpm run build');
    console.log('     systemctl --user restart nanoclaw-*.service');
    console.log('\n3. Register the MCP server with an agent group:');
    console.log('     ncl groups config add-mcp-server --id <agent-group-id> \\');
    console.log('       --name nanoclaw-plugins \\');
    console.log('       --url http://host.docker.internal:' + String(config.bridge.port) + '/mcp');
    console.log('\n4. Verify bridge health:');
    console.log('     curl http://localhost:' + String(config.bridge.port) + '/health');
    console.log('\n5. Commit the installed skills and updated config:');
    console.log('     git add container/skills/mp-* plugins/config.json');
    console.log('     git commit -m "chore: install marketplace plugins"');
  } else {
    console.log('\n  No MCP servers found — container skills only.');
    console.log('  Commit the installed skills:');
    console.log('    git add container/skills/mp-* && git commit -m "chore: install marketplace skills"');
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
