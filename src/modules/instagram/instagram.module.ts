import { Express, Request, Response } from 'express';
import DB from '../../database/db';
import SocialModuleInterface from "../../interfaces/socialModuleInterface";
import HardLogger from '../../logger/hardLogger';
import ModuleDescriptor, { ModuleActionDescriptor } from '../../interfaces/moduleDescriptor';
import AggregatedMessages from '../../aggregatedMessages';

export default class InstagramModule implements SocialModuleInterface {
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

        // Get user context from File DB
        const ucontext = DB.loadFile(`${userId}.${InstagramModule.moduleName}.ucontext.json`);

        // Get all current step options from ModuleManager.getAvailableActions(${InstagramModule.moduleName}) (Both source and target should have their 'allowModuleInterop' setting to true)
        // Get other user data from ModuleManager.getUserData(userId) this should get data from all modules that export an getUserData function
        // Get Current Speech from DB.loadFile("speech.txt")
        // Get Current User Context from DB.loadFile("${userID}.context.json")

        // Send to OpenAI for processing

        // Recieve Steps

        // ModuleManager.handleSteps(userId, steps);
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
        const accessToken = DB.getPlainValue(`MODULE.${InstagramModule.moduleName}.settings.accessToken`);
        if (!accessToken) {
            HardLogger.log(`Instagram Module: Access Token is not configured.`);
            throw new Error("Instagram Module: Access Token is not configured.");
        }

        const phoneNumber = DB.getPlainValue(`MODULE.${InstagramModule.moduleName}.settings.phoneNumberId`);
        if (!phoneNumber) {
            HardLogger.log(`Instagram Module: Phone Number ID is not configured.`);
            throw new Error("Instagram Module: Phone Number ID is not configured.");
        }
        
        const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumber}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                messaging_product: "instagram",
                to: userId,
                type: "text",
                text: {
                    body: message
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            HardLogger.log(`Instagram Module: Failed to send message. Status: ${response.status}, Response: ${errorText}`);
            throw new Error(`Instagram Module: Failed to send message. Status: ${response.status}`);
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
            const verifyToken = DB.getPlainValue(`MODULE.${InstagramModule.moduleName}.settings.verifyToken`);
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
            res.json(DB.getMatching(`MODULE.${InstagramModule.moduleName}.settings.`, ""));
        });

        app.post(`${controllerRoute}/config`, (req: Request, res: Response) => {
            const updates = req.body;
            Object.keys(updates).forEach((key) => {
                DB.setPlainValue(`MODULE.${InstagramModule.moduleName}.settings.${key}`, updates[key]);
            });
            res.json({ status: 'success' });
        });
    }
}
