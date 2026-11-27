export default function WorkspaceLoader({label}) {
  return (
    <div role="status" className="fixed inset-0 z-50 grid place-items-center bg-slate-50">
      <div className="flex flex-col items-center text-center">
        <img src="/icons/icon-192.png" alt="" width="56" height="56" className="rounded-2xl shadow-sm" />
        <span dir="ltr" className="mt-3 text-xl font-bold tracking-tight text-slate-900">ProfitLens</span>
        <span className="mt-1 text-sm text-slate-600">{label}</span>
        <span dir="ltr" aria-hidden="true" className="mt-4 h-1 w-20 overflow-hidden rounded-full bg-emerald-100">
          <span className="workspace-loading-bar block h-full w-1/2 rounded-full bg-[#047756]" />
        </span>
      </div>
    </div>
  );
}
