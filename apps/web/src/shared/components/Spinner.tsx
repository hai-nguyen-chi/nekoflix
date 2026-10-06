export function Spinner({ label = 'Đang tải...' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <span
        aria-hidden
        className="size-8 animate-spin rounded-full border-[3px] border-white/20 border-t-brand"
      />
      <p className="text-sm text-white/50">{label}</p>
    </div>
  );
}
