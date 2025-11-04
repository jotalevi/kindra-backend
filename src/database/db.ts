import fs from 'fs';
import sqlite3 from 'sqlite3';
import HardLogger from '../logger/hardLogger';

export default class DB {
    private static db: sqlite3.Database;

    // Validate table names to avoid SQL injection / invalid identifiers
    private static sanitizeTableName(name: string): string {
        if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Invalid table name');
        return name;
    }

    static async init(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            DB.db = new sqlite3.Database('./src/database/data.db', (err) => {
                if (err) return reject(err);
                // Ensure the primary storage table exists before any operations run
                DB.db.run("CREATE TABLE IF NOT EXISTS data (key TEXT PRIMARY KEY, value TEXT)", (createErr: any) => {
                    if (createErr) return reject(createErr);
                    resolve();
                });
            });
        });
    }

    static setPlainValue(key: string, value: any): void {
        HardLogger.log(`DB: Setting key ${key} to value ${JSON.stringify(value)}`);

        if (!DB.db) throw new Error('Database not initialized. Call DB.init() before using the DB.');

        // Run creation + insert in a serialized sequence to avoid race conditions
        DB.db.serialize(() => {
            DB.db.run("CREATE TABLE IF NOT EXISTS data (key TEXT PRIMARY KEY, value TEXT)");
            const stmt = DB.db.prepare("INSERT OR REPLACE INTO data (key, value) VALUES (?, ?)");
            stmt.run(key, JSON.stringify(value));
            stmt.finalize();
        });
    }

    // Async version that resolves when the write completes
    static setPlainValueAsync(key: string, value: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!DB.db) return reject(new Error('Database not initialized. Call DB.init() before using the DB.'));

            DB.db.serialize(() => {
                DB.db.run("CREATE TABLE IF NOT EXISTS data (key TEXT PRIMARY KEY, value TEXT)", (createErr: any) => {
                    if (createErr) return reject(createErr);

                    const stmt = DB.db.prepare("INSERT OR REPLACE INTO data (key, value) VALUES (?, ?)");
                    stmt.run(key, JSON.stringify(value), (runErr: any) => {
                        if (runErr) {
                            stmt.finalize(() => reject(runErr));
                        } else {
                            stmt.finalize((finalizeErr: any) => {
                                if (finalizeErr) return reject(finalizeErr);
                                resolve();
                            });
                        }
                    });
                });
            });
        });
    }

    static getPlainValue(key: string): Promise<string | null> {
        // retrieve from Local SQLITE DB
        return new Promise<string | null>((resolve, reject) => {
            if (!DB.db) return reject(new Error('Database not initialized. Call DB.init() before using the DB.'));

            DB.db.get("SELECT value FROM data WHERE key = ?", [key], (err: any, row: { value: string; } | undefined) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.value : null);
                }
            });
        });
    }

    static wildcardQuery(where: string): Promise<{ key: string, value: string }[] | null> {
        return new Promise<{ key: string, value: string }[] | null>((resolve, reject) => {
            if (!DB.db) return reject(new Error('Database not initialized. Call DB.init() before using the DB.'));

            DB.db.all("SELECT key, value FROM data WHERE key LIKE ?", [where.replace('*', '%')], (err: any, rows: { key: string; value: string; }[]) => {
                if (err) {
                    reject(err);
                } else {
                    const values = rows.map(row => row.value);
                    resolve(rows.length > 0 ? rows : null);
                }
            });
        });
    }

    static hitFile(fileName: string): boolean {
        const filePath = `./src/database/files/${fileName}`;
        return fs.existsSync(filePath);
    }

    static loadFile(fileName: string, force: boolean = false): string {
        const filePath = `./src/database/files/${fileName}`;
        if (!fs.existsSync(filePath) && force) fs.writeFileSync(filePath, '');

        return fs.readFileSync(filePath, 'utf-8');
    }

    static saveFile(fileName: string, content: string, force: boolean = false): void {
        if (!fs.existsSync(`./src/database/files/${fileName}`) && !force) throw new Error(`File ${fileName} does not exist.`);

        fs.writeFileSync(`./src/database/files/${fileName}`, content);
    }

    static pushModuleLog(moduleName: string, type: string, logMessage: string): void {
        if (!DB.db) throw new Error('Database not initialized. Call DB.init() before using the DB.');

        const safeModule = DB.sanitizeTableName(moduleName);
        const tableName = `${safeModule}_logs`;

        // Ensure table exists and insert in a serialized sequence
        DB.db.serialize(() => {
            DB.db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, type TEXT, content TEXT)`);
            const stmt = DB.db.prepare(`INSERT INTO ${tableName} (type, content) VALUES (?, ?)`);
            stmt.run(type, logMessage);
            stmt.finalize();
        });
    }

    static getModuleLogs(moduleName: string, limit: number = 100): Promise<{ timestamp: string, type: string, content: string }[]> {
        if (!DB.db) return Promise.reject(new Error('Database not initialized. Call DB.init() before using the DB.'));

        const safeModule = DB.sanitizeTableName(moduleName);
        const tableName = `${safeModule}_logs`;

        return new Promise<{ timestamp: string, type: string, content: string }[]>((resolve, reject) => {
            // Ensure the table exists before attempting to query it
            DB.db.serialize(() => {
                DB.db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, type TEXT, content TEXT)`);
                DB.db.all(`SELECT timestamp, type, content FROM ${tableName} ORDER BY timestamp DESC LIMIT ?`, [limit], (err: any, rows: { timestamp: string, type: string, content: string }[]) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            });
        });
    }

    static analyticsLogEvent(eventType: string, duration: number, at: Date): void {
        if (!DB.db) throw new Error('Database not initialized. Call DB.init() before using the DB.');
        DB.db.serialize(() => {
            DB.db.run("CREATE TABLE IF NOT EXISTS analytics (event_type TEXT, duration INTEGER, at DATETIME)");
            const stmt = DB.db.prepare("INSERT INTO analytics (event_type, duration, at) VALUES (?, ?, ?)");
            stmt.run(eventType, duration, at.toISOString());
            stmt.finalize();
        });
    }

    static getAnalyticsEvents(periods: { from: Date, to: Date }[]): Promise<{
        eventType: string;
        averageDuration: number;
        occurrences: number;
        highestDuration: number;
        lowestDuration: number;
        from: string;
        to: string;
    }[]> {
        return new Promise<{
            eventType: string;
            averageDuration: number;
            occurrences: number;
            highestDuration: number;
            lowestDuration: number;
            from: string;
            to: string;
        }[]>((resolve, reject) => {
            if (!DB.db) return reject(new Error('Database not initialized. Call DB.init() before using the DB.'));

            const placeholders = periods.map(() => '(?, ?)').join(',');
            const sql = `SELECT event_type, AVG(duration) as average_duration, COUNT(*) as occurrences, MAX(duration) as highest_duration, MIN(duration) as lowest_duration, ? as from, ? as to
                         FROM analytics
                         WHERE (at BETWEEN ? AND ?)
                         GROUP BY event_type
                         ORDER BY average_duration DESC`;

            DB.db.all(sql, [...periods.flatMap(p => [p.from.toISOString(), p.to.toISOString()])], (err, rows: { eventType: string; average_duration: number; occurrences: number; highest_duration: number; lowest_duration: number; from: string; to: string; }[]) => {
                if (err) return reject(err);
                resolve(rows.map(row => new AnaliticEventsQueryResponse(
                    row.eventType,
                    row.average_duration,
                    row.occurrences,
                    row.highest_duration,
                    row.lowest_duration,
                    row.from,
                    row.to
                )));
            });
        });
    }
}

class AnaliticEventsQueryResponse {
    eventType: string;
    averageDuration: number;
    occurrences: number;
    highestDuration: number;
    lowestDuration: number;
    from: string;
    to: string;

    constructor(eventType: string, averageDuration: number, occurrences: number, highestDuration: number, lowestDuration: number, from: string, to: string) {
        this.eventType = eventType;
        this.averageDuration = averageDuration;
        this.occurrences = occurrences;
        this.highestDuration = highestDuration;
        this.lowestDuration = lowestDuration;
        this.from = from;
        this.to = to;
    }
}

export { AnaliticEventsQueryResponse };