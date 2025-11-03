import { Express, Request, Response } from 'express';
import DB from '../../database/db';
import SocialModuleInterface from "../../interfaces/socialModuleInterface";
import HardLogger from '../../logger/hardLogger';
import ModuleDescriptor, { ModuleActionDescriptor } from '../../interfaces/moduleDescriptor';
import AggregatedMessages from '../../aggregatedMessages';
import OpenAI from "openai";

export default class WhatsappModule implements SocialModuleInterface {
    private static moduleName = "";

    static register(app: Express): ModuleDescriptor {
        const config = require('./config.json');
        const moduleName = config.moduleName;
        this.moduleName = moduleName;

        Object.keys(config).forEach((key) => {
            if (key === 'settings') return
            if (DB.getPlainValue(`MODULE.${moduleName}.statics.${key}`)) return;
            DB.setPlainValue(`MODULE.${moduleName}.statics.${key}`, config[key]);
        });

        Object.keys(config.settings).forEach((key) => {
            if (DB.getPlainValue(`MODULE.${moduleName}.settings.${key}`)) return;
            DB.setPlainValue(`MODULE.${moduleName}.settings.${key}.type`, config.settings[key].type);
            DB.setPlainValue(`MODULE.${moduleName}.settings.${key}.required`, config.settings[key].required);
            DB.setPlainValue(`MODULE.${moduleName}.settings.${key}.description`, config.settings[key].description);
            DB.setPlainValue(`MODULE.${moduleName}.settings.${key}`, config.settings[key].value);
        });

        const instance = new this();
        instance.register(app, config.controllerPath);

        return {
            instance: instance,
            moduleName: moduleName,
            actions: instance.getActionDescriptors()
        }
    }

    private agregateRequests: AggregatedMessages[] = [];

    private getActionDescriptors(): ModuleActionDescriptor[] {
        return [
            { name: "sendMessage", parameters: ["userId", "message"], handler: "@sendMessageHandler" }  // @ is for instance method # is for static method
        ];
    }

    private async processAggregatedMessages(userId: string, messages: { timestamp: number, content: string }[]): Promise<void> {
        HardLogger.log(`Processing aggregated messages for user ${userId}: ${JSON.stringify(messages)}`);
        
        const expectedOutput = DB.loadFile(`${WhatsappModule.moduleName}/expectedOutput`);
        const ucontext = DB.loadFile(`${WhatsappModule.moduleName}/${userId}.ucontext.json`);
        const prompt = DB.loadFile(`prompt`);
        const speech = DB.loadFile(`speech`);


        const client = new OpenAI({ apiKey: DB.getPlainValue('OPENAI_API_KEY') });
        const response = await client.responses.create({
            model: DB.getPlainValue('OPENAI_PREFERRED_MODEL') || 'gpt-4o-mini', // use the preferred model available (configurable via DB)
            input: [
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
            ],
        });

        const steps = JSON.parse(response.output_text)
        console.log(steps)

        for (const step of steps) {
            if (step.action === "ANSWER") {
                await this.sendMessageHandler(userId, step.message);
            } else {
                HardLogger.log(`Unknown action received from OpenAI: ${step.action}`);
            }
        }

    }

    async webhookInputHandler(req: Request, res: Response): Promise<void> {
        for (const entry of req.body.entry[0].changes) {
            const userId = entry.value.contacts[0].wa_id;
            let agg = this.agregateRequests.find(a => a.userId === userId);
            if (!agg) agg = new AggregatedMessages(userId, (messages: { timestamp: number; content: string }[]) => {
                this.processAggregatedMessages(userId, messages);
            }, 10000);

            for (const msg of entry.value.messages) {
                agg.pushMessage({ timestamp: Date.now(), content: msg.text.body });
            }

            this.agregateRequests.push(agg);
        }

        res.status(200).end();
    }

    async sendMessageHandler(userId: string, message: string): Promise<void> {
        const accessToken = DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.accessToken`);
        if (!accessToken) {
            HardLogger.log(`WhatsApp Module: Access Token is not configured.`);
            throw new Error("WhatsApp Module: Access Token is not configured.");
        }

        const phoneNumber = DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.phoneNumberId`);
        if (!phoneNumber) {
            HardLogger.log(`WhatsApp Module: Phone Number ID is not configured.`);
            throw new Error("WhatsApp Module: Phone Number ID is not configured.");
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
            HardLogger.log(`WhatsApp Module: Failed to send message. Status: ${response.status}, Response: ${errorText}`);
            throw new Error(`WhatsApp Module: Failed to send message. Status: ${response.status}`);
        }

        console.log(await response.text());
    }

    register(app: Express, controllerRoute: string): void {
        // register webhook route
        app.post(`${controllerRoute}/webhook`, (req: Request, res: Response) => {
            this.webhookInputHandler(req, res).catch(err => {
                HardLogger.log(`Error processing webhook input: ${err}`);
                res.status(500).end();
            });

            res.status(200).end();
        });

        app.get(`${controllerRoute}/webhook`, (req: Request, res: Response) => {
            const verifyToken = DB.getPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.verifyToken`);
            const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

            if (mode === 'subscribe' && token === verifyToken) {
                console.log('WEBHOOK VERIFIED');
                res.status(200).send(challenge);
            } else {
                res.status(403).end();
            }
        });

        // register config update route
        app.get(`${controllerRoute}/config`, (req: Request, res: Response) => {
            res.json(DB.getMatching(`MODULE.${WhatsappModule.moduleName}.settings.`, ""));
        });

        app.post(`${controllerRoute}/config`, (req: Request, res: Response) => {
            const updates = req.body;
            Object.keys(updates).forEach((key) => {
                DB.setPlainValue(`MODULE.${WhatsappModule.moduleName}.settings.${key}`, updates[key]);
            });
            res.json({ status: 'success' });
        });
    }
}
