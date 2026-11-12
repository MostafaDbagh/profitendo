import {useCallback,useLayoutEffect,useReducer,useRef} from 'react';

function resetScroll(content,animate=true) {
  if(!content)return;
  const behavior=animate&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant';
  content.focus({preventScroll:true});
  for(let node=content;node;node=node.parentElement){
    if(node!==document.documentElement&&node!==document.body&&node.scrollTop)node.scrollTo({top:0,behavior});
  }
  window.scrollTo({top:0,left:0,behavior});
}

// Reset on navigation AND when async business loading mounts the content later.
export function useTabScroll(section) {
  const content=useRef(null);
  const [selection,select]=useReducer(value=>value+1,0);
  const contentRef=useCallback(node=>{
    content.current=node;
    if(node)resetScroll(node,false);
  },[]);
  const requestScroll=useCallback(()=>{
    select();
  },[]);
  useLayoutEffect(()=>{
    const node=content.current;
    if(!node)return;
    resetScroll(node);
    // Loading tables can change height after the navigation commit. Prevent
    // browser scroll anchoring from restoring the previous tab's position.
    const ancestors=[];
    for(let parent=node;parent;parent=parent.parentElement){
      ancestors.push([parent,parent.style.overflowAnchor]);
      parent.style.overflowAnchor='none';
    }
    let frame;
    const observer=new ResizeObserver(()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>resetScroll(node));
    });
    observer.observe(node);
    let stopped=false;
    const stop=()=>{
      if(stopped)return;
      stopped=true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      ancestors.forEach(([parent,value])=>{parent.style.overflowAnchor=value;});
      ['wheel','touchstart','pointerdown','keydown'].forEach(type=>window.removeEventListener(type,stop,true));
    };
    // Never fight deliberate scrolling or subsequent interaction.
    ['wheel','touchstart','pointerdown','keydown'].forEach(type=>window.addEventListener(type,stop,{capture:true,passive:true}));
    const timer=setTimeout(stop,1000);
    return ()=>{clearTimeout(timer);stop();};
  },[section,selection]);
  return {contentRef,requestScroll};
}
