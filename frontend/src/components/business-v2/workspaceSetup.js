import { Building2, Package, PackageCheck, ShoppingCart } from 'lucide-react';
import { useResource } from './useBusinessApi';
function allowed(context,tabs,tab,permissions){return context.role==='OWNER'&&tabs?.includes(tab)&&permissions.every(key=>context.permissions[key]);}
export function useWorkspaceSetup(context,api,visibleTabs){
 const base=`/businesses/${context.business.id}`;
 const shop=allowed(context,visibleTabs,'locations',['locations.manage','locations.view']);
 const product=allowed(context,visibleTabs,'catalogue',['catalogue.create','catalogue.cost','catalogue.view']);
 const sale=allowed(context,visibleTabs,'sales',['sales.create','sales.view']);
 const receive=allowed(context,visibleTabs,'purchases',['receiving.create','purchasing.view']);
 const locations=useResource(api,shop?`${base}/locations?kind=SHOP&state=active`:null);
 const products=useResource(api,product?`${base}/products?state=active`:null);
 const receipts=useResource(api,receive?`${base}/operations/purchases?kind=RECEIPT&status=COMPLETED`:null);
 const sales=useResource(api,sale?`${base}/sales?status=COMPLETED`:null);
 return [
  {id:'shop',tab:'locations',action:'setup',Icon:Building2,allowed:shop,resource:locations},
  {id:'products',tab:'catalogue',action:'setup',Icon:Package,allowed:product,resource:products},
  {id:'stock',tab:'purchases',action:'new',Icon:PackageCheck,allowed:receive,resource:receipts},
  {id:'sale',tab:'sales',action:'setup',Icon:ShoppingCart,allowed:sale,resource:sales},
 ].filter(step=>step.allowed).map((step,index)=>({...step,number:index+1,complete:step.resource.data?step.resource.data.total>0:null,error:step.resource.error,retry:step.resource.reload}));
}
