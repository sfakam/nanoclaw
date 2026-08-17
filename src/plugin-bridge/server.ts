/**
 * Plugin Bridge — MCP Streamable HTTP server.
 *
 * Spawns marketplace MCP servers as stdio subprocesses, aggregates their
 * tools, and exposes everything via a single HTTP endpoint that the Nanoclaw
 * agent container can connect to as `type: "http"`.
 *
 * Container MCP config:
 *   { "nanoclaw-plugins": { "type": "http", "url": "http://host.docker.internal:13337/mcp" } }
 *
 * Tool naming: upstream tools are exposed with their original names. If two
 * servers declare a tool with the same name the second is prefixed
 * `<server>__<tool>` and a warning is logged.
 */
import fs from 'fs';
import https from 'https';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import os from 'os';
import path from 'path';

import { log } from '../log.js';
import { McpStdioClient, type McpTool } from './mcp-client.js';

export interface BridgeServerEntry {
  name: string;
  plugin: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface BridgeConfig {
  bridge: { port: number; certsDir: string };
  servers: BridgeServerEntry[];
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Resolve ~ in paths */
function resolvePath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Strip YAML frontmatter, return body only */
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 4);
  return end === -1 ? md : md.slice(end + 4).trimStart();
}

export class PluginBridgeServer {
  private clients: McpStdioClient[] = [];
  private toolRouter = new Map<string, McpStdioClient>(); // tool name → client
  private allTools: McpTool[] = [];
  private server: http.Server | null = null;
  private marketplaceDir: string;
  private agentDefs = new Map<string, string>(); // agent name → system prompt

  constructor(
    private readonly config: BridgeConfig,
    private readonly projectRoot: string,
  ) {
    this.marketplaceDir = path.join(projectRoot, 'plugins', 'marketplace');
  }

  async start(): Promise<void> {
    await this.spawnServers();
    this.loadAgentDefs();
    this.startHttp();
    log.info('Plugin bridge started', {
      port: this.config.bridge.port,
      servers: this.clients.length,
      tools: this.allTools.length,
      agents: this.agentDefs.size,
    });
  }

  private async spawnServers(): Promise<void> {
    const certsDir = resolvePath(this.config.bridge.certsDir || '~/.certs');

    for (const entry of this.config.servers) {
      const commandPath = path.isAbsolute(entry.command) ? entry.command : path.join(this.projectRoot, entry.command);

      // Resolve relative paths in args
      const args = entry.args.map((a) =>
        !path.isAbsolute(a) && (a.endsWith('.sh') || a.includes('/servers/') || a.includes('/scripts/'))
          ? path.join(this.projectRoot, a)
          : a,
      );

      const env: Record<string, string> = {
        ...(entry.env ?? {}),
        CERTS_DIR: certsDir,
        CERT_DIR: certsDir,
      };

      if (fs.existsSync(certsDir)) {
        const certFile = path.join(certsDir, 'client.crt');
        const keyFile = path.join(certsDir, 'client.key');
        const caFile = path.join(certsDir, 'ca.crt');
        if (fs.existsSync(certFile)) env.CLIENT_CERT = certFile;
        if (fs.existsSync(keyFile)) env.CLIENT_KEY = keyFile;
        if (fs.existsSync(caFile)) env.CA_CERT = caFile;
      }

      const client = new McpStdioClient(entry.name, commandPath, args, env);
      try {
        await client.initialize();
        const tools = await client.discoverTools();
        this.registerClientTools(client, tools);
        this.clients.push(client);
        log.info('Plugin MCP server ready', { server: entry.name, tools: tools.length });
      } catch (err) {
        log.warn('Plugin MCP server failed to start — skipping', { server: entry.name, err });
        client.destroy();
      }
    }
  }

  private registerClientTools(client: McpStdioClient, tools: McpTool[]): void {
    for (const tool of tools) {
      if (this.toolRouter.has(tool.name)) {
        // Collision — prefix with server name
        const prefixed = `${client.name}__${tool.name}`;
        log.warn('Tool name collision — exposing with server prefix', {
          tool: tool.name,
          server: client.name,
          as: prefixed,
        });
        this.toolRouter.set(prefixed, client);
        this.allTools.push({ ...tool, name: prefixed });
      } else {
        this.toolRouter.set(tool.name, client);
        this.allTools.push(tool);
      }
    }
  }

  private loadAgentDefs(): void {
    const { config } = this;
    for (const pluginCfg of config.servers.length > 0 ? [] : []) void pluginCfg; // no-op if no marketplace
    // Walk marketplace/<plugin>/agents/*.md
    if (!fs.existsSync(this.marketplaceDir)) return;
    for (const entry of fs.readdirSync(this.marketplaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const agentsDir = path.join(this.marketplaceDir, entry.name, 'agents');
      if (!fs.existsSync(agentsDir)) continue;
      for (const agentFile of fs.readdirSync(agentsDir)) {
        if (!agentFile.endsWith('.md')) continue;
        const name = path.basename(agentFile, '.md');
        const content = fs.readFileSync(path.join(agentsDir, agentFile), 'utf-8');
        this.agentDefs.set(name, stripFrontmatter(content));
      }
    }
    if (this.agentDefs.size > 0) {
      log.info('Plugin agents loaded', { count: this.agentDefs.size, names: [...this.agentDefs.keys()].join(', ') });
    }
  }

  private startHttp(): void {
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    this.server.listen(this.config.bridge.port, '0.0.0.0');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tools: this.allTools.length, agents: this.agentDefs.size }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;

    let rpc: JsonRpcRequest;
    try {
      rpc = JSON.parse(body) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      return;
    }

    const response = await this.dispatch(rpc);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(response));
  }

  private async dispatch(rpc: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = rpc.id ?? null;

    try {
      switch (rpc.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'nanoclaw-plugin-bridge', version: '1.0.0' },
            },
          };

        case 'notifications/initialized':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { tools: [...this.allTools, ...this.delegateAgentToolDef()] },
          };

        case 'tools/call': {
          const params = rpc.params as { name: string; arguments: Record<string, unknown> };
          const result = await this.callTool(params.name, params.arguments ?? {});
          return { jsonrpc: '2.0', id, result };
        }

        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${rpc.method}` } };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (name === 'delegate_to_agent') {
      const text = await this.delegateToAgent(
        args.agent_name as string,
        args.prompt as string,
        (args.context as string | undefined) ?? '',
      );
      return { content: [{ type: 'text', text }] };
    }

    const client = this.toolRouter.get(name);
    if (!client) throw new Error(`Tool not found: ${name}`);
    const result = (await client.callTool(name, args)) as { content?: { type: string; text: string }[] };
    return { content: result.content ?? [{ type: 'text', text: JSON.stringify(result) }] };
  }

  private delegateAgentToolDef(): McpTool[] {
    if (this.agentDefs.size === 0) return [];
    const agentList = [...this.agentDefs.keys()].join(', ');
    return [
      {
        name: 'delegate_to_agent',
        description: `Delegate a task to a specialized agent. Available agents: ${agentList}`,
        inputSchema: {
          type: 'object',
          properties: {
            agent_name: {
              type: 'string',
              description: `Name of the agent to delegate to. One of: ${agentList}`,
              enum: [...this.agentDefs.keys()],
            },
            prompt: { type: 'string', description: 'The task or question for the agent' },
            context: { type: 'string', description: 'Optional extra context (diff, file contents, etc.)' },
          },
          required: ['agent_name', 'prompt'],
        },
      },
    ];
  }

  private async delegateToAgent(agentName: string, prompt: string, context: string): Promise<string> {
    const systemPrompt = this.agentDefs.get(agentName);
    if (!systemPrompt) throw new Error(`Agent not found: ${agentName}`);

    const { readEnvFile } = await import('../env.js');
    const env = readEnvFile(['ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_API_KEY']);
    const baseUrl = env.ANTHROPIC_FOUNDRY_BASE_URL || 'https://api.anthropic.com';
    const apiKey = env.ANTHROPIC_FOUNDRY_API_KEY || env.ANTHROPIC_API_KEY || '';

    const userContent = context ? `${prompt}\n\n---\n${context}` : prompt;
    const payload = {
      model: 'claude-sonnet-5-20251001',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    };

    return new Promise((resolve, reject) => {
      const url = new URL('/v1/messages', baseUrl);
      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
        } as Record<string, string>,
      };

      const body = JSON.stringify(payload);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as {
              content?: { type: string; text: string }[];
              error?: { message: string };
            };
            if (parsed.error) {
              reject(new Error(parsed.error.message));
              return;
            }
            const text = parsed.content?.find((c) => c.type === 'text')?.text ?? '';
            resolve(text);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  stop(): void {
    this.server?.close();
    for (const client of this.clients) client.destroy();
    this.clients = [];
    this.toolRouter.clear();
    this.allTools = [];
  }
}

export function loadBridgeConfig(projectRoot: string): BridgeConfig | null {
  const configPath = path.join(projectRoot, 'plugins', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as BridgeConfig;
  } catch {
    return null;
  }
}
