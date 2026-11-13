import {createContext, useContext} from 'react';
import {translations} from '../../src/i18n';
const Context=createContext(null);
export function StaticLanguage({lang,children}) {
 const t=(key,vars)=>Object.entries(vars||{}).reduce((text,[name,value])=>text.replace(`{${name}}`,value),translations[lang]?.[key]??translations.en[key]??key);
 return <Context.Provider value={{lang,dir:lang==='ar'?'rtl':'ltr',t,setLang:()=>{}}}>{children}</Context.Provider>;
}
export const useLanguage=()=>useContext(Context);
