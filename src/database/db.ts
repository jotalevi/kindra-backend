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

    static getMatching(keyPrefix: string = "", suffix: string = ""): { [key: string]: any } {
        const data = fs.readFileSync('./src/database/data.json', 'utf-8');
        DB.data = JSON.parse(data);

        const matching: { [key: string]: any } = {};
        for (const key in DB.data) {
            if (key.startsWith(keyPrefix) && key.endsWith(suffix)) {
                matching[key] = DB.data[key];
            }
        }
        return matching;
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
}