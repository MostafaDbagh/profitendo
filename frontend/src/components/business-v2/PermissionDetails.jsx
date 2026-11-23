import Disclosure from './Disclosure';

export const permissionGroupLabels={business:'settings',team:'team',roles:'roles',audit:'audit',locations:'locations',catalogue:'catalogue',suppliers:'suppliers',purchasing:'newOrder',receiving:'newReceipt',sales:'sales',transfers:'transfers',inventory:'inventory',returns:'returns',counts:'counts',damage:'damage',payments:'payments',cash:'payments',reports:'reports'};
export const customizeLabel=lang=>lang==='ar'?'تخصيص الصلاحيات':'Customize permissions';

export default function PermissionDetails({permissions={},keys=Object.keys(permissions),c,lang}){
 const groups=[...new Set(keys.map(key=>key.split('.')[0]))];
 const allowed=keys.filter(key=>permissions[key]).length;
 return <Disclosure title={lang==='ar'?`عرض الصلاحيات (${allowed})`:`View permissions (${allowed})`}>
  <div className="space-y-3">{groups.map(group=><div key={group}>
   <h3 className="text-sm font-semibold text-slate-700">{c(permissionGroupLabels[group]||group)}</h3>
   <ul className="mt-1 divide-y divide-slate-100">{keys.filter(key=>key.startsWith(group+'.')).map(key=><li key={key} className="flex items-start justify-between gap-3 py-2 text-sm">
    <span>{c(key)}</span><span className={`shrink-0 ${permissions[key]?'text-emerald-700':'text-slate-500'}`}>{c(permissions[key]?'allow':'deny')}</span>
   </li>)}</ul>
  </div>)}</div>
 </Disclosure>;
}
