import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
export function useBusinessApi() {
  const csrf = useRef(''), navigate = useNavigate();
  return useCallback(async (path, { method = 'GET', body, signal } = {}) => {
    const timeout = AbortSignal.timeout(30000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await fetch(`${process.env.REACT_APP_AUTH_API_URL}/api${path}`, { method, credentials: 'include', signal: requestSignal,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.current }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(timeout.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    }
    const data = await response.json().catch(() => { throw new Error('INVALID_SERVER_RESPONSE'); });
    if (response.status === 401 || ['MFA_REQUIRED','PHONE_UNVERIFIED'].includes(data.error?.code)) navigate('/auth-v2', { replace: true });
    if (!response.ok) throw new Error(data.error?.code || 'failed');
    if (data.csrfToken) csrf.current = data.csrfToken;
    return data;
  }, [navigate]);
}
export function useResource(api, path) {
  const [state, setState] = useState({ path: null, data: null, error: '' }), [version, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path, data: null, error: '' });
    api(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setState({ path, data, error: '' }); }).catch(e => { if (!controller.signal.aborted) setState({ path, data: null, error: e.message }); });
    return () => controller.abort();
  }, [api, path, version]);
  return { ...(state.path === path ? state : { data: null, error: '' }), reload: () => refresh(v => v + 1) };
}
