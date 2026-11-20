import { ArrowRight, CheckCircle2, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import SupportInbox, { TicketForm } from '../support-v2/Support';
import { panelClass, primaryClass } from './UI';
import { useWorkspaceSetup } from './workspaceSetup';

const copy = {
  en: {
    title: 'Get started with ProfitLens',
    intro: 'Follow these five steps to set up your business and get ready to track stock.',
    done: 'Complete',
    step: 'Step',
    example: 'Example',
    steps: [
      ['Set up your account', 'Choose how ProfitLens works for your business.', 'Open Settings', [
        'Choose your country, then select the currency you use for your business records.',
        'Save your business settings. Scroll to the tab preferences, use the arrows to reorder tabs, and keep the ones you need visible. Save the tab preferences.',
      ], 'For a shop in Syria, choose Syria and select SYP if you keep your records in Syrian pounds.'],
      ['Add your first shop or warehouse', 'Tell ProfitLens where you sell or store stock.', 'Go to Locations', [
        'Open Locations and choose Add location.',
        'Choose Shop or Warehouse, enter a name and code, then save.',
      ], 'Name: Main shop · Code: SHOP-01'],
      ['Add your first supplier', 'Save who you buy from so you can find them when recording a purchase.', 'Go to Suppliers', [
        'Open Suppliers and choose Add supplier.',
        'Enter the supplier’s name and code. Add contact details if you have them, then save.',
      ], 'Name: Al Noor Dairy · Code: SUP-01'],
      ['Create product categories', 'Group similar products so they’re easy to find.', 'Go to Products', [
        'Open Products, then select Categories & units.',
        'Add a category with a clear name and code, then save.',
      ], 'Name: Dairy · Code: DAIRY'],
      ['Add your first product', 'Create a product you can use in purchases and sales.', 'Go to Products', [
        'In Products, choose Add product and enter the product name and SKU.',
        'Choose the category and unit, fill in the required prices, then save.',
      ], 'Product: Whole milk 1 L · SKU: MILK-1L · Category: Dairy'],
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
    intro: 'اتبع هذه الخطوات الخمس لتجهيز نشاطك والبدء بمتابعة المخزون.',
    done: 'مكتملة',
    step: 'الخطوة',
    example: 'مثال',
    steps: [
      ['اضبط إعدادات حسابك', 'جهّز ProfitLens ليتناسب مع طريقة عملك.', 'افتح الإعدادات', [
        'اختر دولة نشاطك، ثم اختر العملة التي تستخدمها لتسجيل معاملاتك.',
        'احفظ إعدادات النشاط. انتقل إلى تفضيلات التبويبات، واستخدم الأسهم لترتيبها وأبقِ التبويبات التي تحتاجها ظاهرة، ثم احفظ الترتيب.',
      ], 'إذا كان متجرك في سوريا وتسجّل معاملاتك بالليرة السورية، اختر سوريا والعملة SYP.'],
      ['أضف أول متجر أو مستودع', 'حدّد أين تبيع بضائعك أو تخزّنها.', 'انتقل إلى المواقع', [
        'افتح تبويب المواقع واضغط «إضافة موقع».',
        'اختر متجرًا أو مستودعًا، ثم أدخل اسم الموقع ورمزه واحفظه.',
      ], 'الاسم: المتجر الرئيسي · الرمز: SHOP-01'],
      ['أضف أول مورد', 'احفظ بيانات المورد لتتمكن من اختياره عند تسجيل مشترياتك.', 'انتقل إلى الموردين', [
        'افتح تبويب الموردين واضغط «إضافة مورد».',
        'أدخل اسم المورد ورمزه. أضف بيانات التواصل إن توفّرت، ثم احفظه.',
      ], 'الاسم: ألبان النور · الرمز: SUP-01'],
      ['أنشئ فئات المنتجات', 'اجمع المنتجات المتشابهة ليسهل العثور عليها.', 'انتقل إلى المنتجات', [
        'افتح تبويب المنتجات، ثم اضغط «الفئات والوحدات».',
        'أضف فئة باسم واضح ورمز، ثم احفظها.',
      ], 'الاسم: الألبان · الرمز: DAIRY'],
      ['أضف منتجك الأول', 'أضف منتجًا لتتمكن من استخدامه في المشتريات والمبيعات.', 'انتقل إلى المنتجات', [
        'من تبويب المنتجات، اضغط «إضافة منتج» وأدخل اسم المنتج ورمزه (SKU).',
        'اختر الفئة والوحدة، وأدخل الأسعار المطلوبة، ثم احفظ المنتج.',
      ], 'المنتج: حليب كامل الدسم ١ لتر · الرمز: MILK-1L · الفئة: الألبان'],
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

function SetupStep({ complete, tab, number, text, Icon, labels, lang, onSection, expanded, onToggle }) {
  const [title, description, action, instructions, example] = text;
  const id = `guidance-step-${number}`;
  const stepNumber = new Intl.NumberFormat(lang).format(number);
  return <li className={`rounded-xl border bg-white ${expanded ? 'border-emerald-200' : 'border-slate-200'}`}>
    <button type="button" id={`${id}-title`} aria-expanded={expanded} aria-controls={id} onClick={onToggle}
      className="flex w-full items-start gap-3 rounded-xl p-4 text-start hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-emerald-700">{labels.step} {stepNumber}</span>
        <span className="mt-1 block font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-slate-600">{description}</span>
      </span>
      <ChevronDown className={`mt-2 h-5 w-5 shrink-0 text-slate-500 ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
    <div id={id} role="region" aria-labelledby={`${id}-title`} hidden={!expanded} className="space-y-4 border-t border-emerald-100 px-4 py-5 sm:px-5">
      <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed text-slate-700">
        {instructions.map(instruction => <li key={instruction}>{instruction}</li>)}
      </ol>
      <p className="rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
        <strong className="me-2 text-slate-900">{labels.example}</strong>{example}
      </p>
      <button type="button" className={primaryClass} onClick={() => onSection(tab)}>
        {action}<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </button>
    </div>
    {complete && <p className="flex items-center gap-1 px-4 pb-4 text-sm font-medium text-emerald-700 sm:px-5">
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{labels.done}
    </p>}
  </li>;
}

export default function GettingStarted({ context, api, lang, onSection, visibleTabs }) {
  const [version, setVersion] = useState(0);
  const [sent, setSent] = useState(false);
  const [openStep, setOpenStep] = useState(undefined);
  const labels = copy[lang === 'ar' ? 'ar' : 'en'];
  const steps = useWorkspaceSetup(context, api, visibleTabs);
  const nextStep = steps.find(step => step.complete !== true) ?? steps[0];
  const expandedStep = openStep === undefined ? nextStep?.number : openStep;

  return <div className="space-y-6"><section className={`${panelClass} space-y-4`} aria-labelledby="getting-started-title">
    <div>
      <h3 id="getting-started-title" className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{labels.title}</h3>
      {steps.length > 0 && <p className="mt-1 text-sm text-slate-600">{labels.intro}</p>}
    </div>
    {steps.length > 0 && <ol className="space-y-3">
      {steps.map(step => <SetupStep key={step.number} text={labels.steps[step.number - 1]} {...step} {...{ labels, lang, onSection }}
        expanded={expandedStep === step.number} onToggle={() => setOpenStep(expandedStep === step.number ? null : step.number)} />)}
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
  </section>
    <section className="space-y-3" aria-labelledby="guidance-support">
      <h3 id="guidance-support" className="text-lg font-semibold">{labels.support}</h3>
      <p className="text-sm text-slate-600">{labels.reply}</p>
      {sent && <p role="status" className="text-sm font-medium text-emerald-700">
        {lang === 'ar' ? 'تم إرسال سؤالك.' : 'Your question was sent.'}
      </p>}
      <TicketForm key={`form-${version}`} {...{api, lang}} session fixedBusinessId={context.business.id}
        onCreated={() => { setSent(true); setVersion(value => value + 1); }} />
      <SupportInbox key={`inbox-${version}`} {...{api, lang}} businessId={context.business.id} />
    </section>
  </div>;
}
