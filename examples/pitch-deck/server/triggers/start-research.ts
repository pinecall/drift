/**
 * StartResearchTrigger — Dispatches researcher when slides enter 'pending' phase
 * 
 * Staggered: each slide gets a small delay based on its order so research
 * dispatches appear sequentially in the UI (not all at once).
 */

import { Trigger } from 'drift';

export class StartResearchTrigger extends Trigger {
    watch = 'window' as const;
    cooldown = 0;
    field = 'phase';

    on = {
        'pending': async (event: any) => {
            const slide = event.item;
            if (!slide?.id || !slide?.brief) return;

            // Stagger start by slide order so they don't all fire at once
            const delay = ((slide.order || 1) - 1) * 2000;  // 0s, 2s, 4s, 6s
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            }

            // Mark as researching
            this.window?.update(slide.id, { phase: 'researching', agent: 'researcher' });

            await this.dispatch('researcher-agent',
                `Research for pitch deck slide "${slide.title}": ${slide.brief}
                 
Use save_research with slideId "${slide.id}" to save your findings. Keep it to 3-4 bullet points.`,
                { streamTo: { itemId: slide.id, field: 'research' } }
            );

            // Advance phase AFTER researcher completes
            this.window?.update(slide.id, { phase: 'writing' });
        },
    };
}

export default StartResearchTrigger;
