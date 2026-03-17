/**
 * Agent Factory — Creates minimal Haiku agents for integration tests
 * 
 * Direct instantiation of Drift Agent for testing.
 * Uses Haiku for cheap, fast API calls (~$0.001 per test).
 */

import { Agent } from '../../packages/drift/src/core/agent.ts';
import type { AgentOptions } from '../../packages/drift/src/types.ts';

interface TestAgentOptions {
    cwd?: string;
    tools?: string[];
    prompt?: string;
    thinking?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'max';
}

/**
 * Create a minimal Haiku agent for integration tests.
 */
export function createTestAgent(options: TestAgentOptions = {}) {
    const agentOptions: AgentOptions = {
        model: 'haiku',
        maxTokens: 4096,
        maxIterations: 1,
        thinking: options.thinking ?? false,
        effort: options.effort || 'low',
        prompt: options.prompt || 'You are a test agent. Follow instructions exactly. Be concise. Do not explain.',
        cwd: options.cwd || '/tmp/drift-test',
    };

    if (options.tools) {
        agentOptions.allowedTools = options.tools;
    }

    const agent = new Agent(agentOptions);
    return { agent };
}

/**
 * Collect all events emitted by an agent during run().
 */
export function collectEvents(agent: Agent) {
    const events: Array<{ type: string; data: any; ts: number }> = [];

    const eventTypes = [
        'thinking:start', 'thinking:delta',
        'text:start', 'text:delta',
        'tool:start_stream', 'tool:execute', 'tool:result',
        'cost', 'error', 'response:end',
    ];

    for (const type of eventTypes) {
        agent.on(type, (data: any) => {
            events.push({ type, data, ts: Date.now() });
        });
    }

    return {
        getEvents: () => events,
        ofType: (type: string) => events.filter(e => e.type === type),
        has: (type: string) => events.some(e => e.type === type),
        first: (type: string) => events.find(e => e.type === type),
        indexOf: (type: string) => events.findIndex(e => e.type === type),
    };
}
