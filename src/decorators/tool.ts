/**
 * Drift — @tool decorator + ToolRegistry
 * 
 * Usage:
 *   @tool('Description', { param: { type: 'string', description: '...' } })
 *   async myMethod(params) { ... }
 * 
 * JS fallback:
 *   MyAgent.defineTool('myMethod', 'Description', { ... });
 */

import type { ToolSchema, ToolDefinition, ToolResult, ToolContext } from '../types.ts';

// ── Metadata key for decorated tools ──

const TOOL_METADATA_KEY = Symbol('drift:tools');

interface ToolMeta {
    methodName: string;
    description: string;
    schema: ToolSchema;
    required: string[];
}

/**
 * @tool decorator — marks a class method as an agent tool.
 * 
 * Supports both TC39 stage-3 decorators (tsx/Node 22) and
 * legacy experimentalDecorators (tsc). Detection is automatic.
 * 
 * @param description - Human-readable description of what the tool does
 * @param schema - Parameter schema { paramName: { type, description } }
 * @param required - Optional list of required params (defaults to all params)
 */
export function tool(
    description: string,
    schema: ToolSchema,
    required?: string[]
): any {
    // TC39 stage-3 decorator: (value, context) => replacement | void
    // Legacy decorator: (target, propertyKey, descriptor) => void
    return function (...args: any[]) {
        if (args.length === 2 && typeof args[1] === 'object' && args[1] !== null && 'name' in args[1] && 'kind' in args[1]) {
            // TC39 stage-3 decorator
            const [_value, context] = args;
            const methodName = String(context.name);
            const meta: ToolMeta = { methodName, description, schema, required: required ?? Object.keys(schema) };

            context.addInitializer(function (this: any) {
                const proto = Object.getPrototypeOf(this);
                const existing: ToolMeta[] = proto[TOOL_METADATA_KEY] ?? [];
                if (!existing.some(m => m.methodName === methodName)) {
                    proto[TOOL_METADATA_KEY] = [...existing, meta];
                }
            });
        } else {
            // Legacy experimentalDecorators
            const [target, propertyKey] = args;
            const methodName = String(propertyKey);
            const meta: ToolMeta = { methodName, description, schema, required: required ?? Object.keys(schema) };

            const existing: ToolMeta[] = (target as any)[TOOL_METADATA_KEY] ?? [];
            (target as any)[TOOL_METADATA_KEY] = [...existing, meta];
        }
    };
}

/**
 * Get all @tool metadata from a class prototype chain.
 */
export function getToolMetadata(prototype: any): ToolMeta[] {
    const tools: ToolMeta[] = [];
    const seen = new Set<string>();

    let current = prototype;
    while (current && current !== Object.prototype) {
        const meta: ToolMeta[] = current[TOOL_METADATA_KEY] ?? [];
        
        for (const t of meta) {
            if (!seen.has(t.methodName)) {
                seen.add(t.methodName);
                tools.push(t);
            }
        }
        current = Object.getPrototypeOf(current);
    }

    return tools;
}

// ── ToolRegistry ─────────────────────────────────────

export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();
    private allowedTools: string[] | null = null;
    private disabledTools: string[] | null = null;

    /**
     * Register a tool definition.
     */
    register(tool: ToolDefinition): boolean {
        if (tool.name && tool.description && tool.schema && typeof tool.execute === 'function') {
            this.tools.set(tool.name, tool);
            return true;
        }
        return false;
    }

    /**
     * Register all @tool-decorated methods from an agent instance.
     */
    registerDecoratedTools(instance: any): number {
        const proto = Object.getPrototypeOf(instance);
        if (!proto) return 0;
        const meta = getToolMetadata(proto);
        let count = 0;

        for (const t of meta) {
            const method = instance[t.methodName];
            if (typeof method !== 'function') continue;

            this.register({
                name: t.methodName,
                description: t.description,
                schema: t.schema,
                required: t.required,
                execute: (params: Record<string, any>, ctx: ToolContext) => {
                    return method.call(instance, params, ctx);
                },
            });
            count++;
        }

        return count;
    }

    /**
     * Set tool filters.
     */
    setFilters(allowed: string[] | null, disabled: string[] | null): void {
        this.allowedTools = allowed;
        this.disabledTools = disabled;
    }

    /**
     * Get tool schemas for Claude API.
     */
    getSchemas(): any[] {
        const schemas: any[] = [];

        for (const [name, tool] of this.tools) {
            if (this.allowedTools && !this.allowedTools.includes(name)) continue;
            if (this.disabledTools && this.disabledTools.includes(name)) continue;

            let inputSchema: any;
            if ((tool.schema as any).type === 'object' && (tool.schema as any).properties) {
                inputSchema = tool.schema;
            } else {
                inputSchema = {
                    type: 'object',
                    properties: tool.schema,
                    required: tool.required || [],
                };
            }

            schemas.push({
                name: tool.name,
                description: tool.description,
                input_schema: inputSchema,
            });
        }

        return schemas;
    }

    /**
     * Execute a tool by name.
     */
    async execute(toolName: string, params: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
        const tool = this.tools.get(toolName);
        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }

        // Validate required params
        if (tool.required) {
            for (const field of tool.required) {
                if (params[field] === undefined || params[field] === null) {
                    throw new Error(`Missing required parameter: ${field}`);
                }
            }
        }

        return tool.execute(params, ctx);
    }

    /**
     * Check if a tool is registered.
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * List all tool names.
     */
    list(): string[] {
        return [...this.tools.keys()];
    }

    /**
     * Get tool count.
     */
    get size(): number {
        return this.tools.size;
    }
}

/**
 * Static defineTool — for JS users without decorator support.
 * Stores metadata on the class prototype for later collection.
 */
export function defineTool(
    ctor: any,
    methodName: string,
    description: string,
    schema: ToolSchema,
    required?: string[]
): void {
    const prototype = ctor.prototype;
    const existing: ToolMeta[] = prototype[TOOL_METADATA_KEY] ?? [];
    
    prototype[TOOL_METADATA_KEY] = [...existing, {
        methodName,
        description,
        schema,
        required: required ?? Object.keys(schema),
    }];
}
