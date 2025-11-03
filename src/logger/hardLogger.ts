import fs from 'fs';

export default class HardLogger {
    static log(message: string): void {
        console.log(`[HardLogger] ${message}`);
        fs.appendFileSync('hardlogger.log', `[${new Date().toISOString()}] ${message}\n`);
    }
}