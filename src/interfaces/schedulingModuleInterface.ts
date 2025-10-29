import { Express, Request, Response } from 'express';

export default interface SchedulingModuleInterface {
    webhookInputHandler(req: Request, res: Response): Promise<void>;
    createScheduleHandler(userId: string, scheduleData: any): Promise<void>;
    updateScheduleHandler(scheduleId: string, scheduleData: any): Promise<void>;
    cancelScheduleHandler(scheduleId: string): Promise<void>;
    confirmScheduleHandler(scheduleId: string): Promise<void>;
    register(app: Express, controllerRoute: string): void;
}