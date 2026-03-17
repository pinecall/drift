/**
 * Example: Decorator Showcase
 * 
 * A DevOps agent that uses @tool decorators extensively.
 * Shows: multiple tools, typed params, required vs optional,
 * tool context, inheritance, and error handling.
 * 
 * Run: node --import tsx examples/02-custom-tools.ts
 */

import { Agent, tool } from '../packages/drift/src/index.ts';

// ── Base agent with shared tools ──

class BaseDevAgent extends Agent {
    model = 'haiku';
    thinking = false;
    maxIterations = 5;

    // Shared infrastructure tool — inherited by all subclasses
    @tool('Check if a service is healthy', {
        url: { type: 'string', description: 'URL to check' },
    })
    async healthCheck({ url }: { url: string }) {
        const status = Math.random() > 0.2 ? 'healthy' : 'degraded';
        const latency = Math.floor(Math.random() * 200) + 10;
        return {
            success: true,
            result: `${url} → ${status} (${latency}ms)`,
        };
    }
}

// ── Specialized agent that inherits + adds its own tools ──

class DeployAgent extends BaseDevAgent {
    prompt = `You are a DevOps deployment agent. You can:
- Check service health with healthCheck
- List deployments with listDeploys  
- Deploy services with deploy
- Rollback with rollback

When asked to deploy, always check health first, then deploy, then verify health again.
Be concise in your responses.`;

    private deployHistory: Array<{ service: string; version: string; ts: number }> = [];

    @tool('List recent deployments', {
        service: { type: 'string', description: 'Filter by service name (optional)' },
    }, []) // No required params — service is optional
    async listDeploys({ service }: { service?: string }) {
        let deploys = this.deployHistory;
        if (service) {
            deploys = deploys.filter(d => d.service === service);
        }

        if (deploys.length === 0) {
            return { success: true, result: 'No deployments found.' };
        }

        const list = deploys
            .map(d => `${d.service}@${d.version} (${new Date(d.ts).toLocaleTimeString()})`)
            .join('\n');
        return { success: true, result: `Recent deploys:\n${list}` };
    }

    @tool('Deploy a service to production', {
        service: { type: 'string', description: 'Service name to deploy' },
        version: { type: 'string', description: 'Version tag to deploy' },
        force: { type: 'boolean', description: 'Skip pre-deploy checks' },
    }, ['service', 'version']) // force is optional
    async deploy({ service, version, force }: { service: string; version: string; force?: boolean }) {
        // Simulate deployment
        await new Promise(r => setTimeout(r, 100));

        this.deployHistory.push({ service, version, ts: Date.now() });

        return {
            success: true,
            result: `✅ Deployed ${service}@${version} to production${force ? ' (forced)' : ''}`,
        };
    }

    @tool('Rollback a service to previous version', {
        service: { type: 'string', description: 'Service to rollback' },
    })
    async rollback({ service }: { service: string }) {
        const deploys = this.deployHistory.filter(d => d.service === service);
        if (deploys.length < 2) {
            return { success: false, result: `No previous version found for ${service}` };
        }

        const previous = deploys[deploys.length - 2];
        this.deployHistory.push({ service, version: previous.version, ts: Date.now() });

        return {
            success: true,
            result: `↩️ Rolled back ${service} to ${previous.version}`,
        };
    }
}

// ── Run it ──

const agent = new DeployAgent();

// Track all tool calls
agent.on('tool:execute', ({ name, params }: any) => {
    console.log(`\n  🔧 ${name}(${JSON.stringify(params)})`);
});
agent.on('tool:result', ({ name, result, ms }: any) => {
    console.log(`     → ${result.result} [${ms}ms]`);
});

console.log('🚀 Deploy Agent — Decorator Showcase\n');
console.log('Available tools:', agent.tools.list().filter(t =>
    ['healthCheck', 'listDeploys', 'deploy', 'rollback'].includes(t)
));

const result = await agent.run(
    'Deploy the api-gateway service version v2.4.1. Check health before and after.'
);

console.log('\n📝 Agent response:');
console.log(result.text);
console.log(`\n📊 ${result.toolCalls.length} tool calls | $${result.cost.toFixed(6)} | ${result.duration}ms`);
