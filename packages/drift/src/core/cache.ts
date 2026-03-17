/**
 * Drift — Cache (Anthropic prompt caching)
 * 
 * Maps directly to Anthropic's cache_control API.
 * Adds { cache_control: { type: 'ephemeral' } } breakpoints
 * to system prompt blocks and tool schemas.
 * 
 * How Anthropic caching works:
 *   - Breakpoints mark the END of a cacheable prefix
 *   - The API caches everything from the start up to each breakpoint
 *   - Cache TTL: 5 minutes (refreshed on each hit)
 *   - Cache reads cost 90% less than fresh input tokens
 *   - Cache writes cost 25% more than fresh input tokens
 *   - Only prefix-matched content is cached (order matters)
 * 
 * Optimal breakpoint placement:
 *   1. System prompt (most static — cached across all turns)
 *   2. Tool schemas (static across turns — on the last tool)
 *   3. Conversation prefix (older turns rarely change)
 */

export class Cache {
    /** Cache the system prompt block */
    prompt: boolean;

    /** Cache tool schemas (last tool gets the breakpoint) */
    tools: boolean;

    constructor(options: { prompt?: boolean; tools?: boolean } = {}) {
        this.prompt = options.prompt ?? true;
        this.tools = options.tools ?? true;
    }

    // ── Apply Breakpoints ───────────────────────────────

    /**
     * Apply cache breakpoint to system prompt blocks.
     * Marks the last block with cache_control for prefix caching.
     */
    applyToSystem(blocks: any[]): any[] {
        if (!this.prompt || blocks.length === 0) return blocks;

        // Clone and add breakpoint to last block
        const result = blocks.map((b, i) => {
            if (i === blocks.length - 1) {
                return { ...b, cache_control: { type: 'ephemeral' } };
            }
            return b;
        });

        return result;
    }

    /**
     * Apply cache breakpoint to tool schemas.
     * Marks the last tool with cache_control for prefix caching.
     * Mutates in place (tools array is built fresh each turn).
     */
    applyToTools(tools: any[]): any[] {
        if (!this.tools || tools.length === 0) return tools;

        tools[tools.length - 1].cache_control = { type: 'ephemeral' };
        return tools;
    }

    // ── Info ─────────────────────────────────────────────

    /**
     * Summary of what's being cached.
     */
    toString(): string {
        const parts: string[] = [];
        if (this.prompt) parts.push('prompt');
        if (this.tools) parts.push('tools');
        return parts.length > 0 ? `Cache(${parts.join(', ')})` : 'Cache(disabled)';
    }
}
