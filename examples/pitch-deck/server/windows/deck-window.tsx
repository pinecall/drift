/** @jsx jsx */
/** @jsxFrag Fragment */
/**
 * DeckWindow — Shared window for pitch deck slides
 * 
 * Each slide is an item that progresses through phases:
 *   pending → researching → writing → polishing → done
 * 
 * All slides are processed in parallel via triggers.
 */

import { Window, type WindowItem, render } from 'drift';
import { jsx, Fragment } from 'drift/jsx-runtime';

export interface Slide extends WindowItem {
    id: string;
    title: string;           // "Problem", "Solution", "Market Size"
    brief: string;           // what this slide should cover
    phase: 'pending' | 'researching' | 'writing' | 'polishing' | 'done';
    research?: string;       // output from researcher
    content?: string;        // output from writer
    finalContent?: string;   // output from polisher
    agent?: string;          // who's working on it right now
    order: number;           // slide position
}

export interface DeckState {
    topic: string;
    totalSlides: number;
    completedSlides: number;
    activity: string[];
}

export class DeckWindow extends Window<Slide, DeckState> {
    constructor() {
        super({ topic: '', totalSlides: 0, completedSlides: 0, activity: [] });
    }

    /** Log for both UI (state.activity) and agent system prompt (window.log) */
    logActivity(message: string) {
        // UI activity feed
        const activity = [...(this.state.activity || [])];
        activity.push(`[${new Date().toLocaleTimeString()}] ${message}`);
        this.setState({ activity: activity.slice(-30) });
        // Framework log (visible in agent system prompt)
        this.log(message);
    }

    render(): string {
        if (this.size === 0 && this.logs.length === 0) return '<deck>\nNo slides yet.\n</deck>';

        const slides = this.list().sort((a, b) => a.order - b.order);
        const phaseEmoji: Record<string, string> = {
            pending: '⏳', researching: '🔍', writing: '✍️', polishing: '🎨', done: '✅',
        };

        return render(
            <window name="pitch-deck">
                <line>📊 Pitch Deck: {this.state.topic || 'Untitled'} ({slides.length} slides)</line>
                <br />
                {slides.map((slide, i) => (
                    <>
                        <line>{phaseEmoji[slide.phase]} Slide {i + 1}: {slide.title} [{slide.phase}]{slide.agent ? ` (${slide.agent} working...)` : ''}</line>
                        <line>   Brief: {slide.brief}</line>
                        {slide.research && <line>   Research: {slide.research.slice(0, 200)}...</line>}
                        {slide.content && <line>   Content: {slide.content.slice(0, 200)}...</line>}
                        {slide.finalContent && <line>   Final: {slide.finalContent.slice(0, 200)}...</line>}
                    </>
                ))}
                <br />
                <line>Progress: {slides.filter(s => s.phase === 'done').length}/{slides.length} complete</line>
                {this.logs.length > 0 && (
                    <>
                        <br />
                        <line>Agent Activity:</line>
                        {this.logs.map(l => <line>  • {l}</line>)}
                    </>
                )}
            </window>
        );
    }
}

export default DeckWindow;
