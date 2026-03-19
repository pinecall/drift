/**
 * StartPolishTrigger — Dispatches polisher when slides enter 'polishing' phase
 * 
 * Final phase trigger. After polishing, the slide is marked 'done'.
 */

import { Trigger } from 'drift';

export class StartPolishTrigger extends Trigger {
    watch = 'window' as const;
    cooldown = 0;
    field = 'phase';

    on = {
        'polishing': async (event: any) => {
            const slide = event.item;
            if (!slide?.id || !slide?.content) return;

            this.window?.update(slide.id, { agent: 'polisher' });

            await this.dispatch('polisher-agent',
                `Polish and finalize pitch deck slide "${slide.title}".

Written content:
${slide.content}

Research context:
${slide.research}

Use finalize_slide with slideId "${slide.id}" to save the polished version.`,
                { streamTo: { itemId: slide.id, field: 'finalContent' } }
            );

            // Advance phase AFTER polisher completes
            this.window?.update(slide.id, { phase: 'done' });

            // Check if all slides are done
            if (this.workspace) {
                const allSlides = this.window?.list() || [];
                const allDone = allSlides.every((s: any) => s.phase === 'done');
                const completedSlides = allSlides.filter((s: any) => s.phase === 'done').length;
                this.workspace.setState({
                    completedSlides,
                    status: allDone ? 'done' : 'building',
                } as any);
            }
        },
    };
}

export default StartPolishTrigger;
