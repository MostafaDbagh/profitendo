import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authHttp } from '../auth/http.js';
import type { AuthService, Tx } from '../auth/service.js';
import { billingState } from '../billing/entitlements.js';
import { ApiError, validateBody } from '../errors.js';
import { fixed, scaled } from '../operations/decimal.js';
import { currencyDigits, exactMoney } from '../sales/money.js';
import { requireOwnerPin, requireBusiness } from './access.js';

const decimal = z.string().regex(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/);
const currencies = z.enum(['USD','EUR','GBP','SAR','AED','EGP','SYP','JOD','IQD','LBP','KWD','QAR','BHD','OMR','YER','TRY']);
const fields = z.object({
  name: z.string().trim().min(1).max(120),
  ownership: decimal.refine(value => Number(value) <= 100),
  capital: decimal,
  currency: currencies,
  notes: z.string().trim().max(2000),
  active: z.boolean(),
}).strict();
const entry = z.object({
  kind: z.enum(['ALLOCATION', 'CONTRIBUTION', 'WITHDRAWAL']),
  amount: decimal.refine(value => Number(value) > 0),
  day: z.iso.date(),
  notes: z.string().trim().max(2000),
  clientKey: z.uuid(),
}).strict();
const paging = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
const pageSize = 25;
function getPage(query: unknown) {
  const result = paging.safeParse(query);
  if (!result.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid pagination');
  return result.data.page;
}

async function findPartner(tx: Tx, businessId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Invalid partner identifier');
  const partner = await tx.partner.findUnique({ where: { businessId_id: { businessId, id } } });
  if (!partner) throw new ApiError(404, 'NOT_FOUND', 'Partner not found');
  return partner;
}

export function partnerRouter(auth: AuthService) {
  // Authentication, origin checks and CSRF are provided by the parent business router.
  const router = Router({ mergeParams: true });
  const { ctx } = authHttp(auth);
  async function owner(tx: Tx, res: Response, businessId: string, write = false) {
    const access = await requireBusiness(auth, tx, ctx(res), businessId, 'business.edit');
    if (access.membership.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', 'Only business owners can access partners');
    requireOwnerPin(access);
    if (write && !(await billingState(tx, businessId)).active) throw new ApiError(402, 'SUBSCRIPTION_REQUIRED', 'Active subscription required');
    return access.user.id;
  }
  router.get('/', async (req: Request, res) => {
    const page = getPage(req.query);
    const businessId = String(req.params.businessId);
    res.json(await auth.transaction(async tx => {
      await owner(tx, res, businessId);
      const where = { businessId };
      const items = await tx.partner.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: pageSize, skip: (page - 1) * pageSize });
      return { items, total: await tx.partner.count({ where }), page, pageSize };
    }));
  });

  router.post('/', validateBody(fields), async (req, res) => {
    const businessId = String(req.params.businessId), input = req.body as z.infer<typeof fields>;
    res.status(201).json(await auth.transaction(async tx => {
      const userId = await owner(tx, res, businessId, true);
      exactMoney(input.capital, currencyDigits(input.currency));
      const partner = await tx.partner.create({ data: { ...input, businessId } });
      await tx.authAudit.create({ data: { userId, businessId, action: 'partner.created', targetId: partner.id } });
      return partner;
    }));
  });

  router.patch('/:id', validateBody(fields.extend({ revision: z.number().int().nonnegative() })), async (req, res) => {
    const businessId = String(req.params.businessId), id = String(req.params.id);
    const { revision, ...input } = req.body as z.infer<typeof fields> & { revision: number };
    res.json(await auth.transaction(async tx => {
      const userId = await owner(tx, res, businessId, true);
      const partner = await findPartner(tx, businessId, id);
      if (partner.revision !== revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Reload before saving');
      if (input.currency !== partner.currency && await tx.partnerTransaction.count({ where: { businessId, partnerId: id } })) {
        throw new ApiError(409, 'PARTNER_CURRENCY_LOCKED', 'Currency cannot change after activity is recorded');
      }
      exactMoney(input.capital, currencyDigits(input.currency));
      const updated = await tx.partner.update({
        where: { businessId_id: { businessId, id } }, data: { ...input, revision: { increment: 1 } },
      });
      await tx.authAudit.create({ data: { userId, businessId, action: 'partner.updated', targetId: id } });
      return updated;
    }));
  });

  router.get('/:id/transactions', async (req: Request, res) => {
    const page = getPage(req.query);
    const businessId = String(req.params.businessId), partnerId = String(req.params.id);
    res.json(await auth.transaction(async tx => {
      await owner(tx, res, businessId);
      const partner = await findPartner(tx, businessId, partnerId);
      const where = { businessId, partnerId };
      const amounts = await tx.partnerTransaction.groupBy({ by: ['kind'], where, _sum: { amount: true } });
      const balance = amounts.reduce((total, row) =>
        total + (row.kind === 'WITHDRAWAL' ? -1n : 1n) * scaled(row._sum.amount?.toFixed(4) ?? '0'), 0n);
      const items = await tx.partnerTransaction.findMany({ where, orderBy: [{ day: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize });
      return { partner, balance: fixed(balance), items, total: await tx.partnerTransaction.count({ where }), page, pageSize };
    }));
  });

  router.post('/:id/transactions', validateBody(entry), async (req, res) => {
    const businessId = String(req.params.businessId), partnerId = String(req.params.id), input = req.body as z.infer<typeof entry>;
    res.status(201).json(await auth.transaction(async tx => {
      const userId = await owner(tx, res, businessId, true);
      const partner = await findPartner(tx, businessId, partnerId);
      const amount = exactMoney(input.amount, currencyDigits(partner.currency));
      const previous = await tx.partnerTransaction.findUnique({
        where: { businessId_partnerId_clientKey: { businessId, partnerId, clientKey: input.clientKey } },
      });
      if (previous) {
        if (previous.kind !== input.kind || scaled(previous.amount.toFixed(4)) !== amount || previous.day !== input.day || previous.notes !== input.notes) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This request has already been used');
        }
        return previous;
      }
      if (!partner.active) throw new ApiError(409, 'PARTNER_INACTIVE', 'Reactivate this partner before recording a transaction');
      await tx.partner.update({ where: { businessId_id: { businessId, id: partnerId } }, data: { revision: { increment: 1 } } });
      const transaction = await tx.partnerTransaction.create({ data: { ...input, businessId, partnerId } });
      await tx.authAudit.create({
        data: { userId, businessId, action: 'partner.transaction.created', targetId: partnerId, changes: { transactionId: transaction.id } },
      });
      return transaction;
    }));
  });
  return router;
}
