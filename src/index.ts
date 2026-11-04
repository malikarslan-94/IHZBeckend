import { app } from './app.js';
import { env } from './config/env.js';
import { db } from './config/db.js';
import { closeBrowser } from './lib/pdf.js';
const server = app.listen(env.PORT, () => console.log(`Islamabad Health Zone API ready on port ${env.PORT}`));
async function shutdown() {
  server.close();
  await closeBrowser();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
