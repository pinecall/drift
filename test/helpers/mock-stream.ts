/**
 * Mock Stream — Fake async iterable for testing Agent._processStream
 * 
 * Creates a stream that yields events in sequence, simulating
 * the Anthropic streaming API without real API calls.
 */

export interface StreamEvent {
    type: string;
    [key: string]: any;
}

export function createMockStream(events: StreamEvent[]) {
    return {
        controller: { abort() {} },
        [Symbol.asyncIterator]() {
            let i = 0;
            return {
                next() {
                    if (i < events.length) {
                        return Promise.resolve({ value: events[i++], done: false });
                    }
                    return Promise.resolve({ value: undefined, done: true });
                }
            };
        }
    };
}

/**
 * Build a simple text-only stream
 */
export function textStream(text: string) {
    return createMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 50 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', usage: { output_tokens: 50 } },
    ]);
}

/**
 * Build a stream with thinking + text
 */
export function thinkingStream(thinking: string, text: string) {
    return createMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 50 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', usage: { output_tokens: 100 } },
    ]);
}

/**
 * Build a stream with a tool call
 */
export function toolStream(toolName: string, toolId: string, inputJson: string) {
    return createMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 50 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: toolId, name: toolName } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: inputJson } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', usage: { output_tokens: 50 } },
    ]);
}

/**
 * Build a stream with text + tool call (common pattern)
 */
export function textAndToolStream(text: string, toolName: string, toolId: string, inputJson: string) {
    return createMockStream([
        { type: 'message_start', message: { usage: { input_tokens: 200, output_tokens: 100 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: toolId, name: toolName } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: inputJson } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', usage: { output_tokens: 100 } },
    ]);
}
