/**
 * board_move_card — Move a card to a different column
 */

import type { ToolDefinition } from '../../types.ts';

const boardMoveCard: ToolDefinition = {
    name: 'board_move_card',
    description: 'Move a card to a different column. Valid columns: todo, in_progress, in_review, qa, done. Moving to "done" auto-unblocks dependent cards.',

    schema: {
        cardId: { type: 'string', description: 'The card ID to move' },
        column: { type: 'string', description: 'Target column: todo | in_progress | in_review | qa | done' },
    },
    required: ['cardId', 'column'],

    async execute(params, ctx) {
        if (!ctx.taskboard) {
            return { success: false, result: 'No TaskBoard available.' };
        }

        const card = ctx.taskboard.get(params.cardId);
        if (!card) {
            return { success: false, result: `Card "${params.cardId}" not found.` };
        }

        const validColumns = ctx.taskboard._state?.columns || ['todo', 'in_progress', 'in_review', 'qa', 'done'];
        if (!validColumns.includes(params.column)) {
            return { success: false, result: `Invalid column "${params.column}". Valid: ${validColumns.join(', ')}` };
        }

        const from = card.column;
        ctx.taskboard.moveCard(params.cardId, params.column);

        return {
            success: true,
            result: `✅ Moved "${card.title}" [${card.id}]: ${from} → ${params.column}`,
        };
    },
};

export default boardMoveCard;
