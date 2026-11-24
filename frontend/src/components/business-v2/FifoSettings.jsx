import {LoadingState} from '../page-layout/PageResults';
import RequiredMark from '../RequiredMark';
import { formatQuantity } from '@/lib/quantity';
import CopyableCode from '@/components/CopyableCode';
import { useLocalDraft, LocalDraftNotice } from '../../lib/localDraft';
import {useState} from 'react';
import {useResource} from './useBusinessApi';
import {Field} from '../auth-v2/Fields';
import {Feedback,Modal,buttonClass,panelClass,primaryClass} from './UI';
const copy={
  "en": {
    "title": "How we calculate your profit",
    "review": "Check quantities and purchase costs",
    "hint": "When you sell an item, we subtract its purchase cost from its selling price. We use the cost of the items you received first.",
    "example": "Example: you bought a bottle for 5 and sold it for 9. Your profit is 4 before other expenses. If your next bottles cost 7, we start using 7 after the older bottles run out.",
    "openingHint": "Check how many items you have and what you paid for each one. The costs shown come from your product list; check them against your purchase bills. If a quantity is wrong, correct it in Stock count first.",
    "effect": "Starts from now. Earlier sales and your selling prices stay the same.",
    "active": "This method is on.",
    "confirm": "I checked the quantities and purchase costs. Use them from now on.",
    "activate": "Start using this method",
    "location": "Location",
    "product": "Product",
    "quantity": "Current quantity",
    "cost": "Purchase cost per item",
    "blocked": "Complete all stock transfers that are still on the way before enabling this calculation.",
    "empty": "There is no stock to review. Costs will be recorded when you receive stock.",
    "FIFO_REVIEW_REQUIRED": "Check every stock quantity and cost before continuing.",
    "FIFO_TRANSFERS_OPEN": "Complete stock transfers that are still on the way, then refresh this review.",
    "FIFO_REVIEW_TOO_LARGE": "There are too many product and location entries to set up at once. Contact support to complete setup in stages.",
    "success": "This method is now on. Earlier sales stay the same."
  },
  "ar": {
    "title": "كيف نحسب ربحك",
    "review": "مراجعة الكميات وتكلفة الشراء",
    "hint": "عندما تبيع قطعة، نطرح تكلفة شرائها من سعر بيعها لحساب ربحك. نبدأ بتكلفة البضاعة التي استلمتها أولاً.",
    "example": "مثال: اشتريت عبوة بـ 5 وبعتها بـ 9. ربحك 4 قبل المصروفات الأخرى. إذا اشتريت عبوات جديدة بـ 7، نبدأ بحساب تكلفتها بـ 7 بعد نفاد العبوات القديمة.",
    "openingHint": "راجع عدد القطع الموجودة وتكلفة شراء القطعة. التكاليف المعروضة مأخوذة من قائمة منتجاتك؛ تأكد منها باستخدام فواتير الشراء. إذا كان عدد القطع خاطئاً، صححه من شاشة الجرد أولاً.",
    "effect": "يبدأ العمل بها من الآن. لا تتغير المبيعات السابقة أو أسعار البيع.",
    "active": "هذه الطريقة مفعّلة.",
    "confirm": "راجعت الكميات وتكلفة الشراء وأوافق على استخدامها من الآن.",
    "activate": "بدء استخدام هذه الطريقة",
    "location": "الموقع",
    "product": "المنتج",
    "quantity": "الكمية الحالية",
    "cost": "تكلفة شراء القطعة",
    "blocked": "أكمل جميع تحويلات المخزون التي لا تزال في الطريق قبل التفعيل.",
    "empty": "لا يوجد مخزون لمراجعته. ستُسجل التكاليف عند استلام البضاعة.",
    "FIFO_REVIEW_REQUIRED": "راجع جميع كميات المخزون وتكاليفه قبل المتابعة.",
    "FIFO_TRANSFERS_OPEN": "أكمل تحويلات المخزون التي لا تزال في الطريق، ثم حدّث المراجعة.",
    "FIFO_REVIEW_TOO_LARGE": "عدد المنتجات والمواقع كبير لإعدادها دفعة واحدة. تواصل مع الدعم لإكمال الإعداد على مراحل.",
    "success": "تم بدء استخدام هذه الطريقة. بقيت المعاملات السابقة كما هي."
  }
};
function OpeningReview({context,api,c,lang,close,done,returnFocus}){
 const {data,error,reload}=useResource(api,`/businesses/${context.business.id}/operations/fifo-review`),[costs,setCosts]=useState({}),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 const draft=useLocalDraft('fifo-opening-costs',{costs},saved=>{setCosts(saved.costs);setConfirmed(false);});
 async function submit(e){e.preventDefault();if(busy||!data||!confirmed)return;setBusy(true);setFailure('');try{await api(`/businesses/${context.business.id}/operations/fifo-activate`,{method:'POST',body:{snapshot:data.snapshot,confirmed:true,lines:data.lines.map(l=>({balanceId:l.balanceId,unitCost:costs[l.balanceId]??l.suggestedCost}))}});draft.clear();done();}catch(e){setFailure(e.message);setConfirmed(false);}finally{setBusy(false);}}
 const refresh=()=>{setConfirmed(false);setCosts({});setFailure('');reload();};
 return <Modal title={c('review')} description={c('openingHint')} {...{c,lang,close,busy,returnFocus}}><LocalDraftNotice {...{draft,lang,busy}}/><Feedback c={c} error={error||failure} retry={refresh}/>{!data&&!error&&<LoadingState>{c('loading')}</LoadingState>}{data&&(data.activeSince?<p>{c('active')}</p>:<form onSubmit={submit} className="space-y-4">{data.inTransit>0&&<p role="alert" className="text-amber-800">{c('blocked')}</p>}<p><bdi>{data.currency}</bdi></p>{!data.lines.length?<p>{c('empty')}</p>:<ul className="space-y-4 max-h-80 overflow-y-auto">{data.lines.map(l=><li key={l.balanceId} className="rounded-lg border border-slate-200 p-3 space-y-2"><p className="font-semibold">{l.name} <CopyableCode className="text-xs text-slate-500">{l.sku}</CopyableCode></p><p className="text-sm">{c('location')}: {l.location} · {c('quantity')}: <bdi>{formatQuantity(l.quantity)}</bdi></p><Field id={`fifo-cost-${l.balanceId}`} label={`${c('cost')} (${data.currency})`} value={costs[l.balanceId]??l.suggestedCost} required inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?" disabled={busy} onChange={e=>{setCosts(v=>({...v,[l.balanceId]:e.target.value}));setConfirmed(false);}}/></li>)}</ul>}<label className="flex gap-2 items-start text-sm"><input type="checkbox" className="mt-1 accent-emerald-600" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy||data.inTransit>0} required/>{c('confirm')}<RequiredMark/></label><button type="submit" className={primaryClass} disabled={busy||!confirmed||data.inTransit>0}>{c(busy?'saving':'activate')}</button></form>)}</Modal>;
}
export default function FifoSettings({context,api,c:parentCopy,lang}){
 const [trigger,setTrigger]=useState(null),[activated,setActivated]=useState(false),c=key=>copy[lang]?.[key]||copy.en[key]||parentCopy(key);
 if(!context.permissions['migration.manage'])return null;
 const active=activated||context.business.fifoStartedAt;
 return <section className={`${panelClass} space-y-3 max-w-3xl`} data-testid="fifo-settings"><h2 className="text-lg font-bold">{c('title')}</h2><p className="text-sm text-slate-500">{c('hint')}</p><p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{c('example')}</p><p className="text-xs text-slate-500">{c('effect')}</p>{active?<p role="status" className="text-emerald-800">{c(activated?'success':'active')}</p>:<button className={buttonClass} onClick={e=>setTrigger(e.currentTarget)}>{c('review')}</button>}{trigger&&<OpeningReview {...{context,api,c,lang}} returnFocus={trigger} close={()=>setTrigger(null)} done={()=>{setActivated(true);setTrigger(null);}}/>}</section>;
}
