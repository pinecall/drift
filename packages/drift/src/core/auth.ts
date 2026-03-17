/**
 * Drift — Auth
 * 
 * Pluggable authentication for DriftServer WebSocket connections.
 * Apps can bring their own auth (JWT, NextAuth, Clerk, etc.).
 * 
 *   // Token-based
 *   const server = new DriftServer({
 *       auth: new TokenAuth(token => jwt.verify(token, SECRET)),
 *   });
 * 
 *   // Custom
 *   const server = new DriftServer({
 *       auth: { authenticate(req) { ... }, authorize(user, action) { ... } },
 *   });
 */

import type { IncomingMessage } from 'node:http';

// ── Types ───────────────────────────────────────────

/** User context returned by authenticate(). Apps can extend with roles, etc. */
export interface DriftUser {
    id: string;
    [key: string]: any;
}

/** Pluggable auth adapter. */
export interface DriftAuth {
    /**
     * Authenticate on WebSocket upgrade.
     * Return a DriftUser or throw to reject the connection.
     * The req contains headers, URL params (e.g. ?token=xxx), cookies, etc.
     */
    authenticate(req: IncomingMessage): Promise<DriftUser> | DriftUser;

    /**
     * Optional: authorize per-message actions.
     * Return true to allow, throw to deny.
     * Useful for role-based access (e.g., only admins can change settings).
     */
    authorize?(user: DriftUser, action: string, msg: any): Promise<boolean> | boolean;
}

// ── Built-in Implementations ────────────────────────

/** No auth — allows all connections (default). */
export class NoAuth implements DriftAuth {
    authenticate(): DriftUser {
        return { id: 'anonymous' };
    }
}

/**
 * Token-based auth — extracts token from URL param or Authorization header,
 * then calls a user-provided verify function.
 * 
 *   new TokenAuth(token => jwt.verify(token, SECRET))
 *   new TokenAuth(token => db.findUserByApiKey(token))
 */
export class TokenAuth implements DriftAuth {
    private _verify: (token: string) => DriftUser | Promise<DriftUser>;

    constructor(verify: (token: string) => DriftUser | Promise<DriftUser>) {
        this._verify = verify;
    }

    async authenticate(req: IncomingMessage): Promise<DriftUser> {
        const token = this._extractToken(req);
        if (!token) {
            throw new Error('No authentication token provided');
        }
        return this._verify(token);
    }

    private _extractToken(req: IncomingMessage): string | null {
        // 1. URL param: ws://host?token=xxx
        try {
            const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const token = url.searchParams.get('token');
            if (token) return token;
        } catch {}

        // 2. Authorization header: Bearer xxx
        const auth = req.headers['authorization'];
        if (auth?.startsWith('Bearer ')) {
            return auth.slice(7);
        }

        // 3. Sec-WebSocket-Protocol header (used by browser WS when you can't set headers)
        const protocol = req.headers['sec-websocket-protocol'];
        if (protocol && !protocol.includes(',')) {
            return protocol;
        }

        return null;
    }
}

/**
 * Shared secret auth — simplest protection for standalone Drift apps.
 * Checks a single secret key. No user management needed.
 * 
 * Uses DRIFT_SECRET env var by default, or pass a secret directly:
 * 
 *   new SecretAuth()                       // reads DRIFT_SECRET from env
 *   new SecretAuth('my-secret-key')        // explicit secret
 *   new SecretAuth('key', { userIdHeader: 'x-user-id' }) // extract user ID from header
 * 
 * Client connects with: ws://host?secret=xxx
 * Or: Authorization: Bearer xxx
 */
export class SecretAuth implements DriftAuth {
    private _secret: string;
    private _userIdHeader?: string;

    constructor(secret?: string, options?: { userIdHeader?: string }) {
        this._secret = secret || process.env.DRIFT_SECRET || '';
        this._userIdHeader = options?.userIdHeader;
        if (!this._secret) {
            throw new Error(
                'SecretAuth requires a secret. Set DRIFT_SECRET env var or pass it to the constructor.'
            );
        }
    }

    authenticate(req: IncomingMessage): DriftUser {
        const provided = this._extractSecret(req);
        if (!provided) {
            throw new Error('No secret provided');
        }
        if (provided !== this._secret) {
            throw new Error('Invalid secret');
        }

        // Optionally extract user ID from a header (e.g., set by a reverse proxy)
        const userId = this._userIdHeader
            ? (req.headers[this._userIdHeader.toLowerCase()] as string) || 'authenticated'
            : 'authenticated';

        return { id: userId };
    }

    private _extractSecret(req: IncomingMessage): string | null {
        // 1. URL param: ws://host?secret=xxx
        try {
            const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
            const secret = url.searchParams.get('secret') || url.searchParams.get('token');
            if (secret) return secret;
        } catch {}

        // 2. Authorization header: Bearer xxx
        const auth = req.headers['authorization'];
        if (auth?.startsWith('Bearer ')) {
            return auth.slice(7);
        }

        // 3. Sec-WebSocket-Protocol
        const protocol = req.headers['sec-websocket-protocol'];
        if (protocol && !protocol.includes(',')) {
            return protocol;
        }

        return null;
    }
}
