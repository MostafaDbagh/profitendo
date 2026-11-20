import { Router, type Response } from 'express';
import { z } from 'zod';
import { authHttp } from '../auth/http.js';
import type { AuthService, Tx } from '../auth/service.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError, validateBody } from '../errors.js';
import { requireOwnerPin, requireBusiness } from './access.js';

const categories = ['assets','liabilities','equity','revenue','cost_of_sales','expenses'] as const;
const codeSchema = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/).transform(code => code.toUpperCase());
const fields = z.object({
  name:z.string().trim().min(1).max(120), category:z.enum(categories), nature:z.enum(['debit','credit']), active:z.boolean(),
}).strict();
const revision = z.number().int().nonnegative();
const maxAccounts = 500;

export async function readChartAccounts(tx: Tx, businessId: string) {
  const rows = await tx.chartAccount.findMany({where:{businessId}});
  return rows.map(({businessId:_,...row})=>row).sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true}));
}

export function chartAccountsRouter(auth: AuthService) {
  const router = Router({mergeParams:true});
  const {ctx} = authHttp(auth);
  async function owner(tx: Tx, res: Response, businessId: string, writable = false) {
    const access = await requireBusiness(auth,tx,ctx(res),businessId,'business.edit');
    if (access.membership.role !== 'OWNER') throw new ApiError(403,'FORBIDDEN','Only owners may manage the chart of accounts');
    requireOwnerPin(access);
    if (writable && !(await billingState(tx,businessId)).active) throw new ApiError(402,'SUBSCRIPTION_REQUIRED','Active subscription required');
    return access.user.id;
  }
  router.get('/', async (req,res) => {
    const businessId = String((req.params as Record<string,string>).businessId);
    res.json(await auth.transaction(async tx => {
      await owner(tx,res,businessId);
      return {items:await readChartAccounts(tx,businessId)};
    }));
  });
  router.post('/',validateBody(fields.extend({code:codeSchema})),async(req,res) => {
    const businessId=String(req.params.businessId), input=req.body as z.infer<typeof fields> & {code:string};
    try {
      res.status(201).json(await auth.transaction(async tx => {
        const userId=await owner(tx,res,businessId,true);
        if(await tx.chartAccount.count({where:{businessId}})>=maxAccounts) {
          throw new ApiError(409,'ACCOUNT_LIMIT_REACHED','Account limit reached');
        }
        const row=await tx.chartAccount.create({data:{businessId,...input}});
        await tx.authAudit.create({data:{businessId,userId,action:'chart_account.created',changes:{code:row.code}}});
        return row;
      }));
    } catch(error) {
      if((error as {code?:string}).code==='P2002') throw new ApiError(409,'ACCOUNT_CODE_EXISTS','This account code already exists');
      throw error;
    }
  });
  router.patch('/:code',validateBody(fields.extend({revision})),async(req,res) => {
    const businessId=String(req.params.businessId), code=String(req.params.code);
    const {revision:expected,...input}=req.body as z.infer<typeof fields> & {revision:number};
    res.json(await auth.transaction(async tx => {
      const userId=await owner(tx,res,businessId,true);
      const where={businessId_code:{businessId,code}};
      const stored=await tx.chartAccount.findUnique({where});
      if(!stored) throw new ApiError(404,'NOT_FOUND','Account not found');
      if(stored.revision!==expected) throw new ApiError(409,'REVISION_CONFLICT','Reload before saving');
      const row=await tx.chartAccount.update({where,data:{...input,revision:{increment:1}}});
      await tx.authAudit.create({data:{businessId,userId,action:'chart_account.updated',changes:{code}}});
      return row;
    }));
  });
  router.delete('/:code',validateBody(z.object({revision}).strict()),async(req,res) => {
    const businessId=String(req.params.businessId), code=String(req.params.code);
    res.json(await auth.transaction(async tx => {
      const userId=await owner(tx,res,businessId,true);
      const removed=await tx.chartAccount.deleteMany({where:{businessId,code,revision:req.body.revision}});
      if(!removed.count) throw new ApiError(409,'REVISION_CONFLICT','Reload before deleting');
      await tx.authAudit.create({data:{businessId,userId,action:'chart_account.deleted',changes:{code}}});
      return {ok:true};
    }));
  });
  return router;
}
