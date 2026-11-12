import 'dotenv/config';
import {createDatabase} from '../src/database.js';
import {seedStaging} from '../src/staging/seed.js';
import {stagingTarget} from '../src/staging/guard.js';
stagingTarget(process.env);
const db=createDatabase(process.env.DATABASE_URL!);
try{console.log(JSON.stringify(await seedStaging(db,process.env),null,2));}finally{await db.$disconnect();}
