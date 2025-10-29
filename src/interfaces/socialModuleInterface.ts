import { Express, Request, Response } from 'express';

export default interface SocialModuleInterface {
    webhookInputHandler(req: Request, res: Response): Promise<void>;
    sendMessageHandler(userId: string, message: string): Promise<void>;
    register(app: Express, controllerRoute: string): void;
}