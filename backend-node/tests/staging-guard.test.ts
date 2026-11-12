import {it,expect} from 'vitest';
import {stagingTarget,checkSeedEnvironment} from '../src/staging/guard.js';
import type {PrismaClient} from '../src/generated/prisma/client.js';
const safe={APP_ENV:'staging',MOCK_DATA_ENABLED:'true',DATABASE_URL:'postgresql://user:password@localhost/demo_staging'};
it('requires explicit matching environment and dedicated database',()=>{
 expect(stagingTarget(safe)).toBe('demo_staging');
 expect(stagingTarget({...safe,NODE_ENV:'production'})).toBe('demo_staging'); // production runtime is normal on remote staging
 expect(stagingTarget({...safe,APP_ENV:'preprod',DATABASE_URL:'postgresql://user:password@localhost/demo_preprod'})).toBe('demo_preprod');
 for(const override of [{APP_ENV:'production'},{APP_ENV:undefined},{MOCK_DATA_ENABLED:'false'},{DATABASE_URL:'postgresql://u:p@localhost/customer_db'},{DATABASE_URL:'postgresql://u:p@production.example.com/demo_staging'},{DATABASE_URL:'postgresql://u:p@localhost/prod_staging'},{DATABASE_URL:'postgresql://u:p@localhost/demo_preprod'},{DATABASE_URL:'file:///demo_staging'},{B2B_PAYPAL_MODE:'live'},{B2B_CHECKOUT_ENABLED:'true'},{B2B_PAYPAL_CLIENT_ID:'configured'},{B2B_PAYPAL_CLIENT_SECRET:'configured'},{B2B_PAYPAL_WEBHOOK_ID:'configured'}])expect(()=>stagingTarget({...safe,...override})).toThrow();
});
it('refuses a seeded database at runtime outside staging even if mock flag is removed',async()=>{
 const marked={systemMetadata:{findUnique:async()=>({key:'staging-demo-v1'})}} as unknown as PrismaClient;
 await expect(checkSeedEnvironment(marked,{APP_ENV:'production'})).rejects.toThrow();
 await expect(checkSeedEnvironment(marked,{...safe,MOCK_DATA_ENABLED:undefined})).rejects.toThrow();
 await expect(checkSeedEnvironment(marked,safe)).resolves.toBeUndefined();
 const clean={systemMetadata:{findUnique:async()=>null}} as unknown as PrismaClient;
 await expect(checkSeedEnvironment(clean,{APP_ENV:'production'})).resolves.toBeUndefined();
});
