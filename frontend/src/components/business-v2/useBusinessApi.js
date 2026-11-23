import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {createBusinessClient} from './requestClient';
export function useBusinessApi() {
 const navigate=useNavigate();
 return useMemo(()=>createBusinessClient({navigate}),[navigate]);
}
export function useResource(api, path) {
  const [state, setState] = useState({ path: null, data: null, error: '' }), [version, refresh] = useState(0);
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState({ path, data: null, error: '' });
    api(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setState({ path, data, error: '' }); }).catch(e => { if (!controller.signal.aborted) setState({ path, data: null, error: e.message }); });
    return () => controller.abort();
  }, [api, path, version]);
  return { ...(state.path === path ? state : { data: null, error: '' }), reload: () => refresh(v => v + 1) };
}
