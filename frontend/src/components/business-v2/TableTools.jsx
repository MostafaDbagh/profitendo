import {Children,Fragment,isValidElement,useId,useState} from 'react';
import {useLanguage} from '../../context/LanguageContext';
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join(' ');if(isValidElement(node)){if(['button','input','select','textarea','svg'].includes(node.type))return '';return text(node.props.children);}return '';}
function flatten(nodes){return Children.toArray(nodes).flatMap(node=>isValidElement(node)&&node.type===Fragment?flatten(node.props.children):[node]);}
function csv(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export default function TableTools({headers,children,c,render}){
 const {lang}=useLanguage(),ar=lang==='ar',id=useId(),[search,setSearch]=useState(''),[column,setColumn]=useState('all'),[value,setValue]=useState('');
 const rows=Children.toArray(children),cells=rows.map(row=>flatten(row.props?.children).map(cell=>text(cell).trim()));
 const indexes=headers.map((h,i)=>i).filter(i=>!['actions','action'].includes(headers[i]));
 const values=column==='all'?[]:[...new Set(cells.map(row=>row[Number(column)]||'').filter(Boolean))].sort();
 const matching=rows.filter((_,i)=>{const row=cells[i];return indexes.map(index=>row[index]||'').join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())&&(column==='all'||!value||row[Number(column)]===value);});
 function download(){const lines=[indexes.map(i=>csv(c(headers[i]))).join(','),...matching.map(row=>{const parts=flatten(row.props?.children).map(text);return indexes.map(i=>csv(parts[i])).join(',');})];const url=URL.createObjectURL(new Blob(['\uFEFF',lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='visible-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const input='block w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus-visible:ring-2 focus-visible:ring-emerald-500';
 return <div className="space-y-3"><div className="flex flex-wrap gap-3 items-end rounded-xl border border-slate-200 bg-white p-4">
 <label htmlFor={id+'search'} className="text-sm flex-1 min-w-0">{ar?'بحث في الصفحة الحالية':'Search current page'}<input id={id+'search'} className={input} placeholder={ar?'اكتب كلمة للبحث…':'Type a keyword…'} value={search} onChange={e=>setSearch(e.target.value)}/></label>
 <label htmlFor={id+'column'} className="text-sm">{ar?'تصفية حسب':'Filter by'}<select aria-label={ar?'تصفية حسب':'Filter by'} id={id+'column'} className={input} value={column} onChange={e=>{setColumn(e.target.value);setValue('');}}><option value="all">{ar?'كل الأعمدة':'All columns'}</option>{indexes.map(i=><option key={i} value={i}>{c(headers[i])}</option>)}</select></label>
 {column!=='all'&&<label htmlFor={id+'value'} className="text-sm max-w-full">{ar?'القيمة':'Value'}<select aria-label={ar?'القيمة':'Value'} id={id+'value'} className={input} value={value} onChange={e=>setValue(e.target.value)}><option value="">{ar?'الكل':'All'}</option>{values.map(v=><option key={v}>{v}</option>)}</select></label>}
 <button type="button" disabled={!matching.length} onClick={download} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-emerald-500">{ar?'تصدير نتائج هذه الصفحة CSV':'Export this page’s results CSV'}</button>
 </div><p className="text-xs text-slate-500">{ar?'هذه الأدوات تخص الصفوف المحمّلة في الصفحة الحالية. استخدم فلاتر التبويب للبحث في جميع السجلات.':'These tools apply to rows loaded on the current page. Use the tab filters to search all records.'}</p>{render(matching,!matching.length)}</div>;
}
