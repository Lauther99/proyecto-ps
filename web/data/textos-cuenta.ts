export const C = {
  titulo: "Tu cuenta", apodo: "Apodo", apodoAyuda: "Es lo que ven los demás en la sala y en la cola.", apodoError: "Usa entre 3 y 20 letras, números, puntos o guiones.", guardar: "Guardar apodo", guardado: "Apodo guardado",
  saldo: "Saldo", disponible: "Disponible", reservado: "Reservado", reservadoTexto: "Se cobra cuando aceptas tu turno.", recargar: "Recargar créditos", creditos: (n: number) => `${n} créditos`,
  bloqueado: (motivo: string | null) => ["Tu cuenta está bloqueada", `No puedes hacer cola ni recargar. ${motivo ? `Motivo: ${motivo}. ` : ""}Si crees que es un error, escríbenos desde Ayuda.`], salir: "Cerrar sesión",
  pestanas: { movimientos: "Movimientos", recargas: "Recargas", sesiones: "Sesiones" }, historial: "Historial",
  colMov: ["Fecha", "Detalle", "Créditos"], colRec: ["Fecha", "Operación", "Monto", "Estado"], colSes: ["Fecha", "Juego", "Jugaste", "Créditos", "Resultado"],
  vacio: { movimientos: "Todavía no tienes movimientos.", recargas: "Todavía no tienes recargas.", sesiones: "Todavía no jugaste." },
  fin: {
    titulo: "Buena partida", interrumpida: "Se detuvo la consola", textoInt: "Fue nuestra falla. Ya devolvimos a tu saldo los minutos que no jugaste.", jugaste: "Jugaste", cobrados: "Créditos cobrados", devueltos: "Créditos devueltos", saldo: "Tu saldo",
    califica: "¿Cómo estuvo tu partida?", notas: ["Muy mala", "Mala", "Regular", "Buena", "Muy buena"], enviar: "Enviar calificación", gracias: "Gracias, nos ayuda a mejorar.", problema: "¿Qué falló?", problemas: ["Imagen entrecortada", "Respuesta lenta", "Sonido", "Mando"], otra: "Comprar otra vez", sala: "Volver a la sala",
  },
  resultados: { complete: "Completa", left: "Terminó antes", interrupted: "Interrumpida", skipped: "Terminada por el admin" },
  admin: "Panel de admin", sinSesion: "Todavía no tienes una partida terminada", sinSesionTexto: "Cuando termines de jugar, verás aquí el resumen.",
};
