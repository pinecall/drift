/**
 * PlannerAgent — Pitch Deck Coordinator
 * 
 * Uses create_slide individually so each card appears immediately in the UI
 * as the planner generates it. Much better perceived speed.
 * Triggers handle research → write → polish in parallel per slide.
 */

import { Agent, tool } from 'drift';
import { DeckWindow, type Slide } from '../windows/deck-window.tsx';

export class PlannerAgent extends Agent {
    model = 'haiku';
    thinking = false;
    effort = 'low' as const;
    maxIterations = 10;
    parallelToolCalls = false;  // One create_slide per turn → cards appear one by one
    windows = ['stats'];

    prompt = `You are a pitch deck planner. When given a topic, create slides using create_slide.

RULES:
- Call create_slide once per slide, one at a time
- If the user asks for N slides, create exactly N slides. If they don't specify, use 4.
- Do NOT ask clarifying questions — start creating slides immediately
- Typical slides: Problem, Solution, Market, Business Model, Traction, Team
- After ALL slides are created, give a very brief 1-line summary

IMPORTANT: Call create_slide for each slide separately. Do NOT try to batch them.`;

    constructor() {
        super();
        this.window = new DeckWindow();
    }

    private get deck(): DeckWindow {
        return this.window as DeckWindow;
    }

    @tool('Create a single pitch deck slide', {
        topic: { type: 'string', description: 'The overall business/startup topic' },
        title: { type: 'string', description: 'The slide title (e.g. Problem, Solution, Market)' },
        brief: { type: 'string', description: 'One sentence about what this slide covers' },
    }, ['topic', 'title', 'brief'])
    async create_slide({ topic, title, brief }: { topic: string; title: string; brief: string }) {
        const order = this.deck.size + 1;  // Always based on current items
        const id = `slide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const slide: Slide = {
            id,
            title,
            brief,
            phase: 'pending',
            order,
        };

        this.deck.add(id, slide);
        this.deck.logActivity(`📋 Planner created slide ${order}: "${title}"`);

        // Update workspace on first slide
        if (order === 1 && this.workspace) {
            this.workspace.setState({
                topic,
                totalSlides: 0,
                status: 'building',
                startedAt: Date.now(),
            } as any);
        }

        return {
            success: true,
            result: `Created slide ${order}: "${title}". Research agent will be dispatched automatically.`,
        };
    }
}

export default PlannerAgent;
