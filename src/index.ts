import express from 'express';
import WhatsappModule from './modules/whatsapp/whatsapp.module';
import DB from './database/db';
import dotenv from 'dotenv';

dotenv.config();
DB.setPlainValue('OPENAI_API_KEY', process.env.OPENAI_API_KEY);

const app = express();
const port = process.env.PORT || 3012;

app.use(express.json());

WhatsappModule.register(app);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

export default app;