import { Send } from "lucide-react";

const QUICK_ACTIONS = ["qaDaily", "qaSales", "qaProfit", "qaExpenses", "qaInventory", "qaFull"];

export function ChatComposer({ input, setInput, busy, onSend, t }) {
  return (
    <>
      <div className="px-5 pb-2 flex flex-wrap gap-2" data-testid="ai-quick-actions">
        {QUICK_ACTIONS.map((k) => (
          <button
            key={k}
            data-testid={`ai-${k}`}
            onClick={() => onSend(t(k + "Prompt"))}
            disabled={busy}
            className="px-3 py-1.5 rounded-full border border-emerald-200 bg-emerald-50/60 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-50"
          >
            {t(k)}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          data-testid="ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("aiPlaceholder")}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
        />
        <button
          data-testid="ai-send-btn"
          type="submit"
          disabled={busy || !input.trim()}
          className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4 rtl:-scale-x-100" />
        </button>
      </form>
    </>
  );
}
