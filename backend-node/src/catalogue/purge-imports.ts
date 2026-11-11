import 'dotenv/config';
import { createDatabase, probeDatabase } from '../database.js';
import { readConfig } from '../config.js';
const db=createDatabase(readConfig(process.env).DATABASE_URL);
try{await probeDatabase(db);const result=await db.productImport.updateMany({where:{status:'PREVIEW',expiresAt:{lte:new Date()}},data:{status:'EXPIRED',payload:''}});console.log(JSON.stringify({expired:result.count}));}
finally{await db.$disconnect();}
