import type { Metadata } from 'next'
import UsersAdmin from '@/components/admin/users-admin'

export const metadata: Metadata = {
  title: 'Usuarios · Sala PS4',
}

// El backend rechaza estas llamadas si no eres admin (403); la página solo muestra el error.
export default function AdminPage() {
  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <UsersAdmin />
    </main>
  )
}
