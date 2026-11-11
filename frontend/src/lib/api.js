import axios from "axios";

const api = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
  timeout: 30000,
});

let pinToken = null;

export function setPinToken(token) {
  pinToken = token;
}

api.interceptors.request.use((config) => {
  if (pinToken) config.headers["X-Pin-Token"] = pinToken;
  return config;
});

export function isPinRequired(err) {
  return err?.response?.status === 403 && err?.response?.data?.detail === "PIN_REQUIRED";
}

export function formatApiError(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (detail == null) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;
