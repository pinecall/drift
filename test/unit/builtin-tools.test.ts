/**
 * Unit Tests — Built-in Tools Registry
 * 
 * Tests that all 16 built-in tools load and register correctly.
 */

import { ToolRegistry } from '../../packages/drift/src/decorators/tool.ts';
import { registerBuiltinTools, ALL_TOOLS } from '../../packages/drift/src/tools/index.ts';

export const name = 'Built-in Tools';

const EXPECTED_TOOLS = [
    'replace', 'insert_after', 'insert_before',
    'create_file', 'delete_file', 'open_files', 'close_files',
    'find_by_name', 'grep_search', 'list_dir', 'project_tree',
    'shell_execute', 'shell_start', 'shell_read', 'shell_write', 'shell_stop',
];

export const tests = {
    'ALL_TOOLS has all 16 tools'(assert: any) {
        assert.equal(ALL_TOOLS.length, 16, `expected 16, got ${ALL_TOOLS.length}`);
    },

    'registerBuiltinTools registers all'(assert: any) {
        const reg = new ToolRegistry();
        const count = registerBuiltinTools(reg);
        assert.equal(count, 16, `expected 16 registered, got ${count}`);
    },

    'all expected tool names exist'(assert: any) {
        const reg = new ToolRegistry();
        registerBuiltinTools(reg);

        for (const name of EXPECTED_TOOLS) {
            assert.ok(reg.has(name), `tool "${name}" should be registered`);
        }
    },

    'every tool has valid schema'(assert: any) {
        for (const tool of ALL_TOOLS) {
            assert.ok(tool.name, `tool has name`);
            assert.ok(tool.description, `${tool.name} has description`);
            assert.ok(tool.schema, `${tool.name} has schema`);
            assert.ok(typeof tool.execute === 'function', `${tool.name} has execute function`);
        }
    },

    'getSchemas generates valid Claude API format'(assert: any) {
        const reg = new ToolRegistry();
        registerBuiltinTools(reg);
        const schemas = reg.getSchemas();

        assert.equal(schemas.length, 16);
        for (const schema of schemas) {
            assert.ok(schema.name, 'schema has name');
            assert.ok(schema.description, `${schema.name} has description`);
            assert.ok(schema.input_schema, `${schema.name} has input_schema`);
            assert.equal(schema.input_schema.type, 'object', `${schema.name} input_schema is object`);
        }
    },

    'tool names are unique'(assert: any) {
        const names = ALL_TOOLS.map(t => t.name);
        const unique = new Set(names);
        assert.equal(unique.size, names.length, 'all tool names unique');
    },
};
