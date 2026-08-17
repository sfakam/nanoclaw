/**
 * Minimal MCP stdio client — no SDK dependency.
 * Speaks newline-delimited JSON-RPC over stdin/stdout with a subprocess.
 */
import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';

import { log } from '../log.js';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class McpStdioClient {
  readonly name: string;
  private proc: ChildProcess;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private _tools: McpTool[] = [];
  private dead = false;

  constructor(name: string, command: string, args: string[], env: Record<string, string> = {}) {
    this.name = name;
    this.proc = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as {
          id?: number;
          result?: unknown;
          error?: { message: string; code?: number };
        };
        if (msg.id === undefined) return; // notification — ignore
        const pend = this.pending.get(msg.id);
        if (!pend) return;
        this.pending.delete(msg.id);
        if (msg.error) pend.reject(new Error(`MCP[${name}] ${msg.error.message}`));
        else pend.resolve(msg.result);
      } catch {
        // unparseable line — ignore
      }
    });

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log.debug(`MCP[${name}] stderr: ${text}`);
    });

    this.proc.on('exit', (code) => {
      this.dead = true;
      log.warn(`MCP server exited`, { server: name, code });
      for (const [, pend] of this.pending) pend.reject(new Error(`MCP[${name}] process exited`));
      this.pending.clear();
    });

    // Without this, spawn errors (e.g. ENOENT) emit an unhandled 'error' event
    // and crash the host process. The error is surfaced to callers via pending rejects.
    this.proc.on('error', (err) => {
      this.dead = true;
      log.warn(`MCP server spawn error`, { server: name, err: err.message });
      for (const [, pend] of this.pending) pend.reject(err);
      this.pending.clear();
    });
  }

  private send(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error(`MCP[${this.name}] process is not running`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP[${this.name}] timeout: ${method}`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const line = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin!.write(line);
    });
  }

  private notify(method: string, params: unknown): void {
    const line = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.proc.stdin!.write(line);
  }

  async initialize(): Promise<void> {
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'nanoclaw-plugin-bridge', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
  }

  async discoverTools(): Promise<McpTool[]> {
    const result = (await this.send('tools/list', {})) as { tools?: McpTool[] };
    this._tools = result.tools ?? [];
    return this._tools;
  }

  get tools(): McpTool[] {
    return this._tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.send('tools/call', { name, arguments: args }, 60_000);
  }

  destroy(): void {
    this.dead = true;
    this.proc.kill();
  }
}
