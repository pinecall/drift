/**
 * Unit Tests — ToolRegistry
 * 
 * Tests tool registration, schema generation, filtering, and execution.
 */

import { ToolRegistry } from '../../src/decorators/tool.ts';
import type { ToolDefinition } from '../../src/types.ts';

export const name = 'ToolRegistry';

function makeTool(toolName: string, extra: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
        name: toolName,
        description: `Test tool: ${toolName}`,
        schema: { param: { type: 'string', description: 'test param' } },
        required: ['param'],
        execute: async (params) => ({ success: true, result: `${toolName}:${params.param}` }),
        ...extra,
    };
}

export const tests = {
    'register requires name+desc+schema+execute'(assert: any) {
        const reg = new ToolRegistry();
        const ok = reg.register(makeTool('valid'));
        assert.ok(ok, 'valid tool registered');

        const missing = reg.register({ name: 'bad', description: 'no schema' } as any);
        assert.ok(!missing, 'incomplete tool rejected');
    },

    'getSchemas returns registered tools'(assert: any) {
        const reg = new ToolRegistry();
        reg.register(makeTool('tool_a'));
        reg.register(makeTool('tool_b'));

        const schemas = reg.getSchemas();
        assert.equal(schemas.length, 2);
        assert.ok(schemas.some((s: any) => s.name === 'tool_a'), 'tool_a in schemas');
        assert.ok(schemas.some((s: any) => s.name === 'tool_b'), 'tool_b in schemas');
    },

    'getSchemas produces correct input_schema format'(assert: any) {
        const reg = new ToolRegistry();
        reg.register(makeTool('test'));

        const schemas = reg.getSchemas();
        const schema = schemas[0];
        assert.equal(schema.name, 'test');
        assert.ok(schema.input_schema, 'has input_schema');
        assert.equal(schema.input_schema.type, 'object');
        assert.ok(schema.input_schema.properties.param, 'param in properties');
        assert.deepEqual(schema.input_schema.required, ['param']);
    },

    'allowedTools filter works'(assert: any) {
        const reg = new ToolRegistry();
        reg.register(makeTool('tool_a'));
        reg.register(makeTool('tool_b'));
        reg.setFilters(['tool_a'], null);

        const schemas = reg.getSchemas();
        assert.equal(schemas.length, 1, 'only allowed tool');
        assert.equal(schemas[0].name, 'tool_a');
    },

    'disabledTools filter works'(assert: any) {
        const reg = new ToolRegistry();
        reg.register(makeTool('tool_a'));
        reg.register(makeTool('tool_b'));
        reg.setFilters(null, ['tool_b']);

        const schemas = reg.getSchemas();
        assert.equal(schemas.length, 1, 'disabled tool excluded');
        assert.equal(schemas[0].name, 'tool_a');
    },

    async 'execute calls tool with params'(assert: any) {
        const reg = new ToolRegistry();
        let capturedParams: any = null;
        reg.register(makeTool('spy', {
            execute: async (params) => { capturedParams = params; return { success: true, result: 'ok' }; }
        }));

        await reg.execute('spy', { param: 'test' }, { cwd: '/tmp' });
        assert.ok(capturedParams, 'params captured');
        assert.equal(capturedParams.param, 'test');
    },

    async 'execute throws for unknown tool'(assert: any) {
        const reg = new ToolRegistry();
        let threw = false;
        try {
            await reg.execute('nonexistent', {}, { cwd: '/tmp' });
        } catch (e: any) {
            threw = true;
            assert.ok(e.message.includes('nonexistent'), 'error mentions tool name');
        }
        assert.ok(threw, 'should throw');
    },

    async 'execute validates required params'(assert: any) {
        const reg = new ToolRegistry();
        reg.register(makeTool('strict'));

        let threw = false;
        try {
            await reg.execute('strict', {}, { cwd: '/tmp' }); // missing 'param'
        } catch (e: any) {
            threw = true;
            assert.ok(e.message.includes('param'), 'error mentions param');
        }
        assert.ok(threw, 'should throw for missing required');
    },

    'has/list/size work correctly'(assert: any) {
        const reg = new ToolRegistry();
        reg.register(makeTool('tool_a'));
        reg.register(makeTool('tool_b'));

        assert.ok(reg.has('tool_a'), 'has tool_a');
        assert.ok(!reg.has('tool_c'), 'does not have tool_c');
        assert.equal(reg.size, 2, 'size is 2');
        assert.deepEqual(reg.list().sort(), ['tool_a', 'tool_b']);
    },
};
