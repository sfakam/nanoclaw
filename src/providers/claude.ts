/**
 * Claude provider container config — only registered when the user has
 * configured a custom Anthropic-compatible endpoint via setup. Setup
 * appends `import './claude.js'` to providers/index.ts at that point;
 * standard installs hitting api.anthropic.com don't need this file
 * loaded.
 *
 * The real auth token never enters the container. Setup creates an
 * OneCLI generic secret (host-pattern = base URL hostname, header-name
 * = Authorization, value-format = "Bearer {value}") so the proxy
 * rewrites the Authorization header on the wire. The container only
 * needs:
 *   - ANTHROPIC_BASE_URL — so the SDK knows where to call
 *   - ANTHROPIC_AUTH_TOKEN=placeholder — so the SDK adds an
 *     Authorization: Bearer header for OneCLI to overwrite
 */
import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

registerProviderContainerConfig('claude', () => {
  const dotenv = readEnvFile([
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_CUSTOM_HEADERS',
    'ANTHROPIC_FOUNDRY_API_KEY',
    'ANTHROPIC_FOUNDRY_BASE_URL',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]);
  const env: Record<string, string> = {};

  // Collect hostnames that must bypass the OneCLI proxy. Enterprise installs
  // route all container HTTPS through OneCLI (host.docker.internal:10255), but
  // OneCLI only injects credentials for hosts it knows about. A custom
  // Anthropic-compatible endpoint (Foundry, Azure, Bedrock, or any corporate
  // gateway) is not registered with OneCLI, so those requests must go direct.
  const noProxyHosts: string[] = [];
  const tryAddHost = (url: string) => {
    try {
      noProxyHosts.push(new URL(url).hostname);
    } catch {
      // malformed URL — skip
    }
  };

  if (dotenv.ANTHROPIC_BASE_URL) {
    env.ANTHROPIC_BASE_URL = dotenv.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_AUTH_TOKEN = 'placeholder';
    tryAddHost(dotenv.ANTHROPIC_BASE_URL);
  }
  if (dotenv.ANTHROPIC_CUSTOM_HEADERS) {
    env.ANTHROPIC_CUSTOM_HEADERS = dotenv.ANTHROPIC_CUSTOM_HEADERS;
  }
  if (dotenv.ANTHROPIC_FOUNDRY_API_KEY) {
    env.ANTHROPIC_FOUNDRY_API_KEY = dotenv.ANTHROPIC_FOUNDRY_API_KEY;
  }
  if (dotenv.ANTHROPIC_FOUNDRY_BASE_URL) {
    env.ANTHROPIC_FOUNDRY_BASE_URL = dotenv.ANTHROPIC_FOUNDRY_BASE_URL;
    tryAddHost(dotenv.ANTHROPIC_FOUNDRY_BASE_URL);
  }
  if (dotenv.CLAUDE_CODE_USE_FOUNDRY) {
    env.CLAUDE_CODE_USE_FOUNDRY = dotenv.CLAUDE_CODE_USE_FOUNDRY;
  }
  if (noProxyHosts.length > 0) {
    env.NO_PROXY = [...new Set(noProxyHosts)].join(',');
    env.no_proxy = env.NO_PROXY;
  }

  return { env };
});
