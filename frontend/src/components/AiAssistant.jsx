import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { AssistantHeader, AssistantLocked } from "./assistant/AssistantHeader";
import { MessageList } from "./assistant/MessageList";
import { ChatComposer } from "./assistant/ChatComposer";

const API = process.env.REACT_APP_BACKEND_URL;

export const AiAssistant = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [sub, setSub] = useState(null);
  const [sessionId, setSessionId] = useState(() => {
    let sid = localStorage.getItem("pl_ai_sid");
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem("pl_ai_sid", sid);
    }
    return sid;
  });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/api/subscription/status`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSub(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (sub && !sub.assistant_access) return;
    fetch(`${API}/api/assistant/history?session_id=${sessionId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages((d.messages || []).map((m) => ({ ...m, id: crypto.randomUUID() }))))
      .catch(() => {});
  }, [sessionId, sub]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const newChat = () => {
    const sid = crypto.randomUUID();
    localStorage.setItem("pl_ai_sid", sid);
    setMessages([]);
    setSessionId(sid);
  };

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: msg }, { id: crypto.randomUUID(), role: "assistant", content: "" }]);
    try {
      const res = await fetch(`${API}/api/assistant/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, session_id: sessionId }),
      });
      if (res.status === 403) {
        setSub((s) => ({ ...(s || {}), assistant_access: false, status: "expired" }));
        setMessages((m) => m.slice(0, -2));
        setBusy(false);
        return;
      }
      if (!res.ok || !res.body) throw new Error("bad response");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let failed = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop();
        for (const c of chunks) {
          const line = c.trim();
          if (!line.startsWith("data: ")) continue;
          let payload;
          try {
            payload = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (payload.delta) {
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + payload.delta };
              return copy;
            });
          }
          if (payload.error) failed = true;
        }
      }
      if (failed) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: t("aiError"), error: true };
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], content: t("aiError"), error: true };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" data-testid="ai-assistant">
      <AssistantHeader sub={sub} t={t} onNewChat={newChat} />

      {sub && !sub.assistant_access ? (
        <AssistantLocked isOwner={user?.role === "OWNER"} t={t} />
      ) : (
      <>
      <MessageList messages={messages} t={t} scrollRef={scrollRef} />
      <ChatComposer input={input} setInput={setInput} busy={busy} onSend={send} t={t} />
      </>
      )}
    </div>
  );
};
