/**
 * Unit Tests — Auth
 * 
 * Tests the pluggable auth system: DriftAuth, NoAuth, TokenAuth, SecretAuth.
 */

import * as http from 'node:http';
import { NoAuth, TokenAuth, SecretAuth } from '../../packages/drift/src/core/auth.ts';
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

    // ── SecretAuth ──

    'SecretAuth accepts valid secret from URL'(assert: any) {
        const auth = new SecretAuth('my-secret');
        const user = auth.authenticate(fakeReq('/?secret=my-secret'));
        assert.equal(user.id, 'authenticated');
    },

    'SecretAuth accepts valid secret from Authorization header'(assert: any) {
        const auth = new SecretAuth('my-secret');
        const user = auth.authenticate(fakeReq('/', { authorization: 'Bearer my-secret' }));
        assert.equal(user.id, 'authenticated');
    },

    'SecretAuth rejects invalid secret'(assert: any) {
        const auth = new SecretAuth('correct');
        try {
            auth.authenticate(fakeReq('/?secret=wrong'));
            assert.ok(false, 'should have thrown');
        } catch (err: any) {
            assert.equal(err.message, 'Invalid secret');
        }
    },

    'SecretAuth rejects missing secret'(assert: any) {
        const auth = new SecretAuth('correct');
        try {
            auth.authenticate(fakeReq());
            assert.ok(false, 'should have thrown');
        } catch (err: any) {
            assert.equal(err.message, 'No secret provided');
        }
    },

    'SecretAuth throws on construction without secret'(assert: any) {
        const oldEnv = process.env.DRIFT_SECRET;
        delete process.env.DRIFT_SECRET;
        try {
            new SecretAuth();
            assert.ok(false, 'should have thrown');
        } catch (err: any) {
            assert.ok(err.message.includes('DRIFT_SECRET'), err.message);
        } finally {
            if (oldEnv) process.env.DRIFT_SECRET = oldEnv;
        }
    },

    'SecretAuth reads from DRIFT_SECRET env var'(assert: any) {
        const oldEnv = process.env.DRIFT_SECRET;
        process.env.DRIFT_SECRET = 'env-secret';
        try {
            const auth = new SecretAuth();
            const user = auth.authenticate(fakeReq('/?secret=env-secret'));
            assert.equal(user.id, 'authenticated');
        } finally {
            if (oldEnv) process.env.DRIFT_SECRET = oldEnv;
            else delete process.env.DRIFT_SECRET;
        }
    },

    'SecretAuth extracts userId from header'(assert: any) {
        const auth = new SecretAuth('key', { userIdHeader: 'X-User-Id' });
        const user = auth.authenticate(fakeReq('/?secret=key', { 'x-user-id': 'user-42' }));
        assert.equal(user.id, 'user-42');
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

        assert.equal(auth.authorize!(user as DriftUser, 'chat:send', {}), true);

        try {
            auth.authorize!(user as DriftUser, 'chat:settings', {});
            assert.ok(false, 'should have thrown');
        } catch (err: any) {
            assert.equal(err.message, 'Admin only');
        }
    },
};
