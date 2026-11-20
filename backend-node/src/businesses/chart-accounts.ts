import { Router, type Response } from 'express';
import { z } from 'zod';
import { authHttp } from '../auth/http.js';
import type { AuthService, Tx } from '../auth/service.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError, validateBody } from '../errors.js';
import { requireOwnerPin, requireBusiness } from './access.js';

const categories = ['assets','liabilities','equity','revenue','cost_of_sales','expenses'] as const;
const names = [
  [['Assets','الأصول'],['Cash','النقدية'],['Bank','البنك'],['Accounts Receivable','العملاء (ذمم مدينة)'],['Inventory','المخزون'],['Fixed Assets','الأصول الثابتة'],['Prepaid Expenses','مصروفات مدفوعة مسبقًا']],
  [['Liabilities','الالتزامات'],['Accounts Payable','الموردون (ذمم دائنة)'],['Loans','القروض'],['Taxes Payable','الضرائب المستحقة'],['Salaries Payable','الرواتب المستحقة']],
  [['Equity','حقوق الملكية'],['Capital','رأس المال'],['Owner Withdrawals','مسحوبات المالك'],['Retained Earnings','الأرباح المحتجزة']],
  [['Revenue','الإيرادات'],['Product Sales','مبيعات المنتجات'],['Service Revenue','إيرادات الخدمات'],['Other Revenue','إيرادات أخرى']],
  [['Cost of Sales','تكلفة المبيعات'],['Cost of Goods Sold','تكلفة البضاعة المباعة'],['Purchase Shipping','شحن المشتريات'],['Direct Costs','تكاليف مباشرة']],
  [['Expenses','المصاريف'],['Rent','الإيجار'],['Salaries','الرواتب'],['Marketing','التسويق'],['Transportation','المواصلات'],['Communications','الاتصالات'],['Commissions','العمولات'],['Bank Charges','المصاريف البنكية']],
];
const defaults = new Map(categories.flatMap((category,index) => names[index]!.map(([name,nameAr],row) => {
  const code = String((index+1)*1000 + row*100);
  const nature = ['assets','cost_of_sales','expenses'].includes(category) ? 'debit' : 'credit';
  return [code,{code,name:name!,nameAr:nameAr!,category,nature,active:true,system:true,revision:0}] as const;
})));
const codeSchema = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/).transform(code => code.toUpperCase());
const fields = z.object({
  name:z.string().trim().min(1).max(120), category:z.enum(categories), nature:z.enum(['debit','credit']), active:z.boolean(),
}).strict();
const revision = z.number().int().nonnegative();
const maxCustomAccounts = 500;

export async function readChartAccounts(tx: Tx, businessId: string) {
  const rows = await tx.chartAccount.findMany({where:{businessId}});
  const effective = new Map<string, {
    code:string; name:string; nameAr?:string; category:string; nature:string; active:boolean; system:boolean; revision:number;
  }>(defaults);
  for (const {businessId:_,...row} of rows) {
    const template = defaults.get(row.code);
    effective.set(row.code,{...row,system:Boolean(template),...(template?.name===row.name && {nameAr:template.nameAr})});
  }
  return [...effective.values()].sort((a,b) => a.code.localeCompare(b.code,'en',{numeric:true}));
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
        if(defaults.has(input.code)) throw new ApiError(409,'ACCOUNT_CODE_EXISTS','This account code already exists');
        if(await tx.chartAccount.count({where:{businessId,code:{notIn:[...defaults.keys()]}}})>=maxCustomAccounts) {
          throw new ApiError(409,'ACCOUNT_LIMIT_REACHED','Custom account limit reached');
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
      const stored=await tx.chartAccount.findUnique({where}), template=defaults.get(code);
      const before=stored??template;
      if(!before) throw new ApiError(404,'NOT_FOUND','Account not found');
      if(before.revision!==expected) throw new ApiError(409,'REVISION_CONFLICT','Reload before saving');
      if(template && (input.category!==template.category || input.nature!==template.nature)) {
        throw new ApiError(422,'SYSTEM_ACCOUNT','Starter account classification is fixed');
      }
      const row=stored
        ? await tx.chartAccount.update({where,data:{...input,revision:{increment:1}}})
        : await tx.chartAccount.create({data:{...input,businessId,code,revision:1}});
      await tx.authAudit.create({data:{businessId,userId,action:'chart_account.updated',changes:{code}}});
      return row;
    }));
  });
  router.delete('/:code',validateBody(z.object({revision}).strict()),async(req,res) => {
    const businessId=String(req.params.businessId), code=String(req.params.code);
    res.json(await auth.transaction(async tx => {
      const userId=await owner(tx,res,businessId,true);
      if(defaults.has(code)) throw new ApiError(409,'SYSTEM_ACCOUNT','Starter accounts cannot be deleted');
      const removed=await tx.chartAccount.deleteMany({where:{businessId,code,revision:req.body.revision}});
      if(!removed.count) throw new ApiError(409,'REVISION_CONFLICT','Reload before deleting');
      await tx.authAudit.create({data:{businessId,userId,action:'chart_account.deleted',changes:{code}}});
      return {ok:true};
    }));
  });
  return router;
}
