import OpenAI from "openai";
import DB from "../../database/db";

export default class OpenAiModule {
    static moduleName = 'OpenAI';

    static async getSteps(input: { role: string, content: string }[]): Promise<any> {
        const startTime = Date.now();

        const client = new OpenAI({ apiKey: ((await DB.getPlainValue('CONFIG.OPENAI_API_KEY')) ?? '"key"').replace(/"/g, '') });
        const response = await client.responses.create({
            model: ((await DB.getPlainValue('CONFIG.OPENAI_PREFERRED_MODEL')) || '"gpt-4o-mini"').replace(/"/g, ''),
            input: [...input] as any[],
        });

        DB.analyticsLogEvent(`Module.${this.moduleName}.GetSteps`, Date.now() - startTime, new Date());
        return JSON.parse(response.output_text)
    }

}