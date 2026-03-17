/**
 * Unit Tests — @tool Decorator
 * 
 * Tests decorator metadata storage, prototype chain traversal, and inheritance.
 * Note: TC39 stage-3 decorators require instance construction for addInitializer to run,
 * so we construct instances before checking metadata.
 */

import { tool, getToolMetadata, ToolRegistry, defineTool } from '../../packages/drift/src/decorators/tool.ts';

export const name = 'Tool Decorator';

export const tests = {
    '@tool stores metadata on prototype'(assert: any) {
        class TestAgent {
            @tool('Test tool', { x: { type: 'string', description: 'input' } })
            async myTool({ x }: { x: string }) {
                return { success: true, result: x };
            }
        }

        // TC39 decorators require construction for addInitializer to run
        new TestAgent();
        const meta = getToolMetadata(TestAgent.prototype);
        assert.equal(meta.length, 1, 'one tool registered');
        assert.equal(meta[0].methodName, 'myTool');
        assert.equal(meta[0].description, 'Test tool');
        assert.deepEqual(meta[0].required, ['x']);
    },

    '@tool supports multiple tools on same class'(assert: any) {
        class MultiAgent {
            @tool('Tool A', { a: { type: 'string', description: 'a' } })
            async toolA() { return { success: true, result: 'a' }; }

            @tool('Tool B', { b: { type: 'number', description: 'b' } })
            async toolB() { return { success: true, result: 'b' }; }
        }

        new MultiAgent();
        const meta = getToolMetadata(MultiAgent.prototype);
        assert.equal(meta.length, 2, 'two tools registered');
        const names = meta.map((m: any) => m.methodName);
        assert.ok(names.includes('toolA'), 'toolA present');
        assert.ok(names.includes('toolB'), 'toolB present');
    },

    '@tool inherits from parent class'(assert: any) {
        class ParentAgent {
            @tool('Parent tool', { x: { type: 'string', description: '' } })
            async parentTool() { return { success: true, result: '' }; }
        }

        class ChildAgent extends ParentAgent {
            @tool('Child tool', { y: { type: 'string', description: '' } })
            async childTool() { return { success: true, result: '' }; }
        }

        new ChildAgent();
        const meta = getToolMetadata(ChildAgent.prototype);
        assert.gte(meta.length, 2, 'child sees both tools');
        const names = meta.map((m: any) => m.methodName);
        assert.ok(names.includes('parentTool'), 'parent tool inherited');
        assert.ok(names.includes('childTool'), 'child tool present');
    },

    '@tool custom required list'(assert: any) {
        class Agent {
            @tool('Optional params', {
                required: { type: 'string', description: 'needed' },
                optional: { type: 'string', description: 'not needed' },
            }, ['required'])
            async myTool() { return { success: true, result: '' }; }
        }

        new Agent();
        const meta = getToolMetadata(Agent.prototype);
        assert.ok(meta.length > 0, 'tool registered');
        assert.deepEqual(meta[0].required, ['required'], 'custom required list');
    },

    'defineTool JS fallback works'(assert: any) {
        class JSAgent {
            async myMethod() { return { success: true, result: 'js' }; }
        }

        defineTool(JSAgent, 'myMethod', 'JS tool', {
            param: { type: 'string', description: 'test' },
        });

        const meta = getToolMetadata(JSAgent.prototype);
        assert.equal(meta.length, 1, 'one tool from defineTool');
        assert.equal(meta[0].methodName, 'myMethod');
        assert.equal(meta[0].description, 'JS tool');
    },

    'registerDecoratedTools collects from instance'(assert: any) {
        class AgentWithTools {
            @tool('My tool', { x: { type: 'string', description: 'param' } })
            async myTool(params: any) { return { success: true, result: params.x }; }
        }

        const instance = new AgentWithTools();
        const registry = new ToolRegistry();
        const count = registry.registerDecoratedTools(instance);
        assert.equal(count, 1, 'one tool registered');
        assert.ok(registry.has('myTool'), 'myTool in registry');
    },
};
