/**
 * @drift/react — useStreamBuffer()
 * 
 * Smooths out streaming text by buffering incoming chunks and revealing
 * characters progressively using requestAnimationFrame. Creates a fluid
 * typewriter effect instead of abrupt chunk-by-chunk updates.
 * 
 * Usage:
 *   const { messages } = useChat('agent', { sessionId });
 *   const smoothMessages = useStreamBuffer(messages, { charsPerFrame: 3 });
 *   // render smoothMessages instead of messages
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage, MessagePart } from './types.ts';

export interface StreamBufferOptions {
    /** Characters to reveal per animation frame. Higher = faster. Default: 3 */
    charsPerFrame?: number;
    /** If true, skip animation and show all text instantly. Default: false */
    instant?: boolean;
}

/**
 * Smooths streaming messages using RAF-based character reveal.
 * Only animates the last assistant message while streaming — completed messages pass through unchanged.
 */
export function useStreamBuffer(
    messages: ChatMessage[],
    options: StreamBufferOptions = {},
): ChatMessage[] {
    const { charsPerFrame = 3, instant = false } = options;

    // Target text = full text from the last assistant message's text parts
    const [revealedLen, setRevealedLen] = useState(0);
    const rafRef = useRef<number>(0);
    const targetLenRef = useRef(0);
    const revealedLenRef = useRef(0);

    // Find the last assistant message
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];
    const isStreaming = lastMsg?.role === 'assistant' && (lastMsg.status === 'streaming' || lastMsg.status === 'tool');

    // Compute full text of the last message's text parts
    const fullText = isStreaming
        ? (lastMsg.parts || [])
            .filter((p: MessagePart) => p.type === 'text')
            .map((p: MessagePart) => p.content || '')
            .join('')
        : '';

    targetLenRef.current = fullText.length;

    // RAF loop: reveal characters smoothly
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
        if (instant || !isStreaming) {
            // Reset when not streaming
            revealedLenRef.current = 0;
            setRevealedLen(0);
            return;
        }

        // New text arrived — start/continue RAF if behind
        if (revealedLenRef.current < targetLenRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(tick);
        }

        return () => cancelAnimationFrame(rafRef.current);
    }, [fullText, isStreaming, instant, tick]);

    // When streaming ends, snap to full
    useEffect(() => {
        if (!isStreaming && revealedLenRef.current > 0) {
            revealedLenRef.current = 0;
            setRevealedLen(0);
        }
    }, [isStreaming]);

    // If not streaming or instant mode, pass through unchanged
    if (!isStreaming || instant) return messages;

    // Build the animated version of the last message
    const revealedText = fullText.slice(0, revealedLen);

    // Reconstruct the last message's parts with truncated text
    let charsLeft = revealedLen;
    const animatedParts: MessagePart[] = [];

    for (const part of lastMsg.parts || []) {
        if (part.type === 'text') {
            const content = part.content || '';
            if (charsLeft <= 0) {
                // Skip this text part entirely
                continue;
            }
            const visible = content.slice(0, charsLeft);
            charsLeft -= visible.length;
            animatedParts.push({ ...part, content: visible });
        } else {
            // Non-text parts (thinking, tool) pass through unchanged
            animatedParts.push(part);
        }
    }

    const animatedMsg: ChatMessage = {
        ...lastMsg,
        parts: animatedParts,
    };

    // Return all messages with the last one animated
    return [...messages.slice(0, lastIdx), animatedMsg];
}
