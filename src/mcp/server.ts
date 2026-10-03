import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import type { SupervisorConfig } from '../contracts.js';
import { registerSupervisorTools, type RunManagerTools } from './tools.js';

export interface McpServerOptions {
  config: SupervisorConfig;
  onError?: (message: string) => void;
}

export function createSupervisorMcpServer(manager: RunManagerTools, options: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: 'vibe-supervisor', version: '0.9.0-rc.1' },
    { capabilities: { tools: {} } },
  );
  registerSupervisorTools(server, manager, {
    maxResultChars: options.config.limits.maxMcpResultChars,
    onError: (error) => options.onError?.(`${error.code}: ${error.message}`),
  });
  return server;
}

/** Start the official MCP SDK stdio service. Only SDK frames go to stdout. */
export function startMcpStdio(manager: RunManagerTools, options: McpServerOptions): StdioServerHandle {
  return serveStdio(() => createSupervisorMcpServer(manager, options), {
    onerror: (error) => options.onError?.(`MCP transport error: ${error.message}`),
  });
}
