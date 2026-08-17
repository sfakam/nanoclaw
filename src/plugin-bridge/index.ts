/**
 * Plugin Bridge — host lifecycle integration.
 *
 * Registers start/stop hooks so the bridge starts alongside the Nanoclaw
 * host service and shuts down cleanly on SIGTERM.
 *
 * To enable: add this import to src/modules/index.ts.
 * Container MCP config (per agent group):
 *   ncl groups config add-mcp-server --id <ag-id> \
 *     --name nanoclaw-plugins \
 *     --url http://host.docker.internal:13337/mcp
 */
import path from 'path';

import { onHostStart, onHostShutdown } from '../host-lifecycle.js';
import { log } from '../log.js';
import { loadBridgeConfig, PluginBridgeServer } from './server.js';

let bridge: PluginBridgeServer | null = null;

onHostStart(async () => {
  const projectRoot = process.cwd();
  const config = loadBridgeConfig(projectRoot);

  if (!config) {
    log.debug('Plugin bridge: no plugins/config.json found — skipping');
    return;
  }

  if (!config.servers || config.servers.length === 0) {
    log.debug('Plugin bridge: no servers configured — run scripts/setup-marketplace.ts first');
    return;
  }

  bridge = new PluginBridgeServer(config, projectRoot);
  try {
    await bridge.start();
  } catch (err) {
    log.error('Plugin bridge failed to start', { err });
    bridge = null;
  }
});

onHostShutdown(() => {
  bridge?.stop();
  bridge = null;
});

export function getBridgePort(): number | null {
  const projectRoot = process.cwd();
  const config = loadBridgeConfig(projectRoot);
  return config?.bridge?.port ?? null;
}

export { PluginBridgeServer, loadBridgeConfig };
export type { BridgeServerEntry } from './server.js';

// Expose the active bridge instance for health checks / tests
export function getActiveBridge(): PluginBridgeServer | null {
  return bridge;
}

log.debug('Plugin bridge module loaded', {
  configPath: path.join(process.cwd(), 'plugins', 'config.json'),
});
