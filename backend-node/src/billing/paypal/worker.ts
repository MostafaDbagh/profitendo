import 'dotenv/config';
import { createDatabase, probeDatabase } from '../../database.js';
import { readConfig } from '../../config.js';
import { readAuthSettings } from '../../auth/settings.js';
import { AuthService } from '../../auth/service.js';
import { readPayPalSettings } from './settings.js';
import { PayPalClient } from './client.js';
import { processWebhookBatch } from './inbox.js';
import { processCancellationBatch } from './cancellation.js';
const config=readConfig(process.env),settings=readPayPalSettings(process.env);
if(!settings)throw new Error('Configure the B2B PayPal provider before running its worker');
const db=createDatabase(config.DATABASE_URL);
try {
  await probeDatabase(db);
  const auth=new AuthService(db,readAuthSettings(process.env)),provider=new PayPalClient(settings);
  const cancellations=await processCancellationBatch(auth,provider);
  const webhooks=await processWebhookBatch(auth,provider);
  console.log(JSON.stringify({cancellations,webhooks}));
}
finally{await db.$disconnect();}
