// Video de prueba para el modo demo: un lienzo animado enviado por WebRTC dentro de la misma página.
// Muestra el último estado de control que recibió, para comprobar el canal "input".
export function abrirVideo(ofrecer: (sdp: string) => void) {
  const pc = new RTCPeerConnection()
  const lienzo = document.createElement('canvas')
  lienzo.width = 1280
  lienzo.height = 720
  const g = lienzo.getContext('2d')!
  let control = 'sin controles'
  let n = 0
  const dibujo = setInterval(() => {
    n++
    g.fillStyle = '#141614'
    g.fillRect(0, 0, 1280, 720)
    g.fillStyle = '#3b9eff'
    g.fillRect((n * 6) % 1280, 330, 60, 60)
    g.fillStyle = '#f2f5f1'
    g.font = '28px monospace'
    g.fillText('Video de prueba (modo demo)', 40, 80)
    g.fillText(control.slice(0, 70), 40, 660)
  }, 33)
  const flujo = lienzo.captureStream(30)
  flujo.getTracks().forEach((t) => pc.addTrack(t, flujo))
  pc.createDataChannel('input').onmessage = (e) => (control = String(e.data))
  void (async () => {
    await pc.setLocalDescription(await pc.createOffer())
    await new Promise<void>((ok) => {
      const limite = setTimeout(ok, 1500)
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState !== 'complete') return
        clearTimeout(limite)
        ok()
      })
    })
    if (pc.signalingState !== 'closed') ofrecer(pc.localDescription!.sdp)
  })().catch(console.error)
  return {
    responder: (sdp: string) => void pc.setRemoteDescription({ type: 'answer', sdp }).catch(console.error),
    cerrar: () => {
      clearInterval(dibujo)
      flujo.getTracks().forEach((t) => t.stop())
      pc.close()
    },
  }
}
