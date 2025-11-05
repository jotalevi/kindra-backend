import { info } from 'console';
import fs from 'fs';

export default class HardLogger {
    static log(message: string): void {
        console.log(`[HardLogger] ${message}`);
        fs.appendFileSync('hardlogger.log', `[${new Date().toISOString()}] ${message}\n`);
    }

    static info(message: string): void {
        this.log(`INFO: ${message}`);
    }

    static warn(message: string): void {
        this.log(`WARN: ${message}`);
    }

    static error(message: string): void {
        this.log(`ERROR: ${message}`);
    }
}