// Per-client state: never shared between accounts or browser tabs.
export function createRequestFeedback(){
 let snapshot={pending:[],success:null},listeners=new Set();
 const emit=()=>listeners.forEach(fn=>fn());
 return {subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>snapshot,
  slow(id,write){snapshot={...snapshot,pending:[...snapshot.pending,{id,write}]};emit();},
  finish(id){snapshot={...snapshot,pending:snapshot.pending.filter(r=>r.id!==id)};emit();},
  saved(success){snapshot={...snapshot,success};emit();},
  dismiss(){snapshot={...snapshot,success:null};emit();}};
}
export function successFor(path,body,data){
 const scope=path.match(/^\/businesses\/([^/]+)/)?.[1];
 if(!scope)return null;
 const base={scope,reference:data?.reference||''};
 if(/\/sales\/[^/]+\/checkout$/.test(path)&&data?.status==='COMPLETED')return {...base,key:'saleSaved'};
 if(/\/workflows\/payments$/.test(path)&&data?.id)return {...base,key:body?.kind==='CUSTOMER_REFUND'?'refundSaved':body?.kind==='EXPENSE'?'expenseSaved':'paymentSaved'};
 if(/\/workflows\/adjustments\/[^/]+\/status$/.test(path)&&data?.kind==='CUSTOMER_RETURN')return {...base,key:data.status==='COMPLETED'?'returnSaved':data.status==='CANCELLED'?'returnCancelled':null};
 if(/\/workflows\/adjustments$/.test(path)&&data?.status==='DRAFT')return {...base,key:'draftSaved'};
 if(/\/operations\/purchases\/[^/]+\/status$/.test(path)&&data?.kind==='RECEIPT'&&data?.status==='COMPLETED')return {...base,key:'stockSaved'};
 return null;
}
