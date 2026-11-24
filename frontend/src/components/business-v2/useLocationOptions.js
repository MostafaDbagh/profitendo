import {useEffect,useState} from 'react';

const pending={items:[],error:'',loading:true};

export default function useLocationOptions(api,path){
 const [state,setState]=useState(null);
 const [version,setVersion]=useState(0);
 useEffect(()=>{
  if(!path)return;
  const controller=new AbortController();
  setState(null);
  (async()=>{
   try{
    const items=[];
    let pageSize=25;
    for(let page=1;;page++){
     const data=await api(`${path}&page=${page}`,{signal:controller.signal});
     if(controller.signal.aborted)return;
     const batch=data.items??[];
     pageSize=data.pageSize??pageSize;
     items.push(...batch);
     if(!batch.length||items.length>=(data.total??items.length))break;
    }
    setState({path,items,pageSize,error:'',loading:false});
   }catch(error){
    if(!controller.signal.aborted)setState({path,items:[],error:error.message,loading:false});
   }
  })();
  return ()=>controller.abort();
 },[api,path,version]);
 return {...(state&&state.path===path?state:pending),reload:()=>setVersion(v=>v+1)};
}
