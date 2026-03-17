/**
 * Unit Tests — JSX Runtime
 * 
 * Tests the custom JSX-to-string runtime used by Window render().
 */

import { jsx, jsxs, Fragment, render } from '../../packages/drift/src/jsx-runtime.ts';

export const name = 'JSX Runtime';

// Helper: classic createElement-style call
function h(tag: any, props: any, ...children: any[]) {
    return jsx(tag, props, ...children);
}

export const tests = {
    'renders text element without wrapper'(assert: any) {
        const el = h('text', null, 'hello');
        assert.equal(render(el), 'hello');
    },

    'renders line with trailing newline'(assert: any) {
        const el = h('line', null, 'hello world');
        assert.equal(render(el), 'hello world\n');
    },

    'renders br as newline'(assert: any) {
        assert.equal(render(h('br', null)), '\n');
    },

    'renders hr as horizontal rule'(assert: any) {
        assert.equal(render(h('hr', null)), '─'.repeat(40) + '\n');
    },

    'window with name wraps in named XML tags'(assert: any) {
        const el = h('window', { name: 'portfolio' }, h('text', null, 'content'));
        const result = render(el);
        assert.ok(result.startsWith('<portfolio>'), 'starts with <portfolio>');
        assert.ok(result.endsWith('</portfolio>'), 'ends with </portfolio>');
        assert.ok(result.includes('content'), 'includes content');
    },

    'window without name defaults to <window>'(assert: any) {
        const el = h('window', null, h('text', null, 'test'));
        const result = render(el);
        assert.ok(result.startsWith('<window>'));
        assert.ok(result.endsWith('</window>'));
    },

    'section with title renders titled header'(assert: any) {
        const el = h('section', { title: 'Stats' }, h('text', null, 'data'));
        const result = render(el);
        assert.ok(result.startsWith('── Stats ──'), 'starts with section header');
        assert.ok(result.includes('data'), 'includes content');
    },

    'Fragment renders children without wrapper'(assert: any) {
        const el = h(Fragment, null,
            h('line', null, 'line1'),
            h('line', null, 'line2'),
        );
        assert.equal(render(el), 'line1\nline2\n');
    },

    'nested elements render correctly'(assert: any) {
        const el = h('window', { name: 'test' },
            h('line', null, 'header'),
            h('br', null),
            h('line', null, 'body'),
        );
        const result = render(el);
        assert.ok(result.includes('<test>'));
        assert.ok(result.includes('header'));
        assert.ok(result.includes('body'));
        assert.ok(result.includes('</test>'));
    },

    'handles number children'(assert: any) {
        const el = h('line', null, 'count: ', 42);
        assert.equal(render(el), 'count: 42\n');
    },

    'handles null and undefined children'(assert: any) {
        const el = h('text', null, 'a', null, 'b', undefined, 'c');
        assert.equal(render(el), 'abc');
    },

    'handles boolean children (filtered out)'(assert: any) {
        const el = h('text', null, 'visible', false, true, 'end');
        assert.equal(render(el), 'visibleend');
    },

    'handles array children from .map()'(assert: any) {
        const items = ['a', 'b', 'c'];
        const el = h('text', null,
            items.map(i => h('line', null, i))
        );
        assert.equal(render(el), 'a\nb\nc\n');
    },

    'unknown tags render as XML'(assert: any) {
        const el = h('custom-tag', null, h('text', null, 'inner'));
        const result = render(el);
        assert.ok(result.startsWith('<custom-tag>'));
        assert.ok(result.endsWith('</custom-tag>'));
    },

    'empty unknown tag renders as self-closing'(assert: any) {
        assert.equal(render(h('marker', null)), '<marker />');
    },

    'render() with plain string returns string'(assert: any) {
        assert.equal(render('hello'), 'hello');
    },

    'render() with null returns empty string'(assert: any) {
        assert.equal(render(null), '');
    },

    'conditional rendering with && operator'(assert: any) {
        const show = true;
        const el = h('text', null,
            show && h('line', null, 'shown'),
            !show && h('line', null, 'hidden'),
        );
        assert.equal(render(el), 'shown\n');
    },

    'full integration: realistic window render'(assert: any) {
        const tasks = [
            { id: 't1', title: 'Task A', status: 'todo' },
            { id: 't2', title: 'Task B', status: 'done' },
        ];

        const el = h('window', { name: 'task-board' },
            h('line', null, `Total: ${tasks.length} tasks`),
            h('br', null),
            ...tasks.map(t =>
                h('line', null, `  - [${t.id}] ${t.title} (${t.status})`)
            ),
        );

        const result = render(el);
        assert.ok(result.includes('<task-board>'));
        assert.ok(result.includes('Total: 2 tasks'));
        assert.ok(result.includes('- [t1] Task A (todo)'));
        assert.ok(result.includes('- [t2] Task B (done)'));
        assert.ok(result.includes('</task-board>'));
    },

    'jsxs is alias for jsx'(assert: any) {
        assert.equal(jsxs, jsx);
    },

    'supports automatic-style call with children in props'(assert: any) {
        // Automatic JSX runtime passes children inside props
        const el = jsx('line', { children: 'auto-mode' });
        assert.equal(render(el), 'auto-mode\n');
    },

    'automatic-style with array children in props'(assert: any) {
        const el = jsx('text', { children: ['a', 'b', 'c'] });
        assert.equal(render(el), 'abc');
    },
};
