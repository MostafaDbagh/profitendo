import { Building2, CheckCircle2, MessageCircle, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass, panelClass } from './UI';
import { useResource } from './useBusinessApi';

const copy = {
  en: {
    title: 'Get started with ProfitLens',
    intro: 'Set up your first location and product so you can start tracking stock.',
    done: 'Complete',
    steps: [
      ['Add your first shop or warehouse', 'Create a location for the place where you sell or store stock. Choose Shop or Warehouse and give it a name you’ll recognize.', 'Go to Locations'],
      ['Add your first product', 'Enter the product name and code in Products. Once your location is ready, you can receive stock there.', 'Go to Products'],
    ],
    faq: 'Frequently asked questions',
    questions: [
      ['Can I add products first?', 'Yes. You can build your product list first. Add a shop or warehouse before receiving stock there.'],
      ['When does my stock quantity change?', 'Creating a product adds it to your catalogue. Record a purchase receipt in Purchases to add stock to a location.'],
      ['Where can I check my free trial?', 'Open the Billing tab to see your trial status, end date, and plan limits.'],
    ],
    support: 'Ask the ProfitLens team',
    reply: 'Send a question to the platform admin and check the same page for replies.',
  },
  ar: {
    title: 'ابدأ مع ProfitLens',
    intro: 'أضف موقعك ومنتجك الأول لتتمكن من متابعة المخزون.',
    done: 'مكتملة',
    steps: [
      ['أضف أول متجر أو مستودع', 'أنشئ موقعًا للمكان الذي تبيع فيه أو تخزّن البضائع فيه. اختر متجرًا أو مستودعًا وأدخل اسمًا يسهل عليك تمييزه.', 'انتقل إلى المواقع'],
      ['أضف منتجك الأول', 'أدخل اسم المنتج ورمزه في تبويب المنتجات. بعد تجهيز الموقع يمكنك استلام المخزون فيه.', 'انتقل إلى المنتجات'],
    ],
    faq: 'أسئلة شائعة',
    questions: [
      ['هل يمكنني إضافة المنتجات أولًا؟', 'نعم، يمكنك إعداد قائمة المنتجات أولًا. أضف متجرًا أو مستودعًا قبل استلام المخزون فيه.'],
      ['متى تتغيّر كمية المخزون؟', 'إضافة منتج تدرجه في قائمة المنتجات. سجّل استلام مشتريات في تبويب المشتريات لإضافة الكمية إلى مخزون الموقع.'],
      ['أين أجد تفاصيل التجربة المجانية؟', 'افتح تبويب الاشتراك للاطلاع على حالة التجربة وتاريخ انتهائها وحدود الخطة.'],
    ],
    support: 'اسأل فريق ProfitLens',
    reply: 'أرسل سؤالك إلى إدارة المنصة وتابع الردود في الصفحة نفسها.',
  },
};

function SetupStep({ api, path, tab, text, Icon, labels, onSection }) {
  const { data } = useResource(api, path);
  const complete = data?.total > 0;
  const [title, description, action] = text;
  return <li className="rounded-lg border border-slate-200 p-4">
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
      <div className="space-y-2">
        <h4 className="font-semibold text-slate-900">{title}</h4>
        <p className="text-sm leading-relaxed text-slate-600">{description}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass} onClick={() => onSection(tab)}>{action}</button>
          {complete && <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{labels.done}
          </span>}
        </div>
      </div>
    </div>
  </li>;
}

export default function GettingStarted({ context, api, lang, onSection, visibleTabs }) {
  if (context.role !== 'OWNER') return null;
  const labels = copy[lang === 'ar' ? 'ar' : 'en'];
  const base = `/businesses/${context.business.id}`;
  const steps = [
    { tab: 'locations', permissions: ['locations.manage'], path: `${base}/locations`, Icon: Building2 },
    { tab: 'catalogue', permissions: ['catalogue.create', 'catalogue.cost'], path: `${base}/products`, Icon: Package },
  ].map((step, index) => ({ ...step, text: labels.steps[index] }))
    .filter(({ tab, permissions }) => visibleTabs?.includes(tab) && permissions.every(permission => context.permissions[permission]));

  return <section className={`${panelClass} space-y-4`} aria-labelledby="getting-started-title">
    <div>
      <h3 id="getting-started-title" className="font-semibold text-slate-900">{labels.title}</h3>
      <p className="mt-1 text-sm text-slate-600">{labels.intro}</p>
    </div>
    {steps.length > 0 && <ol className="grid gap-3 md:grid-cols-2">
      {steps.map(({ permissions, ...step }) => <SetupStep key={step.tab} {...step} {...{ api, labels, onSection }} />)}
    </ol>}
    <details className="rounded-lg border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">{labels.faq}</summary>
      <dl className="mt-3 space-y-3 text-sm">
        {labels.questions.map(([question, answer]) => <div key={question}>
          <dt className="font-medium text-slate-900">{question}</dt>
          <dd className="mt-1 leading-relaxed text-slate-600">{answer}</dd>
        </div>)}
      </dl>
    </details>
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/contact" className={buttonClass}>
        <MessageCircle className="me-2 inline h-4 w-4" aria-hidden="true" />{labels.support}
      </Link>
      <p className="text-sm text-slate-600">{labels.reply}</p>
    </div>
  </section>;
}
