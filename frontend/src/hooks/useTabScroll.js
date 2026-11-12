import {useLayoutEffect,useReducer,useRef} from 'react';

// Run after navigation commits, including when the selected tab is clicked again.
export function useTabScroll(section) {
  const contentRef=useRef(null);
  const [selection,requestScroll]=useReducer(value=>value+1,0);
  useLayoutEffect(()=>{
    const content=contentRef.current;
    if(!content)return;
    content.focus({preventScroll:true});
    const reset=()=>{
      for(let node=content;node;node=node.parentElement){
        if(node.scrollTop)node.scrollTo({top:0,behavior:'instant'});
      }
      window.scrollTo({top:0,left:0,behavior:'instant'});
    };
    reset();
    const frame=requestAnimationFrame(reset);
    return ()=>cancelAnimationFrame(frame);
  },[section,selection]);
  return {contentRef,requestScroll};
}
