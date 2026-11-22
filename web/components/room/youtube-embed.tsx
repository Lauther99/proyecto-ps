// Lo que ven los que no están jugando: el directo de YouTube del canal configurado.
// El canal se configura con NEXT_PUBLIC_YOUTUBE_CHANNEL_ID (id que empieza con "UC...").

const CHANNEL_ID = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID

export default function YoutubeEmbed({ live }: { live: boolean }) {
  if (!CHANNEL_ID || !live) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-black text-sm text-zinc-500">
        {CHANNEL_ID ? 'La transmisión está apagada en este momento.' : 'Transmisión de YouTube no configurada.'}
      </div>
    )
  }
  return (
    <iframe
      className="aspect-video w-full rounded-lg bg-black"
      src={`https://www.youtube.com/embed/live_stream?channel=${CHANNEL_ID}&autoplay=1&mute=1`}
      title="Transmisión en vivo"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
    />
  )
}
