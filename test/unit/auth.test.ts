/**
 * Unit Tests — Auth
 * 
 * Tests the pluggable auth system: DriftAuth, NoAuth, TokenAuth.
 */

import * as http from 'node:http';
import { NoAuth, TokenAuth } from '../../packages/drift/src/core/auth.ts';
import type { DriftAuth, DriftUser } from '../../packages/drift/src/core/auth.ts';

export const name = 'Auth';

// Helper: create a fake IncomingMessage with URL and headers
function fakeReq(url: string = '/', headers: Record<string, string> = {}): http.IncomingMessage {
    return { url, headers: { host: 'localhost', ...headers } } as any;
}

export const tests = {
    // ── NoAuth ──

    'NoAuth returns anonymous user'(assert: any) {
        const auth = new NoAuth();
        const user = auth.authenticate(fakeReq());
        assert.equal(user.id, 'anonymous');
    },

    // ── TokenAuth ──

    'TokenAuth extracts token from URL param'(assert: any) {
        const auth = new TokenAuth(token => ({ id: token }));
        const user = auth.authenticate(fakeReq('/?token=abc123'));
        // authenticate is async
        return (user as Promise<DriftUser>).then(u => {
            assert.equal(u.id, 'abc123');
        });
    },

    'TokenAuth extracts token from Authorization header'(assert: any) {
        const auth = new TokenAuth(token => ({ id: token }));
        const user = auth.authenticate(fakeReq('/', { authorization: 'Bearer my-jwt' }));
        return (user as Promise<DriftUser>).then(u => {
            assert.equal(u.id, 'my-jwt');
        });
    },

    'TokenAuth extracts token from Sec-WebSocket-Protocol'(assert: any) {
        const auth = new TokenAuth(token => ({ id: token }));
        const user = auth.authenticate(fakeReq('/', { 'sec-websocket-protocol': 'my-token' }));
        return (user as Promise<DriftUser>).then(u => {
            assert.equal(u.id, 'my-token');
        });
    },

    'TokenAuth URL param takes priority over headers'(assert: any) {
        const auth = new TokenAuth(token => ({ id: token }));
        const user = auth.authenticate(fakeReq('/?token=url-token', { authorization: 'Bearer header-token' }));
        return (user as Promise<DriftUser>).then(u => {
            assert.equal(u.id, 'url-token');
        });
    },

    'TokenAuth throws when no token provided'(assert: any) {
        const auth = new TokenAuth(token => ({ id: token }));
        return (auth.authenticate(fakeReq()) as Promise<DriftUser>).then(
            () => assert.ok(false, 'should have thrown'),
            (err: any) => assert.ok(err.message.includes('No authentication token'), err.message),
        );
    },

    'TokenAuth throws when verify rejects'(assert: any) {
        const auth = new TokenAuth(() => { throw new Error('Invalid token'); });
        return (auth.authenticate(fakeReq('/?token=bad')) as Promise<DriftUser>).then(
            () => assert.ok(false, 'should have thrown'),
            (err: any) => assert.equal(err.message, 'Invalid token'),
        );
    },

    'TokenAuth supports async verify'(assert: any) {
        const auth = new TokenAuth(async token => {
            await new Promise(r => setTimeout(r, 10));
            return { id: token, role: 'admin' };
        });
        return (auth.authenticate(fakeReq('/?token=async-tok')) as Promise<DriftUser>).then(u => {
            assert.equal(u.id, 'async-tok');
            assert.equal(u.role, 'admin');
        });
    },

    // ── Custom auth (interface compliance) ──

    'custom auth with authorize'(assert: any) {
        const auth: DriftAuth = {
            authenticate() { return { id: 'user-1', role: 'viewer' }; },
            authorize(user, action) {
                if (action === 'chat:settings' && user.role !== 'admin') {
                    throw new Error('Admin only');
                }
                return true;
            },
        };

        const user = auth.authenticate(fakeReq());
        assert.equal(user.id, 'user-1');

        // Allowed action
        assert.equal(auth.authorize!(user as DriftUser, 'chat:send', {}), true);

        // Blocked action
        try {
            auth.authorize!(user as DriftUser, 'chat:settings', {});
            assert.ok(false, 'should have thrown');
        } catch (err: any) {
            assert.equal(err.message, 'Admin only');
        }
    },
};
