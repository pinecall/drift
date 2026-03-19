/**
 * StartWritingTrigger — Dispatches writer when slides enter 'writing' phase
 * 
 * Fires after research is complete. Includes the research data in the dispatch.
 */

import { Trigger } from 'drift';

export class StartWritingTrigger extends Trigger {
    watch = 'window' as const;
    cooldown = 0;
    field = 'phase';

    on = {
        'writing': async (event: any) => {
            const slide = event.item;
            if (!slide?.id || !slide?.research) return;

            this.window?.update(slide.id, { agent: 'writer' });

            await this.dispatch('writer-agent',
                `Write content for pitch deck slide "${slide.title}".

Research findings:
${slide.research}

Brief: ${slide.brief}

Use save_content with slideId "${slide.id}" to save your written content.`,
                { streamTo: { itemId: slide.id, field: 'content' } }
            );
        },
    };
}

export default StartWritingTrigger;
