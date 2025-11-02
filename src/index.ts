import express from 'express';
import WhatsappModule from './modules/whatsapp/whatsapp.module';

const app = express();
const port = process.env.PORT || 3012;

app.use(express.json());

WhatsappModule.register(app);

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

export default app;