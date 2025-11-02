import { Express, Request, Response } from 'express';
import DB from '../../database/db';
import SocialModuleInterface from "../../interfaces/socialModuleInterface";
import HardLogger from '../../logger/hardLogger';
import ModuleDescriptor, { ModuleActionDescriptor } from '../../interfaces/moduleDescriptor';
import AggregatedMessages from '../../aggregatedMessages';
import ModuleManager from '../../moduleManager';
import UsersModule from '../../user/users.module';
import { NetworkResources } from 'inspector/promises';

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

        ModuleManager.registerModule(instance, moduleName);

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

    private async processAggregatedMessages(userId: string): Promise<void> {
        // Get user context from File DB
        DB.loadFile(`${userId}.context.json`);

        // Get all current step options from ModuleManager.getAvailableActions(${WhatsappModule.moduleName}) (Both source and target should have their 'allowModuleInterop' setting to true)
        // Get other user data from ModuleManager.getUserData(userId) this should get data from all modules that export an getUserData function
        // Get Current Speech from DB.loadFile("speech.txt")
        // Get Current User Context from DB.loadFile("${userID}.context.json")

        // Send to OpenAI for processing

        // Recieve Steps

        // ModuleManager.handleSteps(userId, steps);
    }

    async webhookInputHandler(req: Request, res: Response): Promise<void> {
        const userId = req.body.userId;

        let agg = this.agregateRequests.find(a => a.userId === userId);
        if (!agg) agg = new AggregatedMessages(userId, this.processAggregatedMessages.bind(this, userId), 5000);
        agg.pushMessage({ timestamp: req.body.message.timestamp, content: req.body.message.content });
        this.agregateRequests.push(agg);
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
            HardLogger.log(`Received POST webhook: ${JSON.stringify(req.body)}`);

            res.status(200).send('EVENT_RECEIVED');
        });

        app.get(`${controllerRoute}/webhook`, (req: Request, res: Response) => {
            HardLogger.log(`Received GET webhook: ${JSON.stringify(req.body)}`);

            res.status(200).send(req.query['hub.challenge']);
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
