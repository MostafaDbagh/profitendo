import { z } from 'zod';
import { ApiError } from '../../errors.js';
import { providerPlanId, snapshotSchema, subscriptionId, type SubscriptionSnapshot, type PayPalEvent } from './contracts.js';
import type { PayPalSettings } from './settings.js';
export type WebhookHeaders = Record<string, string | undefined>;
export interface PayPalProvider {
  readonly scope: string;
  getPlan(id: string): Promise<unknown>;
  createSubscription(planId: string, intentId: string, appOrigin: string): Promise<SubscriptionSnapshot>;
  getSubscription(id: string): Promise<SubscriptionSnapshot>;
  cancelSubscription(id: string): Promise<void>;
  verifyWebhook(headers: WebhookHeaders, event: PayPalEvent): Promise<void>;
}
const upstream = () => new ApiError(502,'PAYMENT_PROVIDER_UNAVAILABLE','Payment provider request failed');
async function json(response: Response): Promise<unknown> {
  if (!response.body) throw upstream();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 1024 * 1024) { await reader.cancel(); throw upstream(); } chunks.push(value); } }
  catch { throw upstream(); }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw upstream(); }
}
export class PayPalClient implements PayPalProvider {
  readonly scope: string;
  private cached?: { token: string; expiresAt: number };
  private refreshing?: Promise<string>;
  constructor(readonly settings: PayPalSettings, private readonly transport: typeof fetch = fetch) { this.scope = settings.scope; }
  private async send(path: string, init: RequestInit) {
    try { return await this.transport(`${this.settings.baseUrl}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw upstream(); }
  }
  private async token() {
    if (this.cached && this.cached.expiresAt > Date.now() + 60000) return this.cached.token;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await this.send('/v1/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.settings.clientId}:${this.settings.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' });
      if (!response.ok) { await response.body?.cancel(); throw upstream(); }
      const parsed = z.object({ access_token: z.string().min(1).max(8192), expires_in: z.number().int().positive().max(86400), token_type: z.string().refine(v => v.toLowerCase() === 'bearer') }).safeParse(await json(response));
      if (!parsed.success) throw upstream();
      this.cached = { token: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 }; return this.cached.token;
    })();
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }
  private async request(path: string, method = 'GET', body?: unknown, requestId?: string, empty = false) {
    const token = await this.token();
    const response = await this.send(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId, Prefer: 'return=representation' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) { if (response.status === 401) this.cached = undefined; await response.body?.cancel(); throw upstream(); }
    if (empty) {
      await response.body?.cancel();
      if (response.status !== 204) throw upstream();
      return undefined;
    }
    return json(response);
  }
  async cancelSubscription(id: string) {
    await this.request(`/v1/billing/subscriptions/${subscriptionId.parse(id)}/cancel`, 'POST',
      { reason: 'Cancellation requested by the business owner' }, undefined, true);
  }
  async getPlan(id: string) {
    const result = await this.request(`/v1/billing/plans/${providerPlanId.parse(id)}`);
    const parsed = z.object({ id: providerPlanId }).safeParse(result);
    if (!parsed.success || parsed.data.id !== id) throw upstream();
    return result;
  }
  async getSubscription(id: string) {
    const data = snapshotSchema.safeParse(await this.request(`/v1/billing/subscriptions/${subscriptionId.parse(id)}`));
    if (!data.success || data.data.id !== id) throw upstream(); return data.data;
  }
  async createSubscription(planId: string, intentId: string, appOrigin: string) {
    providerPlanId.parse(planId); z.string().uuid().parse(intentId);
    const origin = new URL(appOrigin); if (!['http:','https:'].includes(origin.protocol) || origin.origin !== appOrigin) throw new Error('Invalid configured application origin');
    const result = await this.request('/v1/billing/subscriptions','POST',{ plan_id: planId, custom_id: intentId, quantity: '1', application_context: { brand_name: 'ProfitLens', shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW', return_url: `${appOrigin}/business-v2?billing=return`, cancel_url: `${appOrigin}/business-v2?billing=cancel` } },intentId);
    const parsed = z.object({ id: subscriptionId }).safeParse(result); if (!parsed.success) throw upstream();
    // A create response alone never authorizes binding; verify current server state.
    return this.getSubscription(parsed.data.id);
  }
  approvalUrl(snapshot: SubscriptionSnapshot) {
    const href = snapshot.links?.find(link => link.rel === 'approve')?.href;
    if (!href) return null;
    const url = new URL(href), host = this.settings.mode === 'sandbox' ? 'www.sandbox.paypal.com' : 'www.paypal.com';
    if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.hash || !['/webapps/billing/subscriptions','/webapps/billing/subscriptions/'].includes(url.pathname)) throw upstream();
    return url.href;
  }
  async verifyWebhook(headers: WebhookHeaders, event: PayPalEvent) {
    const h = z.object({ 'paypal-auth-algo': z.literal('SHA256withRSA'), 'paypal-cert-url': z.string().url().max(2048), 'paypal-transmission-id': z.string().min(1).max(128), 'paypal-transmission-sig': z.string().regex(/^[A-Za-z0-9+/=]+$/).max(4096), 'paypal-transmission-time': z.string().datetime({ offset: true }) }).safeParse(headers);
    if (!h.success) throw new ApiError(401,'INVALID_WEBHOOK_SIGNATURE','Invalid webhook signature');
    const cert = new URL(h.data['paypal-cert-url']);
    if (cert.protocol !== 'https:' || !['api.paypal.com','api.sandbox.paypal.com','api-m.paypal.com','api-m.sandbox.paypal.com'].includes(cert.hostname) || cert.port || cert.username || cert.password || cert.search || cert.hash || !cert.pathname.startsWith('/v1/notifications/certs/')) throw new ApiError(401,'INVALID_WEBHOOK_SIGNATURE','Invalid webhook signature');
    const result = z.object({ verification_status: z.enum(['SUCCESS','FAILURE']) }).safeParse(await this.request('/v1/notifications/verify-webhook-signature','POST',{
      auth_algo: h.data['paypal-auth-algo'], cert_url: h.data['paypal-cert-url'], transmission_id: h.data['paypal-transmission-id'], transmission_sig: h.data['paypal-transmission-sig'], transmission_time: h.data['paypal-transmission-time'], webhook_id: this.settings.webhookId, webhook_event: event }));
    if (!result.success) throw upstream();
    if (result.data.verification_status !== 'SUCCESS') throw new ApiError(401,'INVALID_WEBHOOK_SIGNATURE','Invalid webhook signature');
  }
}
