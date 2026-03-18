/**
 * board_add_comment — Append context/comment to a card
 */

import type { ToolDefinition } from '../../types.ts';

const boardAddComment: ToolDefinition = {
    name: 'board_add_comment',
    description: 'Add a comment or context note to a card. Comments accumulate and are visible to agents that work on this card or dependent cards.',

    schema: {
        cardId: { type: 'string', description: 'The card ID to comment on' },
        comment: { type: 'string', description: 'The comment text to append' },
    },
    required: ['cardId', 'comment'],

    async execute(params, ctx) {
        if (!ctx.taskboard) {
            return { success: false, result: 'No TaskBoard available.' };
        }

        const card = ctx.taskboard.get(params.cardId);
        if (!card) {
            return { success: false, result: `Card "${params.cardId}" not found.` };
        }

        ctx.taskboard.appendContext(params.cardId, params.comment);

        return {
            success: true,
            result: `✅ Comment added to "${card.title}" [${card.id}]`,
        };
    },
};

export default boardAddComment;
