// Piezas visuales compartidas por la sala y el panel admin.

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-500',
    secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
    danger: 'bg-red-700 text-white hover:bg-red-600',
  }[variant]
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-zinc-300">{title}</h2>}
      {children}
    </section>
  )
}

export function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
      {label}
    </span>
  )
}
