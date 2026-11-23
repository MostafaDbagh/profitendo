import {Component} from 'react';
import {feedbackCopy} from './feedbackCopy';
export default class WorkspaceErrorBoundary extends Component{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){
  if(!this.state.failed)return this.props.children;
  const t=feedbackCopy[this.props.lang]||feedbackCopy.en;
  return <div role="alert" dir={this.props.lang==='ar'?'rtl':'ltr'} className="m-4 rounded-xl border border-red-200 bg-white p-5 space-y-4"><h2 className="font-semibold text-lg">{t.crashTitle}</h2><p className="text-sm text-slate-600">{t.crashHint}</p><div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-lg bg-emerald-600 px-4 text-white font-semibold focus-visible:ring-2 focus-visible:ring-emerald-500" onClick={()=>this.setState({failed:false})}>{t.reopen}</button><a href="/contact" className="min-h-11 inline-flex items-center rounded-lg border border-slate-200 px-4 focus-visible:ring-2 focus-visible:ring-emerald-500">{t.support}</a></div></div>;
 }
}
