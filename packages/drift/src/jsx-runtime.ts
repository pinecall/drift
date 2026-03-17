/**
 * Drift — Custom JSX Runtime
 * 
 * Renders JSX to strings for agent system prompts.
 * Not React — a lightweight (~60 lines) string renderer.
 * 
 * Usage in .tsx files:
 *   return <window name="portfolio"><text>Balance: {balance}</text></window>
 *   // → "<portfolio>\nBalance: 100000\n</portfolio>"
 * 
 * Special tags:
 *   <window name="x">  → <x>\n...\n</x>      (named XML wrapper)
 *   <section title="x"> → ── x ──\n...        (titled section)
 *   <text>              → renders children as-is (no wrapping tag)
 *   <line>              → children joined, followed by newline
 *   <br />              → newline
 *   <hr />              → ────────────────────────────────────────
 *   Other tags          → <tag>\n...\n</tag>
 */

// ── Types ──

type Child = string | number | boolean | null | undefined | Child[];

interface Element {
    __drift_jsx: true;
    tag: string | typeof Fragment;
    props: Record<string, any>;
    children: Child[];
}

// ── Fragment ──

export const Fragment = Symbol('Fragment');

// ── JSX Factory (automatic runtime) ──

export function jsx(tag: string | typeof Fragment, props: Record<string, any> | null, ...rest: Child[]): Element {
    const { children: propsChildren, ...restProps } = props || {} as any;
    // Support both classic (tag, props, child1, child2) and automatic (tag, { children })
    let childArr: Child[];
    if (rest.length > 0) {
        childArr = rest;
    } else if (propsChildren != null) {
        childArr = Array.isArray(propsChildren) ? propsChildren : [propsChildren];
    } else {
        childArr = [];
    }
    return { __drift_jsx: true, tag, props: restProps, children: childArr };
}

export { jsx as jsxs };

// ── Renderer ──

function renderChild(child: Child): string {
    if (child == null || child === false || child === true) return '';
    if (typeof child === 'string') return child;
    if (typeof child === 'number') return String(child);
    if (Array.isArray(child)) return child.map(renderChild).filter(Boolean).join('');
    if (typeof child === 'object' && '__drift_jsx' in child) return renderElement(child as Element);
    return String(child);
}

function renderChildren(children: Child[]): string {
    return children.map(renderChild).filter(s => s !== '').join('');
}

function renderElement(el: Element): string {
    const { tag, props, children } = el;

    // Fragment — just render children
    if (tag === Fragment) {
        return renderChildren(children);
    }

    const content = renderChildren(children);

    switch (tag) {
        // <window name="portfolio"> → <portfolio>\n...\n</portfolio>
        case 'window': {
            const name = props.name || 'window';
            return `<${name}>\n${content}\n</${name}>`;
        }

        // <section title="Stats"> → ── Stats ──\n...
        case 'section': {
            const title = props.title || '';
            return `── ${title} ──\n${content}`;
        }

        // <text> → just the content, no wrapping
        case 'text':
            return content;

        // <line> → content + newline
        case 'line':
            return content + '\n';

        // <br /> → newline
        case 'br':
            return '\n';

        // <hr /> → horizontal rule
        case 'hr':
            return '─'.repeat(40) + '\n';

        // Any other tag → <tag>\n...\n</tag>
        default:
            return content ? `<${tag}>\n${content}\n</${tag}>` : `<${tag} />`;
    }
}

// ── Public render function ──

export function render(element: any): string {
    if (typeof element === 'string') return element;
    if (element && element.__drift_jsx) return renderElement(element);
    return String(element ?? '');
}

// ── JSX namespace for TypeScript ──

export namespace JSX {
    export interface IntrinsicElements {
        [tag: string]: any;
    }
    export interface Element {
        __drift_jsx: true;
        tag: string | symbol;
        props: Record<string, any>;
        children: any[];
    }
    export interface ElementChildrenAttribute {
        children: {};
    }
}
