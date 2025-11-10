import { Express, Request, Response } from 'express';
import DB from '../../database/db';
import SocialModuleInterface from "../../interfaces/socialModuleInterface";
import HardLogger from '../../logger/hardLogger';
import ModuleDescriptor, { ModuleActionDescriptor } from '../../interfaces/moduleDescriptor';
import AggregatedMessages from '../../aggregatedMessages';
import { Public } from '../../middleware/auth';
import OpenAI from "openai";
import { _ } from '../../index';
import OpenAiModule from '../openai/openAi.module';
import { start } from 'repl';

export default class WhatsappModule implements SocialModuleInterface {
    private static moduleName = "";

    static async register(app: Express): Promise<ModuleDescriptor> {
        const startTime = Date.now();
        const config = require('./config.json');
        const moduleName = config.moduleName;
        this.moduleName = moduleName;

        const existingModule = await DB.getPlainValue(`MODULE.${moduleName}.registered`);
        //if (!existingModule) {
        await DB.setPlainValueAsync(`MODULE.${moduleName}.registered`, true);

        for (const key of Object.keys(config)) {
            if (key === 'settings') continue;
            const existing = await DB.getPlainValue(`MODULE.${moduleName}.statics.${key}`);
            if (existing) continue;
            await DB.setPlainValueAsync(`MODULE.${moduleName}.statics.${key}`, config[key]);
        }

        for (const key of Object.keys(config.settings || {})) {
            const existing = await DB.getPlainValue(`MODULE.${moduleName}.settings.${key}`);
            if (existing) continue;
            await DB.setPlainValueAsync(`MODULE.${moduleName}.settings.${key}.type`, config.settings[key].type);
            await DB.setPlainValueAsync(`MODULE.${moduleName}.settings.${key}.required`, config.settings[key].required);
            await DB.setPlainValueAsync(`MODULE.${moduleName}.settings.${key}.description`, config.settings[key].description);
            await DB.setPlainValueAsync(`MODULE.${moduleName}.settings.${key}`, config.settings[key].value);
        }
        //}

        const instance = new this();
        instance.register(app, config.controllerPath);

        DB.analyticsLogEvent(`Module.${moduleName}.Registered`, Date.now() - startTime, new Date());

        return {
            instance: instance,
            moduleName: moduleName,
            path: config.controllerPath,
            displayName: config.displayName || moduleName,
            actions: instance.getActionDescriptors()
        }
    }

    static getEmptyDescriptor(): ModuleDescriptor {
        const config = require('./config.json');
        return {
            instance: {},
            moduleName: config.moduleName,
            path: config.controllerPath,
            displayName: config.displayName || config.moduleName,
            actions: []
        }
    }

    private agregateRequests: AggregatedMessages[] = [];

    private getActionDescriptors(): ModuleActionDescriptor[] {
        return [
            { name: "sendMessage", parameters: ["userId", "message"], handler: "@sendMessageHandler" }  // @ is for instance method # is for static method
        ];
    }

    private async processAggregatedMessages(userId: string, messages: { timestamp: number, content: string }[]): Promise<void> {
        const startTime = Date.now();
        DB.pushModuleLog(WhatsappModule.moduleName, "SYSTEM_ACTION", `Processing aggregated messages for user ${userId}: ${JSON.stringify(messages)}`);
        
        this.agregateRequests = this.agregateRequests.filter(a => a.userId !== userId);
        
        const expectedOutput = DB.loadFile(`${WhatsappModule.moduleName}/expectedOutput`);
        const ucontext = DB.loadFile(`${WhatsappModule.moduleName}/${userId}.ucontext.json`);
        const prompt = DB.loadFile(`prompt`);
        const speech = DB.loadFile(`speech`);
        //const currentUserSchedule = _.modules.invokeMethod("CalendarModule", "getUserScheduledEvents", [userId]);

        const steps = await OpenAiModule.getSteps([
            {
                role: "system",
                content: prompt
            },
            {
                role: "system",
                content: `User Context: ${JSON.stringify(ucontext)}`
            },
            {
                role: "system",
                content: `Speech: ${JSON.stringify(speech)}`
            },
            //{
            //    role: "system",
            //    content: `Current User Scheduled events: ${JSON.stringify([
            //        { "title": "Liposuccion con doc marcelo", "date": "2024-07-01", "time": "10:00 AM" },
            //        { "title": "revision con doc marcelo", "date": "2024-07-08", "time": "3:00 PM" },
            //        { "title": "botox con doc mariana", "date": "2024-07-15", "time": "11:00 AM" }
            //    ])}`
            //},
            {
                role: "system",
                content: `Expected Output: ${JSON.stringify(expectedOutput)}`
            },
            {
                role: "system",
                content: "IMPORTANT: Respond with a single valid JSON Array of objects (steps) only. Do NOT include any surrounding explanation, commentary, or markdown. The response must be parseable JSON."
            },
            {
                role: "user",
                content: `Messages: ${JSON.stringify(messages)}`
            }
        ])

        for (const step of steps) {
            if (step.action === "ANSWER") {
                await this.sendMessageHandler(userId, step.message);
            } else if (step.action === "UPDATE_USER_CONTEXT") {
                DB.saveFile(`${WhatsappModule.moduleName}/${userId}.ucontext.json`, step.newUserContext);
            } else {
                HardLogger.warn(`Unknown action received from OpenAI: ${step.action}`);
            }
        }

        DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.ProcessAggregatedMessages`, Date.now() - startTime, new Date());
    }

    async webhookInputHandler(req: Request, res: Response): Promise<void> {

        const startTime = Date.now();
        DB.pushModuleLog(WhatsappModule.moduleName, "SYSTEM_ACTION", `Received Message: ${JSON.stringify(req.body)}`);

        for (const entry of req.body.entry[0].changes) {
            const userId = entry.value.contacts[0].wa_id;
            let agg = this.agregateRequests.find(a => a.userId === userId);
            if (!agg) agg = new AggregatedMessages(userId, (messages: { timestamp: number; content: string }[]) => {
                this.processAggregatedMessages(userId, messages);
            }, parseInt(await DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.aggregationTimeout`) || "5000"));

            for (const msg of entry.value.messages) {
                agg.pushMessage({ timestamp: Date.now(), content: msg.text.body });
            }

            this.agregateRequests.push(agg);

            if (!DB.hitFile(`${WhatsappModule.moduleName}/${userId}.url`)) {
                const accessToken = (await DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.accessToken`) ?? '""').replace(/"/g, '');
                if (!accessToken) {
                    HardLogger.error(`WhatsApp Module: Access Token is not configured.`);
                }

                const phoneNumber = (await DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.phoneNumberId`) ?? '""').replace(/"/g, '');
                if (!phoneNumber) {
                    HardLogger.error(`WhatsApp Module: Phone Number ID is not configured.`);
                }
            }

        }

        DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.WebhookInputHandler`, Date.now() - startTime, new Date());
        res.status(200).end();
    }

    async sendMessageHandler(userId: string, message: string): Promise<void> {

        const startTime = Date.now();
        DB.pushModuleLog(WhatsappModule.moduleName, "SYSTEM_ACTION", `Sending message to ${userId}: ${message}`);

        const accessToken = (await DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.accessToken`) ?? '""').replace(/"/g, '');
        if (!accessToken) {
            HardLogger.error(`WhatsApp Module: Access Token is not configured.`);
        }

        const phoneNumber = (await DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.phoneNumberId`) ?? '""').replace(/"/g, '');
        if (!phoneNumber) {
            HardLogger.error(`WhatsApp Module: Phone Number ID is not configured.`);
        }

        const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumber}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to: userId,
                type: "text",
                text: {
                    body: message
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            HardLogger.error(`WhatsApp Module: Failed to send message. Status: ${response.status}, Response: ${errorText}`);
        }

        console.log(await response.text());
        DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.SendMessageHandler`, Date.now() - startTime, new Date());
    }

    register(app: Express, controllerRoute: string): void {
        // register webhook route
        app.post(`${controllerRoute}/webhook`, Public((req: Request, res: Response) => {
            const startTime = Date.now();
            
            this.webhookInputHandler(req, res).catch(err => {
                HardLogger.error(`Error processing webhook input: ${err}`);
                res.status(500).end();
            });

            DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.WebhookPost`, Date.now() - startTime, new Date());
            res.status(200).end();
        }));

        app.get(`${controllerRoute}/webhook`, Public(async (req: Request, res: Response) => {
            const startTime = Date.now();

            const verifyToken = (await DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.verifyToken`)) ?? "default_verify_token";
            const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;


            if (mode === 'subscribe' && token === verifyToken) {
                console.log('WEBHOOK VERIFIED');
                res.status(200).send(challenge);
            } else {
                res.status(403).end();
            }

            DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.WebhookGet`, Date.now() - startTime, new Date());
        }));

        app.get(`${controllerRoute}/config`, async (req: Request, res: Response) => {
            const startTime = Date.now();

            DB.pushModuleLog(WhatsappModule.moduleName, 'HTTP', `Configuration requested.`);
            const data = (await DB.wildcardQuery(`MODULE.${WhatsappModule.moduleName}.settings.%`)) || [];

            // Build a nested object keyed by the short setting name
            // e.g. { "active": { type, required, description, value }, ... }
            const prefix = `MODULE.${WhatsappModule.moduleName}.settings.`;
            const result: { [key: string]: { type?: any, required?: any, description?: any, value?: any } } = {};

            for (const entry of data) {
                if (!entry.key || typeof entry.key !== 'string') continue;
                if (!entry.key.startsWith(prefix)) continue;

                const remainder = entry.key.substring(prefix.length); // e.g. "active.type" or "accessToken"
                const parts = remainder.split('.');
                const prop = parts[0];
                const sub = parts[1] || 'value';

                if (!result[prop]) result[prop] = { type: undefined, required: undefined, description: undefined, value: undefined };

                // Parse stored value into proper primitive when possible
                let parsed: any = entry.value;
                if (typeof parsed === 'string') {
                    try {
                        parsed = JSON.parse(parsed);
                    } catch (e) {
                        // leave as string
                        parsed = entry.value;
                    }
                }

                if (sub === 'type') result[prop].type = parsed;
                else if (sub === 'required') result[prop].required = parsed;
                else if (sub === 'description') result[prop].description = parsed;
                else result[prop].value = parsed;
            }

            res.json(result);

            DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.ConfigGet`, Date.now() - startTime, new Date());
        });

        app.post(`${controllerRoute}/config`, async (req: Request, res: Response) => {
            const startTime = Date.now();

            DB.pushModuleLog(WhatsappModule.moduleName, 'HTTP', `Configuration update received: ${JSON.stringify(req.body)}`);
            const updates = req.body;
            Object.keys(updates).forEach((key) => {
                DB.setPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.${key}`, updates[key]);
            });
            res.json({ status: 'success' });

            DB.analyticsLogEvent(`Module.${WhatsappModule.moduleName}.ConfigPost`, Date.now() - startTime, new Date());
        });
    }
}
