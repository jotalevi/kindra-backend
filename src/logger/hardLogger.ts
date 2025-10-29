import fs from 'fs';

export default class HardLogger {
    static log(message: string): void {
        console.log(`[HardLogger] ${message}`);
        fs.writeFileSync(`./src/logger/logs/${Date.now()}.log`, message);
    }
}