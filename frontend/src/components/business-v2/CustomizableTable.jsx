import {useRef, useState} from 'react';
import {Field} from '../auth-v2/Fields';
import {Table, Modal, Feedback, buttonClass, primaryClass} from './UI';

export default function CustomizableTable({tableName, actionKey, context, api, reload, lang, c, headers, ...props}) {
  const {business,permissions}=context;
  const labels=business.actionLabels?.[lang]??{};
  const columnKey=header=>tableName+'_'+header;
  const [draft,setDraft]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const trigger=useRef(null);
  const title=lang==='ar'?'تعديل التسميات':'Edit labels';
  const fields=[{key:actionKey,label:c(actionKey)},...headers.map(header=>({key:columnKey(header),label:c(header)}))];
  async function save(event){
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    setError('');
    try{
      await api(`/businesses/${business.id}`,{method:'PATCH',body:{
        revision:business.revision,actionLabels:{...business.actionLabels,[lang]:{...labels,...draft}},
      }});
      setDraft(null);
      reload();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <>
    {permissions['business.edit']&&<button type="button" ref={trigger} className={buttonClass} onClick={()=>{setDraft({});setError('');}}>{title}</button>}
    <Table {...props} headers={headers} c={(key,...args)=>labels[columnKey(key)]||c(key,...args)}/>
    {draft&&<Modal {...{title,busy,c,lang}} close={()=>setDraft(null)} returnFocus={trigger.current}
      description={lang==='ar'?'غيّر اسم الزر وعناوين الأعمدة لهذا النشاط. امسح النص لاستعادة الاسم الأصلي.':'Rename the button and columns for this business. Clear a field to restore its default.'}>
      <form onSubmit={save} className="space-y-4">
        <Feedback {...{error,c}}/>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          {fields.map(({key,label})=><Field key={key} id={'label-'+key} label={label} placeholder={label} maxLength={48}
            value={draft[key]??labels[key]??''} onChange={event=>{const value=event.target.value;setDraft(current=>({...current,[key]:value}));}}/>)}
        </fieldset>
        <button className={primaryClass} disabled={busy}>{c(busy?'saving':'save')}</button>
      </form>
    </Modal>}
  </>;
}
