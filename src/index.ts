import express from 'express';
import WhatsappModule from './modules/whatsapp/whatsapp.module';
import DB from './database/db';
import dotenv from 'dotenv';

DB.init();

dotenv.config();
DB.setPlainValue('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
DB.setPlainValue('OPENAI_PREFERRED_MODEL', process.env.OPENAI_PREFERRED_MODEL || 'gpt-4o-mini');

const app = express();
const port = process.env.PORT || 3012;

app.use(express.json());

WhatsappModule.register(app);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

export default app;