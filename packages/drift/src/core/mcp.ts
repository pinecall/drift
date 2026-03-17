/**
 * Drift — MCP Client
 * 
 * Connects to MCP servers via stdio (subprocess) or HTTP (Streamable HTTP).
 * Discovers tools and converts them to Drift ToolDefinition format.
 * 
 * Usage:
 *   const mcp = new MCP();
 *   await mcp.connect('playwright', { command: 'npx', args: ['-y', '@playwright/mcp@latest'] });
 *   await mcp.connect('api', { url: 'http://localhost:4000/mcp' });
 *   
 *   // Register all MCP tools with an agent's registry
 *   mcp.registerTools('playwright', registry);
 *   
 *   await mcp.disconnect('playwright');
 *   await mcp.disconnectAll();
 */

import type { ToolDefinition } from '../types.ts';

// Server connection state
interface ServerEntry {
    client: any;
    transport: any;
    tools: ToolDefinition[];
    config: MCPServerConfig;
    type: 'stdio' | 'http' | 'sse';
    connectedAt: number;
}

export interface MCPServerConfig {
    /** Command for stdio transport (e.g. 'npx') */
    command?: string;
    /** Args for stdio transport */
    args?: string[];
    /** Environment variables (stdio only) */
    env?: Record<string, string>;
    /** URL for HTTP/SSE transport */
    url?: string;
    /** Force transport type: 'stdio' | 'http' | 'sse' */
    transport?: 'stdio' | 'http' | 'sse';
    /** Extra HTTP headers (http/sse only) */
    headers?: Record<string, string>;
}

export class MCP {
    private _servers = new Map<string, ServerEntry>();

    // ── Transport Detection ────────────────────────────

    private _detectTransport(config: MCPServerConfig): 'stdio' | 'http' | 'sse' {
        if (config.command) return 'stdio';
        if (config.url && config.transport === 'sse') return 'sse';
        if (config.url) return 'http';
        throw new Error('Invalid MCP config: need either "command" (stdio) or "url" (http/sse)');
    }

    private async _createTransport(config: MCPServerConfig) {
        const type = this._detectTransport(config);

        if (type === 'stdio') {
            const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
            return {
                type,
                transport: new StdioClientTransport({
                    command: config.command!,
                    args: config.args || [],
                    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
                    stderr: 'pipe' as const,
                }),
            };
        }

        if (type === 'sse') {
            const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
            return {
                type,
                transport: new SSEClientTransport(new URL(config.url!), {
                    requestInit: config.headers ? { headers: config.headers } : undefined,
                }),
            };
        }

        // http (Streamable HTTP)
        const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        return {
            type: 'http' as const,
            transport: new StreamableHTTPClientTransport(new URL(config.url!), {
                requestInit: config.headers ? { headers: config.headers } : undefined,
            }),
        };
    }

    // ── Connect / Disconnect ───────────────────────────

    /**
     * Connect to an MCP server.
     * Returns the list of discovered tool names.
     */
    async connect(name: string, config: MCPServerConfig): Promise<string[]> {
        // Disconnect existing with same name
        if (this._servers.has(name)) {
            await this.disconnect(name);
        }

        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { type, transport } = await this._createTransport(config);

        const client = new Client({ name: `drift-${name}`, version: '1.0.0' });
        await client.connect(transport);

        // Discover tools
        const { tools: mcpTools } = await client.listTools();

        // Convert to Drift ToolDefinition format
        const tools: ToolDefinition[] = mcpTools.map((mcpTool: any) =>
            this._convertTool(name, client, mcpTool)
        );

        this._servers.set(name, {
            client,
            transport,
            tools,
            config,
            type,
            connectedAt: Date.now(),
        });

        return tools.map(t => t.name);
    }

    /** Disconnect a specific server */
    async disconnect(name: string): Promise<void> {
        const server = this._servers.get(name);
        if (!server) return;

        try { await server.client.close(); } catch { /* best effort */ }
        try { await server.transport.close(); } catch { /* best effort */ }
        this._servers.delete(name);
    }

    /** Disconnect all servers */
    async disconnectAll(): Promise<void> {
        for (const name of [...this._servers.keys()]) {
            await this.disconnect(name);
        }
    }

    // ── Tool Access ────────────────────────────────────

    /** Get Drift-format tools for a specific server */
    getTools(name: string): ToolDefinition[] {
        return this._servers.get(name)?.tools || [];
    }

    /** Get all tools from all connected servers */
    getAllTools(): ToolDefinition[] {
        const tools: ToolDefinition[] = [];
        for (const server of this._servers.values()) {
            tools.push(...server.tools);
        }
        return tools;
    }

    /** Check if a server is connected */
    isConnected(name: string): boolean {
        return this._servers.has(name);
    }

    /** List connected server names */
    listServers(): string[] {
        return [...this._servers.keys()];
    }

    /** Server info */
    getServerInfo(name: string) {
        const server = this._servers.get(name);
        if (!server) return null;
        return {
            name,
            type: server.type,
            toolCount: server.tools.length,
            tools: server.tools.map(t => t.name),
            connectedAt: server.connectedAt,
        };
    }

    // ── Tool Conversion ────────────────────────────────

    /**
     * Convert an MCP tool to Drift ToolDefinition format.
     * 
     * MCP: { name, description, inputSchema: { type, properties, required } }
     * Drift: { name, description, schema, required, execute }
     */
    private _convertTool(serverName: string, client: any, mcpTool: any): ToolDefinition {
        const schema = mcpTool.inputSchema?.properties || {};
        const required = mcpTool.inputSchema?.required || [];

        return {
            name: mcpTool.name,
            description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
            schema,
            required,

            async execute(params: Record<string, any>) {
                const result = await client.callTool({
                    name: mcpTool.name,
                    arguments: params,
                });

                // MCP returns { content: [{ type, text?, data?, mimeType? }], isError? }
                if (result.isError) {
                    const errorText = (result.content || [])
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n') || 'MCP tool error';
                    return { success: false, result: errorText };
                }

                // Format content for LLM consumption
                const parts: string[] = [];
                for (const content of (result.content || [])) {
                    if (content.type === 'text') parts.push(content.text);
                    else if (content.type === 'image') parts.push(`[Image: ${content.mimeType || 'image/png'}]`);
                    else if (content.type === 'resource') parts.push(`[Resource: ${content.resource?.uri || 'unknown'}]`);
                }

                return { success: true, result: parts.join('\n') || 'OK' };
            },
        };
    }
}
