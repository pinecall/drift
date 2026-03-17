/**
 * Drift — Anthropic API provider
 * 
 * Wraps @anthropic-ai/sdk, handles stream creation with beta headers.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ModelConfig } from '../types.ts';
import { getBetaHeaders } from './models.ts';

export class Provider {
    readonly client: Anthropic;

    constructor(apiKey?: string) {
        // Only pass apiKey if explicitly provided —
        // the Anthropic SDK auto-reads ANTHROPIC_API_KEY from env
        const opts: Record<string, any> = {};
        if (apiKey) opts.apiKey = apiKey;
        this.client = new Anthropic(opts);
    }

    /**
     * Create a streaming API call with appropriate beta headers.
     */
    async createStream(
        params: Record<string, any>,
        modelConfig: ModelConfig,
        options: { thinking?: boolean }
    ) {
        const betaHeaders = getBetaHeaders(modelConfig, options);

        if (betaHeaders.length > 0) {
            return (this.client as any).beta.messages.create({
                ...params,
                betas: betaHeaders,
            });
        }

        return this.client.messages.create(params as any);
    }
}
