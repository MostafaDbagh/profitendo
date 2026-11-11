import { z } from 'zod';
import { ApiError } from '../../errors.js';
export const subscriptionId = z.string().regex(/^I-[A-Z0-9]{3,62}$/);
export const providerPlanId = z.string().regex(/^P-[A-Z0-9]{24}$/);
export const dateTime = z.string().datetime({ offset: true });
export const snapshotSchema = z.object({ id: subscriptionId, plan_id: providerPlanId, custom_id: z.string().uuid(),
  status: z.enum(['APPROVAL_PENDING','APPROVED','ACTIVE','SUSPENDED','CANCELLED','EXPIRED']), status_update_time: dateTime,
  quantity: z.string().optional(), plan_overridden: z.boolean().optional(),
  shipping_amount: z.object({ value: z.string(), currency_code: z.string() }).optional(),
  billing_info: z.object({ next_billing_time: dateTime.optional() }).optional(),
  links: z.array(z.object({ rel: z.string(), href: z.string().url() })).optional() });
export type SubscriptionSnapshot = z.infer<typeof snapshotSchema>;
export const webhookSchema = z.object({ id: z.string().min(1).max(128), event_type: z.string().regex(/^[A-Z][A-Z0-9_.]{1,127}$/), create_time: dateTime, resource: z.record(z.string(), z.unknown()) }).passthrough();
export type PayPalEvent = z.infer<typeof webhookSchema>;
export function minorUnits(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value)) throw new ApiError(422,'PROVIDER_AMOUNT_INVALID','Invalid provider amount');
  const [whole,fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
}
export function assertBinding(snapshot: SubscriptionSnapshot, intent: { id: string; providerPlanId: string; providerSubscriptionId: string | null }) {
  if (snapshot.custom_id !== intent.id || snapshot.plan_id !== intent.providerPlanId || (intent.providerSubscriptionId && snapshot.id !== intent.providerSubscriptionId)
    || (snapshot.quantity !== undefined && snapshot.quantity !== '1') || snapshot.plan_overridden === true || (snapshot.shipping_amount && minorUnits(snapshot.shipping_amount.value) !== 0)) {
    throw new ApiError(409,'PROVIDER_BINDING_MISMATCH','Provider subscription does not match its business checkout');
  }
}
export function assertPlanTerms(raw: unknown, local: { priceMinor: number | null; currency: string; interval: string }, options: { allowInactive?: boolean } = {}) {
  const parsed = z.object({ status: z.enum(['ACTIVE','INACTIVE']), quantity_supported: z.boolean().optional(),
    billing_cycles: z.array(z.object({ tenure_type: z.literal('REGULAR'), sequence: z.literal(1), total_cycles: z.literal(0),
      frequency: z.object({ interval_unit: z.enum(['MONTH','YEAR']), interval_count: z.literal(1) }),
      pricing_scheme: z.object({ fixed_price: z.object({ currency_code: z.string(), value: z.string() }), pricing_model: z.string().optional() }) })).length(1),
    payment_preferences: z.object({ setup_fee: z.object({ currency_code: z.string(), value: z.string() }).optional() }).optional(),
    taxes: z.object({ percentage: z.string() }).optional() }).safeParse(raw);
  if (!parsed.success || !local.priceMinor) throw new ApiError(409,'PROVIDER_PLAN_MISMATCH','Provider plan terms do not match');
  const plan = parsed.data, cycle = plan.billing_cycles[0]!;
  if ((!options.allowInactive && plan.status !== 'ACTIVE') || plan.quantity_supported || cycle.pricing_scheme.pricing_model || cycle.frequency.interval_unit !== local.interval
    || cycle.pricing_scheme.fixed_price.currency_code !== local.currency || minorUnits(cycle.pricing_scheme.fixed_price.value) !== local.priceMinor
    || (plan.payment_preferences?.setup_fee && minorUnits(plan.payment_preferences.setup_fee.value) !== 0)
    || (plan.taxes && minorUnits(plan.taxes.percentage) !== 0)) throw new ApiError(409,'PROVIDER_PLAN_MISMATCH','Provider plan terms do not match');
}
