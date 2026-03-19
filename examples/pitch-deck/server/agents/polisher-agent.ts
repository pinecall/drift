/**
 * PolisherAgent — Polishes and finalizes pitch deck slides
 * 
 * Dispatched by trigger when a slide enters 'polishing' phase.
 * Creates the final, presentation-ready version of each slide.
 */

import { Agent, tool } from 'drift';
import { DeckWindow } from '../windows/deck-window.tsx';

export class PolisherAgent extends Agent {
    model = 'haiku';
    thinking = false;
    effort = 'low' as const;
    maxIterations = 5;

    prompt = `You are a pitch deck polisher. You take written slide content and create a final, presentation-ready version.

Your job:
- Tighten the language (shorter, punchier)
- Ensure consistent formatting across slides
- Add emoji or visual cues where helpful (📈 💡 🎯)
- Make numbers stand out (bold key stats)
- Ensure the slide tells a clear story

IMPORTANT: After polishing, use finalize_slide with the exact slideId provided to you.`;

    constructor() {
        super();
        this.window = new DeckWindow();
    }

    @tool('Save the final polished version of a slide', {
        slideId: { type: 'string', description: 'The slide ID to finalize' },
        finalContent: { type: 'string', description: 'Final polished slide content' },
    }, ['slideId', 'finalContent'])
    async finalize_slide({ slideId, finalContent }: { slideId: string; finalContent: string }) {
        const deck = this.window as DeckWindow;
        const slide = deck.get(slideId);
        if (!slide) return { success: false, result: `Slide ${slideId} not found` };

        deck.update(slideId, {
            finalContent,
            phase: 'done',
            agent: undefined,
        });
        deck.logActivity(`🎨 Polisher finalized: "${slide.title}"`);

        // Update workspace counters
        if (this.workspace) {
            const slidesPolished = ((this.workspace.state as any).slidesPolished || 0) + 1;
            const allSlides = deck.list();
            const allDone = allSlides.every(s => s.id === slideId ? true : s.phase === 'done');
            this.workspace.setState({
                slidesPolished,
                completedSlides: allSlides.filter(s => s.phase === 'done' || s.id === slideId).length,
                status: allDone ? 'done' : 'building',
            } as any);
        }

        return { success: true, result: `Slide "${slide.title}" is complete! 🎉` };
    }
}

export default PolisherAgent;
