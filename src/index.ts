import express, { Express } from 'express';
import crypto from 'crypto';
import WhatsappModule from './modules/whatsapp/whatsapp.module';
import { Public } from './middleware/auth';
import DB from './database/db';
import dotenv from 'dotenv';
import ModuleDescriptor from './interfaces/moduleDescriptor';
import HardLogger from './logger/hardLogger';
import fs from 'fs';
import path from 'path';

// Ensure the process exits on uncaught errors so an external supervisor can restart it.
process.on('uncaughtException', (err: any) => {
    try { HardLogger.error('Uncaught Exception: ' + (err && err.stack ? err.stack : String(err))); } catch (e) { console.error('Uncaught Exception', err); }
    setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason: any) => {
    try { HardLogger.error('Unhandled Rejection: ' + (reason && reason.stack ? reason.stack : String(reason))); } catch (e) { console.error('Unhandled Rejection', reason); }
    setTimeout(() => process.exit(1), 100);
});

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

            if (!module) HardLogger.error(`Module ${moduleName} not found`);
            if (!(module as any)[methodName] || typeof (module as any)[methodName] !== 'function') HardLogger.error(`Method ${methodName} not found on module ${moduleName}`);

            return (module as any)[methodName](...args);
        }
    },
    _listedModules: [],
}

async function main() {
    await DB.init();

    dotenv.config();
    DB.setPlainValue('HIDDEN.TENANT_ID', process.env.TENANT_ID || 'kindra');


    
    DB.setPlainValue('CONFIG.OPENAI_API_KEY', (await DB.getPlainValue('CONFIG.OPENAI_API_KEY')) ?? process.env.OPENAI_API_KEY);
    DB.setPlainValue('CONFIG.OPENAI_PREFERRED_MODEL', (await DB.getPlainValue('CONFIG.OPENAI_PREFERRED_MODEL')) ?? (process.env.OPENAI_PREFERRED_MODEL || 'gpt-4o-mini'));

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

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }

        next();
    });

    // Add a simple frontend here, anything comming from tenant_id.kindra.cl will get served a basic HTML page
    app.use((req, res, next) => {
        const host = req.headers.host || '';
        const tenantId = DB.getPlainValue('HIDDEN.TENANT_ID') || 'kindra';
        if (host.startsWith(tenantId + '.kindra.cl')) {
            res.redirect('/dashboard/login');
        } else {
            next();
        };
    });

    app.get('/tenant', Public(async (req, res) => {
        try {
            const raw = await DB.getPlainValue('HIDDEN.TENANT_ID');
            const tenantId = raw ? raw.replace(/^"|"$/g, '') : 'kindra';
            res.json({ tenantId });
        } catch (err) {
            res.json({ tenantId: 'kindra' });
        }
    }));

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
            res.status(200).json({ token: `${token}`, expiresIn });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    }));

    app.get('/modules', async (req, res) => {
        const modules = await Promise.all(_._listedModules.map(async m => ({
            moduleName: m.moduleName,
            displayName: m.displayName,
            path: m.path,
            enabled: await DB.getPlainValue(`MODULE.${m.moduleName}.ENABLED`) // Ensure module enabled flag exists
        })));

        res.json({ modules });
    });

    app.post('/modules/:moduleName', async (req, res) => {
        const { moduleName } = req.params;
        const enabled = await DB.getPlainValue(`MODULE.${moduleName}.ENABLED`) === 'false' ? true : false;
        await DB.setPlainValue(`MODULE.${moduleName}.ENABLED`, enabled);
        res.json({ message: `Module ${moduleName} updated` }).end();

        // Restart the process to apply module changes
        setTimeout(() => {
            HardLogger.info('Restarting process to apply module changes...');
            process.exit(3);
        }, 5000);
    });

    // Prompt Get/Set Routes
    app.get('/prompt', async (req, res) => {
        const prompt = DB.loadFile(`prompt`);

        res.json({ prompt });
    });

    app.post('/prompt', async (req, res) => {
        const { prompt } = req.body;
        DB.saveFile(`prompt`, prompt);
        res.json({ message: 'Prompt updated' });
    });

    // Speech Get/Set Routes
    app.get('/speech', async (req, res) => {
        const speech = DB.loadFile(`speech`);
        res.json({ speech });
    });

    app.post('/speech', async (req, res) => {
        const { speech } = req.body;
        DB.saveFile(`speech`, speech);
        res.json({ message: 'Speech updated' });
    });

    // Global Variables Get Route
    app.get('/config', async (req, res) => {
    const rows = (await DB.wildcardQuery('CONFIG.%')) || [];
        const config: Record<string, any> = {};
        for (const r of rows) {
            if (r && typeof r.key !== 'undefined') {
                config[r.key] = r.value;
            }
        }

        res.json(config);
    });

    app.post('/config', async (req, res) => {
        const updates: Record<string, any> = req.body;
        for (const key of Object.keys(updates)) {
            DB.setPlainValue(key, updates[key]);
        }

        res.sendStatus(200);
    });

    app.get('/analytics', async (req, res) => {
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

    // Automatically list modules under /src/modules that implement either SocialModuleInterface or SchedulingModuleInterface
    const moduleFolders = fs.readdirSync(path.join(__dirname, 'modules'))
    for (const module of moduleFolders) {
        try {
            const moduleConfig = fs.readFileSync(path.join(__dirname, 'modules', module, 'config.json'), 'utf-8');
            const moduleName: string = JSON.parse(moduleConfig).moduleName.toString();

            let enabled = await DB.getPlainValue(`MODULE.${moduleName}.ENABLED`); // Ensure module enabled flag exists
            if (enabled === null || typeof enabled === 'undefined') {
                await DB.setPlainValue(`MODULE.${moduleName}.ENABLED`, true);
                enabled = "true";
            }

            if (enabled.toString() !== 'true') {
                HardLogger.info(`ModuleStatus: Module ${moduleName} found in folder ${module}, but disabled.`);
                _._listedModules.push(await (require(`./modules/${module}/${module}.module`).default).getEmptyDescriptor(app));
                continue;
            } else {
                _._listedModules.push(await (require(`./modules/${module}/${module}.module`).default).register(app));
                HardLogger.info(`ModuleStatus: Module ${moduleName} loaded successfully.`);
            }
        } catch (e) {
            HardLogger.warn(`Skipping module folder ${module} as it has no config.json`);
            continue;
        }
    }

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