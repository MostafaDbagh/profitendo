import { Link,useParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useBusinessApi,useResource } from '../components/business-v2/useBusinessApi';
import { businessCopy } from '../components/business-v2/copy';
import { Feedback,buttonClass } from '../components/business-v2/UI';
import Receipt from '../components/sales-v2/Receipt';
import { Seo } from '../components/Seo';
export default function SaleReceiptV2(){
 const {businessId,id}=useParams(),{lang,setLang}=useLanguage(),api=useBusinessApi(),{data,error,reload}=useResource(api,`/businesses/${businessId}/sales/${id}`),c=key=>businessCopy[lang]?.[key]||businessCopy.en[key]||businessCopy[lang].failed;
 return <div className="min-h-screen bg-slate-50 p-4 sm:p-8 print:bg-white print:p-0" dir={lang==='ar'?'rtl':'ltr'}><Seo title={`${c('saleReceipt')} | ProfitLens`} noindex path={`/sales-v2/${businessId}/${id}/receipt`}/><div className="max-w-xl mx-auto"><div className="flex flex-wrap gap-2 mb-5 print:hidden"><Link className={buttonClass} to="/business-v2">{c('saleBack')}</Link><button className={buttonClass} onClick={()=>setLang(lang==='ar'?'en':'ar',false)}>{c('language')}</button>{data?.status==='COMPLETED'&&<button className={buttonClass} onClick={()=>window.print()}>{c('printReceipt')}</button>}</div><Feedback {...{c,error}} retry={reload}/>{!data&&!error&&<p role="status">{c('loading')}</p>}{data&&<div className="bg-white p-5 sm:p-8 rounded-xl border border-slate-200 print:border-0 print:p-0"><Receipt doc={data} {...{c,lang}}/></div>}</div></div>;
}
