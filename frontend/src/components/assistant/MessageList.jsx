import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const mdComponents = {
  table: (p) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border border-slate-200 rounded-lg" {...p} />
    </div>
  ),
  th: (p) => <th className="px-2.5 py-1.5 bg-slate-100 border border-slate-200 font-semibold text-slate-700 text-start" {...p} />,
  td: (p) => <td className="px-2.5 py-1.5 border border-slate-200 tabular" {...p} />,
};

function MessageBubble({ m, index, t }) {
  return (
    <div className="flex justify-start">
      <div
        data-testid={`ai-msg-${m.role}-${index}`}
        className={
          m.role === "user"
            ? "max-w-[85%] rounded-2xl rounded-ts-sm px-4 py-2.5 text-sm bg-emerald-500 text-white whitespace-pre-wrap"
            : `max-w-[92%] rounded-2xl rounded-ts-sm px-4 py-3 text-sm border ${m.error ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-50 border-slate-100 text-slate-800"}`
        }
      >
        {m.role === "user" ? (
          m.content
        ) : m.content ? (
          <div className="prose-sm leading-relaxed [&_strong]:text-slate-900 [&_ul]:ps-4 [&_ol]:ps-4 [&_li]:my-0.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{m.content}</ReactMarkdown>
          </div>
        ) : (
          <span className="inline-flex items-center gap-2 text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("aiThinking")}
          </span>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages, t, scrollRef }) {
  return (
    <div ref={scrollRef} className="max-h-96 min-h-40 overflow-y-auto px-5 py-4 space-y-3" data-testid="ai-messages">
      {messages.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-6">{t("aiEmpty")}</p>
      )}
      {messages.map((m, i) => (
        <MessageBubble key={m.id} m={m} index={i} t={t} />
      ))}
    </div>
  );
}
