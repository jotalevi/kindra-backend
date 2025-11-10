import { Request, Response, NextFunction, Express } from 'express';
import crypto from 'crypto';

type RouteHandler = (req: Request, res: Response, next?: NextFunction) => any;

export function Public(handler: RouteHandler): RouteHandler {
    (handler as any).__public = true;
    return handler;
}

function base64urlDecode(input: string): Buffer {
    // pad
    input = input.replace(/-/g, '+').replace(/_/g, '/');
    while (input.length % 4) input += '=';
    return Buffer.from(input, 'base64');
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const auth = (req.headers['authorization'] || '') as string;
        if (!auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Missing token' });
        const token = auth.substring(7);
        const [headerB64, payloadB64, signature] = token.split('.');
        if (!headerB64 || !payloadB64 || !signature) return res.status(401).json({ success: false, message: 'Invalid token format' });

        const secret = process.env.ADMIN_JWT_SECRET || 'dev_admin_secret_change_me';
        const toSign = `${headerB64}.${payloadB64}`;
        const expectedSig = crypto.createHmac('sha256', secret).update(toSign).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        if (signature !== expectedSig) return res.status(401).json({ success: false, message: 'Invalid signature' });

        const payloadJson = base64urlDecode(payloadB64).toString('utf8');
        const payload = JSON.parse(payloadJson);

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && now >= payload.exp) return res.status(401).json({ success: false, message: 'Token expired' });

        // Validate IP binding if present
        const forwarded = (req.headers['x-forwarded-for'] as string) || '';
        const clientIp = (forwarded.split(',').map(s => s.trim()).find(Boolean)) || req.socket.remoteAddress || '';
        if (payload.ip && payload.ip !== clientIp) return res.status(403).json({ success: false, message: 'IP mismatch' });

        // attach user
        (req as any).user = payload;
        next();
    } catch (e) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

export default {
    Public,
    authMiddleware
};
