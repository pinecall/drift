/**
 * WriterAgent — Writes pitch deck slide content
 * 
 * Dispatched by trigger when a slide enters 'writing' phase.
 * Uses research data to write compelling slide content.
 */

import { Agent, tool } from 'drift';
import { DeckWindow } from '../windows/deck-window.tsx';

export class WriterAgent extends Agent {
    model = 'haiku';
    thinking = false;
    effort = 'low' as const;
    maxIterations = 5;

    prompt = `You are a pitch deck writer. You write compelling, concise slide content for investor presentations.

Guidelines:
- 3-5 bullet points per slide maximum
- Use strong, action-oriented language
- Include specific numbers from the research
- Keep each bullet under 15 words
- End with a key takeaway or call to action when appropriate

IMPORTANT: After writing, use save_content with the exact slideId provided to you.`;

    constructor() {
        super();
        this.window = new DeckWindow();
    }

    @tool('Save written content for a slide', {
        slideId: { type: 'string', description: 'The slide ID to save content for' },
        content: { type: 'string', description: 'Written slide content (bullet points)' },
    }, ['slideId', 'content'])
    async save_content({ slideId, content }: { slideId: string; content: string }) {
        const deck = this.window as DeckWindow;
        const slide = deck.get(slideId);
        if (!slide) return { success: false, result: `Slide ${slideId} not found` };

        deck.update(slideId, {
            content,
            agent: undefined,
        });
        deck.logActivity(`✍️ Writer completed: "${slide.title}"`);

        // Update workspace counters
        if (this.workspace) {
            const slidesWritten = ((this.workspace.state as any).slidesWritten || 0) + 1;
            this.workspace.setState({ slidesWritten } as any);
        }

        return { success: true, result: `Content saved for "${slide.title}". Polisher will be dispatched automatically.` };
    }
}

export default WriterAgent;
