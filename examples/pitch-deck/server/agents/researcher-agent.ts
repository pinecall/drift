/**
 * ResearcherAgent — Researches topics for pitch deck slides
 * 
 * Dispatched by trigger when a slide enters 'pending' phase.
 * Saves research data and advances slide to 'writing' phase.
 */

import { Agent, tool } from 'drift';
import { DeckWindow } from '../windows/deck-window.tsx';

export class ResearcherAgent extends Agent {
    model = 'haiku';
    thinking = false;
    effort = 'low' as const;
    maxIterations = 5;

    prompt = `You are a pitch deck researcher. Given a slide topic, you provide key data points, statistics, and insights.

Your research should include:
- 2-3 key statistics or data points (make them realistic and compelling)
- Market context or industry trends
- A compelling angle for the slide

Keep research concise (3-5 bullet points). Focus on facts that support the pitch.

IMPORTANT: After researching, use save_research with the exact slideId provided to you.`;

    constructor() {
        super();
        this.window = new DeckWindow();
    }

    @tool('Save research findings for a slide', {
        slideId: { type: 'string', description: 'The slide ID to save research for' },
        research: { type: 'string', description: 'Research findings (stats, insights, data points)' },
    }, ['slideId', 'research'])
    async save_research({ slideId, research }: { slideId: string; research: string }) {
        const deck = this.window as DeckWindow;
        const slide = deck.get(slideId);
        if (!slide) return { success: false, result: `Slide ${slideId} not found` };

        deck.update(slideId, {
            research,
            agent: undefined,
        });
        deck.logActivity(`🔍 Researcher completed: "${slide.title}"`);

        // Update workspace counters
        if (this.workspace) {
            const slidesResearched = ((this.workspace.state as any).slidesResearched || 0) + 1;
            this.workspace.setState({ slidesResearched } as any);
        }

        return { success: true, result: `Research saved for "${slide.title}". Writer will be dispatched automatically.` };
    }
}

export default ResearcherAgent;
