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

    static wildcardQuery(where: string): Promise<{key: string, value: string}[] | null> {
        return new Promise<{key: string, value: string}[] | null>((resolve, reject) => {
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
}