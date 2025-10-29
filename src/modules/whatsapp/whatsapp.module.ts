import { Express, Request, Response } from 'express';
import DB from '../../database/db';
import SocialModuleInterface from "../../interfaces/socialModuleInterface";
import HardLogger from '../../logger/hardLogger';

export default class WhatsappModule implements SocialModuleInterface {    
    private static moduleName = "";

    static register(app: Express): void {
        const config = require('./whatsappModule.config.json');
        WhatsappModule.moduleName = config.moduleName;
        
        Object.keys(config).forEach((key) => {
            if (key === 'settings') return
            DB.setPlainValue(`${WhatsappModule.moduleName}.statics.${key}`, config[key]);
        });

        Object.keys(config.settings).forEach((key) => {
            DB.setPlainValue(`${WhatsappModule.moduleName}.settings.${key}.type`, config.settings[key].type);
            DB.setPlainValue(`${WhatsappModule.moduleName}.settings.${key}.required`, config.settings[key].required);
            DB.setPlainValue(`${WhatsappModule.moduleName}.settings.${key}.description`, config.settings[key].description);
            DB.setPlainValue(`${WhatsappModule.moduleName}.settings.${key}`, config.settings[key].value);
        });
            
        const instance = new WhatsappModule();
        instance.register(app, config.controllerPath);
    }

    async webhookInputHandler(req: Request, res: Response): Promise<void> {
    }

    async sendMessageHandler(userId: string, message: string): Promise<void> {
    }

    register(app: Express, controllerRoute: string): void {
        // register webhook route
        app.post(`${controllerRoute}/webhook`, (req: Request, res: Response) => {
            HardLogger.log(`Received webhook: ${JSON.stringify(req.body)}`);

            res.json({ req:req.body });
        });

        // register config update route
        app.get(`${controllerRoute}/config`, (req: Request, res: Response) => {
            res.json(DB.getMatching(`${WhatsappModule.moduleName}.settings.`));
        });

        app.post(`${controllerRoute}/config`, (req: Request, res: Response) => {
            const updates = req.body;
            Object.keys(updates).forEach((key) => {
                DB.setPlainValue(`${WhatsappModule.moduleName}.settings.${key}`, updates[key]);
            });
            res.json({ status: 'success' });
        });
    }
}
