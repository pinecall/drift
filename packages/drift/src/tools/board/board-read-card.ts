/**
 * board_read_card — Read full details of a specific card
 */

import type { ToolDefinition } from '../../types.ts';

const boardReadCard: ToolDefinition = {
    name: 'board_read_card',
    description: 'Read full details of a card: title, description, column, assignee, dependencies, context, result, and files in its window.',

    schema: {
        cardId: { type: 'string', description: 'The card ID to read' },
    },
    required: ['cardId'],

    async execute(params, ctx) {
        if (!ctx.taskboard) {
            return { success: false, result: 'No TaskBoard available.' };
        }

        const card = ctx.taskboard.get(params.cardId);
        if (!card) {
            return { success: false, result: `Card "${params.cardId}" not found.` };
        }

        const lines: string[] = [];
        lines.push(`📋 Card: ${card.title} [${card.id}]`);
        lines.push(`   Column: ${card.column}`);
        lines.push(`   Priority: ${card.priority ?? 3}`);
        if (card.assignee) lines.push(`   Assignee: ${card.assignee}`);
        if (card.labels?.length) lines.push(`   Labels: ${card.labels.join(', ')}`);
        if (card.dependsOn?.length) {
            const blocked = ctx.taskboard.isBlocked(card.id);
            lines.push(`   Dependencies: ${card.dependsOn.join(', ')} ${blocked ? '(BLOCKED)' : '(satisfied)'}`);
        }
        if (card.description) lines.push(`\n   Description:\n   ${card.description}`);
        if (card.context) lines.push(`\n   Context:\n   ${card.context}`);
        if (card.result) lines.push(`\n   Result:\n   ${card.result}`);

        // Show window files if available
        if (card.window && card.window.list().length > 0) {
            const files = card.window.list().map((f: any) => `     • ${f.id} (${f.lines} lines)`);
            lines.push(`\n   Window files (${files.length}):\n${files.join('\n')}`);
        }

        return { success: true, result: lines.join('\n') };
    },
};

export default boardReadCard;
