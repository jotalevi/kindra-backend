import express, { Express } from 'express';
import crypto from 'crypto';
import WhatsappModule from './modules/whatsapp/whatsapp.module';
import { Public } from './middleware/auth';
import DB from './database/db';
import dotenv from 'dotenv';
import ModuleDescriptor from './interfaces/moduleDescriptor';

let app: Express | null = null;

const _: {
    modules: {
        invokeMethod: (moduleName: string, methodName: string, args: any[]) => Promise<any[]>;
    };
    _listedModules: ModuleDescriptor[];
} = {
    modules: {
        invokeMethod: async (moduleName: string, methodName: string, args: any[]) => {
            const module = _._listedModules.find(m => m.moduleName === moduleName);

            if (!module) throw new Error(`Module ${moduleName} not found`);
            if (!(module as any)[methodName] || typeof (module as any)[methodName] !== 'function') throw new Error(`Method ${methodName} not found on module ${moduleName}`);

            return (module as any)[methodName](...args);
        }
    },
    _listedModules: [],
}

async function main() {
    await DB.init();

    dotenv.config();
    DB.setPlainValue('HIDDEN.TENANT_ID', process.env.TENANT_ID || 'kindra');

    DB.setPlainValue('CONFIG.OPENAI_API_KEY', process.env.OPENAI_API_KEY);
    DB.setPlainValue('CONFIG.OPENAI_PREFERRED_MODEL', process.env.OPENAI_PREFERRED_MODEL || 'gpt-4o-mini');

    app = express();
    const port = process.env.PORT || 3012;

    // Monkey-patch express route methods so that any route registered via app.get/post/... will
    // automatically require auth unless the handler was marked with Public(...) or WebHook(...)
    // This makes enforcement global without changing all modules.
    const methods: Array<'get' | 'post' | 'put' | 'delete' | 'patch'> = ['get', 'post', 'put', 'delete', 'patch'];
    for (const m of methods) {
        const original = (app as any)[m].bind(app);
        (app as any)[m] = (path: string, ...handlers: any[]) => {
            const wrappedHandlers: any[] = [];
            for (const h of handlers) {
                const isPublic = !!(h && (h as any).__public);
                const isWebHook = !!(h && (h as any).__webhook);
                if (isPublic || isWebHook) wrappedHandlers.push(h);
                else wrappedHandlers.push((req: any, res: any, next: any) => {
                    // call authMiddleware then handler
                    const { authMiddleware } = require('./middleware/auth');
                    authMiddleware(req, res, (err?: any) => {
                        if (err) return next(err);
                        return h(req, res, next);
                    });
                });
            }
            return original(path, ...wrappedHandlers);
        };
    }

    app.use(express.json());

    // Add a simple frontend here, anything comming from tenant_id.kindra.cl will get served a basic HTML page
    app.use((req, res, next) => {
        const host = req.headers.host || '';
        const tenantId = DB.getPlainValue('HIDDEN.TENANT_ID') || 'kindra';
        if (host.startsWith(tenantId + '.kindra.cl')) {
            res.sendFile('index.html', { root: './public' });
        } else {
            next();
        };
    });

    // Admin login route
    app.post('/login', Public(async (req, res) => {
        const { username, password } = req.body;
        const adminUser = process.env.ADMIN_USERNAME || 'admin';
        const adminPass = process.env.ADMIN_PASSWORD || 'password';
        if (username === adminUser && password === adminPass) {
            // Build an IP-bound JWT (HMAC-SHA256). Secret must be set in ADMIN_JWT_SECRET env var.
            const secret = process.env.ADMIN_JWT_SECRET || 'dev_admin_secret_change_me';

            // Determine client IP (trust X-Forwarded-For if present)
            const forwarded = (req.headers['x-forwarded-for'] as string) || '';
            const clientIp = (forwarded.split(',').map(s => s.trim()).find(Boolean)) || req.socket.remoteAddress || '';

            const now = Math.floor(Date.now() / 1000);
            const expiresIn = 60 * 60; // 1 hour

            const header = { alg: 'HS256', typ: 'JWT' };
            const payload: any = {
                sub: adminUser,
                iat: now,
                exp: now + expiresIn,
                ip: clientIp
            };

            const base64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const toSign = `${base64url(header)}.${base64url(payload)}`;
            const signature = crypto.createHmac('sha256', secret).update(toSign).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const token = `${toSign}.${signature}`;

            // Return Bearer token
            res.status(200).json({ token: `Bearer ${token}`, expiresIn });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    }));

    // Global Variables Get Route
    app.get('/config', async (req, res) => {
        const config = await DB.wildcardQuery('CONFIG.%');
        res.json({ config });
    });

    app.get('/analytics', async (req, res) => {

        const allPeriods = [
            ,
            ,


            {   // Last 1 hour
                from: new Date(Date.now() - 1 * 60 * 60 * 1000),
                to: new Date()
            }
        ];

        let analytics  = {
            allTime: await DB.getAnalyticsEvents([
                {   // All events
                    from: new Date('1970-01-01T00:00:00.000Z'),
                    to: new Date()
                }
            ]),
            lastMonth: await DB.getAnalyticsEvents([
                {   // Last 30 days
                    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    to: new Date()
                }
            ]),
            lastWeek: await DB.getAnalyticsEvents([
                {   // Last 7 days
                    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    to: new Date()
                }
            ]),
            lastDay: await DB.getAnalyticsEvents([
                {   // Last 24 hours
                    from: new Date(Date.now() - 24 * 60 * 60 * 1000),
                    to: new Date()
                }
            ]),
            lastHour: await DB.getAnalyticsEvents([
                {   // Last 1 hour
                    from: new Date(Date.now() - 1 * 60 * 60 * 1000),
                    to: new Date()
                }
            ]),
        }

        res.json({ analytics  });
    });

    _._listedModules.push(await WhatsappModule.register(app));

    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });

    return app;
}

main().catch(err => {
    console.error('Failed to start application', err);
});

export default app;
export { _ };