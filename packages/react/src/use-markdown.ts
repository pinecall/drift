/**
 * @drift/react — useMarkdown()
 * 
 * Renders markdown text to HTML with optional RAF-based streaming animation.
 * Zero dependencies beyond React and the built-in parseMarkdown.
 * 
 * Usage:
 *   // Streaming chat (animated)
 *   const { html, isAnimating } = useMarkdown(text, { streaming: true });
 *   
 *   // Static content (slides, descriptions)
 *   const { html } = useMarkdown(slideContent);
 *   
 *   // Render
 *   <div dangerouslySetInnerHTML={{ __html: html }} className="drift-md" />
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { parseMarkdown } from './markdown.ts';

export interface UseMarkdownOptions {
    /** Is the source text still being streamed? Enables RAF animation. Default: false */
    streaming?: boolean;
    /** Characters to reveal per animation frame. Default: 4 */
    charsPerFrame?: number;
}

export interface UseMarkdownReturn {
    /** Rendered HTML string. Use with dangerouslySetInnerHTML. */
    html: string;
    /** Whether the reveal animation is still running. */
    isAnimating: boolean;
}

/**
 * Parse markdown → HTML with optional RAF-based character reveal animation.
 * 
 * When `streaming` is true, text is revealed character-by-character using
 * requestAnimationFrame for smooth 60fps animation. When streaming stops,
 * the full text is shown immediately.
 * 
 * When `streaming` is false (default), returns the full parsed HTML instantly.
 */
export function useMarkdown(
    text: string,
    options: UseMarkdownOptions = {},
): UseMarkdownReturn {
    const { streaming = false, charsPerFrame = 4 } = options;

    // ── RAF animation state ──
    const [revealedLen, setRevealedLen] = useState(0);
    const rafRef = useRef<number>(0);
    const targetLenRef = useRef(0);
    const revealedLenRef = useRef(0);
    const prevTextRef = useRef('');

    // Track if we've finished revealing
    const isAnimating = streaming && revealedLenRef.current < text.length;

    // Update target length when text changes
    targetLenRef.current = text.length;

    // RAF tick
    const tick = useCallback(() => {
        if (revealedLenRef.current < targetLenRef.current) {
            revealedLenRef.current = Math.min(
                revealedLenRef.current + charsPerFrame,
                targetLenRef.current,
            );
            setRevealedLen(revealedLenRef.current);
            rafRef.current = requestAnimationFrame(tick);
        }
    }, [charsPerFrame]);

    useEffect(() => {
        if (!streaming) {
            // Not streaming — reset animation state
            revealedLenRef.current = 0;
            setRevealedLen(0);
            cancelAnimationFrame(rafRef.current);
            return;
        }

        // Text grew — start/continue animation
        if (revealedLenRef.current < targetLenRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(tick);
        }

        return () => cancelAnimationFrame(rafRef.current);
    }, [text, streaming, tick]);

    // When streaming ends, snap to full
    useEffect(() => {
        if (!streaming && prevTextRef.current !== text) {
            revealedLenRef.current = 0;
            setRevealedLen(0);
        }
        prevTextRef.current = text;
    }, [streaming, text]);

    // ── Parse markdown ──
    const visibleText = streaming ? text.slice(0, revealedLen) : text;
    const html = useMemo(() => parseMarkdown(visibleText), [visibleText]);

    return { html, isAnimating };
}
