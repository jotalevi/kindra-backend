import express from 'express';
import DB from './database/db';

// Import modules
import WhatsappModule from './modules/whatsapp/whatsapp.module';

const app = express();
const port = process.env.PORT || 3012;

app.use(express.json());

// get all modules under src/modules and register them programatically
WhatsappModule.register(app);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

export default app;