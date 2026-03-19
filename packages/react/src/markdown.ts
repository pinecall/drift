/**
 * @drift/react — Lightweight Markdown → HTML parser
 * 
 * Zero dependencies. Handles the markdown you actually use in agent output:
 * headings, bold, italic, lists, code blocks, inline code, links, tables,
 * blockquotes, horizontal rules, and emojis.
 * 
 * Usage:
 *   import { parseMarkdown } from 'drift/react';
 *   const html = parseMarkdown('# Hello **world**');
 */

/**
 * Parse a markdown string into an HTML string.
 * Designed for agent output — handles common patterns, not full CommonMark.
 */
export function parseMarkdown(md: string): string {
    if (!md) return '';

    const lines = md.split('\n');
    const html: string[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeLines: string[] = [];
    let inList: 'ul' | 'ol' | null = null;
    let inTable = false;
    let tableRows: string[][] = [];

    function flushList() {
        if (inList) {
            html.push(`</${inList}>`);
            inList = null;
        }
    }

    function flushTable() {
        if (inTable && tableRows.length > 0) {
            let t = '<div class="drift-md-table-wrap"><table class="drift-md-table">';
            tableRows.forEach((cols, i) => {
                const tag = i === 0 ? 'th' : 'td';
                t += '<tr>' + cols.map(c => `<${tag}>${inlineMarkdown(c.trim())}</${tag}>`).join('') + '</tr>';
            });
            t += '</table></div>';
            html.push(t);
            tableRows = [];
            inTable = false;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code blocks
        if (line.trimStart().startsWith('```')) {
            if (inCodeBlock) {
                html.push(`<pre class="drift-md-code"><code class="language-${esc(codeLanguage)}">${esc(codeLines.join('\n'))}</code></pre>`);
                inCodeBlock = false;
                codeLines = [];
                codeLanguage = '';
            } else {
                flushList();
                flushTable();
                inCodeBlock = true;
                codeLanguage = line.trimStart().slice(3).trim();
            }
            continue;
        }
        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        // Table rows
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            flushList();
            // Skip separator rows (|---|---|)
            if (/^\|[\s\-:]+\|$/.test(line.trim().replace(/\|/g, m => m).replace(/[\s\-:|]/g, ''))) {
                // Separator row — skip but mark table as started
                if (!inTable && tableRows.length > 0) inTable = true;
                continue;
            }
            if (!inTable && tableRows.length === 0) inTable = true;
            const cols = line.trim().slice(1, -1).split('|');
            tableRows.push(cols);
            continue;
        } else {
            flushTable();
        }

        // Empty line
        if (line.trim() === '') {
            flushList();
            continue;
        }

        // Headings
        const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (headingMatch) {
            flushList();
            const level = headingMatch[1].length;
            html.push(`<h${level} class="drift-md-h${level}">${inlineMarkdown(headingMatch[2])}</h${level}>`);
            continue;
        }

        // Horizontal rule
        if (/^[-*_]{3,}\s*$/.test(line.trim())) {
            flushList();
            html.push('<hr class="drift-md-hr" />');
            continue;
        }

        // Blockquote
        if (line.trimStart().startsWith('> ')) {
            flushList();
            html.push(`<blockquote class="drift-md-blockquote">${inlineMarkdown(line.trimStart().slice(2))}</blockquote>`);
            continue;
        }

        // Unordered list
        const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
        if (ulMatch) {
            if (inList !== 'ul') {
                flushList();
                inList = 'ul';
                html.push('<ul class="drift-md-ul">');
            }
            html.push(`<li>${inlineMarkdown(ulMatch[2])}</li>`);
            continue;
        }

        // Ordered list
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olMatch) {
            if (inList !== 'ol') {
                flushList();
                inList = 'ol';
                html.push('<ol class="drift-md-ol">');
            }
            html.push(`<li>${inlineMarkdown(olMatch[2])}</li>`);
            continue;
        }

        // Paragraph
        flushList();
        html.push(`<p class="drift-md-p">${inlineMarkdown(line)}</p>`);
    }

    // Flush remaining
    if (inCodeBlock) {
        html.push(`<pre class="drift-md-code"><code>${esc(codeLines.join('\n'))}</code></pre>`);
    }
    flushList();
    flushTable();

    return html.join('\n');
}

/** Parse inline markdown: bold, italic, code, links, strikethrough */
function inlineMarkdown(text: string): string {
    let out = esc(text);

    // Code (must be first to avoid nested parsing)
    out = out.replace(/`([^`]+)`/g, '<code class="drift-md-inline-code">$1</code>');

    // Bold + italic
    out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    out = out.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Strikethrough
    out = out.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Links
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="drift-md-link" target="_blank" rel="noreferrer">$1</a>');

    return out;
}

/** HTML-escape a string */
function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
