import fs from 'fs';

export default class DB {
    private static data: { [key: string]: any } = {};

    static setPlainValue(key: string, value: any): void {
        const data = fs.readFileSync('./src/database/data.json', 'utf-8');
        DB.data = JSON.parse(data);

        DB.data[key] = value;
        
        const str = JSON.stringify(this.data)
        fs.writeFileSync('./src/database/data.json', str);
    }

    static getPlainValue(key: string): any {
        const data = fs.readFileSync('./src/database/data.json', 'utf-8');
        DB.data = JSON.parse(data);

        if (!DB.data[key]) return null;
        return DB.data[key];
    }

    static getMatching(keyPrefix: string): { [key: string]: any } {
        const data = fs.readFileSync('./src/database/data.json', 'utf-8');
        DB.data = JSON.parse(data);

        const matching: { [key: string]: any } = {};
        for (const key in DB.data) {
            if (key.startsWith(keyPrefix)) {
                matching[key] = DB.data[key];
            }
        }
        return matching;
    }

    static loadFile(fileName: string): string {
        return fs.readFileSync(`./src/database/files/${fileName}`, 'utf-8');
    }

    static saveFile(fileName: string, content: string): void {
        fs.writeFileSync(`./src/database/files/${fileName}`, content);
    }
}