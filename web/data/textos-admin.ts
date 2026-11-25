export const A = {
  soloAdmin: "Solo para administradores", soloAdminTexto: "Tu cuenta no tiene permiso para ver esta sección.", titulo: "Admin", sitio: "Volver al sitio", menu: "Secciones de admin", cancelar: "Cancelar", motivo: "Motivo", motivoError: "Escribe el motivo.", sinPendientes: "No hay pendientes.",
  nav: [["Resumen", "/admin"], ["Recargas", "/admin/recargas"], ["Usuarios", "/admin/usuarios"], ["Sala", "/admin/sala"], ["Sesiones", "/admin/sesiones"], ["Juegos", "/admin/juegos"], ["Configuración", "/admin/configuracion"]],
  resumen: {
    titulo: "Resumen", servicio: "Servicio", agente: "Agente", consola: "Consola", directo: "Directo", conectado: "Conectado", desconectado: "Desconectado", vivo: "En vivo", caido: "No disponible",
    senal: (s: string) => `Sin señal desde ${s}. Revisa la laptop de la casa.`, sinSenal: "Sin señal. Revisa la laptop de la casa.", conSenal: "Conectado a la sala", detalleDirecto: ["Transmisión pedida al agente", "Los jugadores pueden seguir jugando."], periodos: { today: "Hoy", week: "Últimos 7 días", month: "Este mes" },
    pendientes: "Por atender", ingresos: "Ingresos", columnas: ["Periodo", "Recargas aprobadas", "Ingresos", "Minutos jugados"], verRecargas: "Revisar recargas", verUsuarios: "Ver usuarios",
    esperan: (n: number) => (n === 1 ? "1 recarga espera revisión" : `${n} recargas esperan revisión`), repetidos: (n: number) => (n === 1 ? "1 número de operación está repetido" : `${n} números de operación están repetidos`), ahora: "Ahora", enCola: (n: number) => `${n} en cola`, juega: (a: string) => `Juega ${a}`, verSala: "Controlar la sala", sinIngresos: "Todavía no hay ingresos.",
  },
  recargas: {
    titulo: "Recargas", columnas: ["Usuario", "Monto", "Operación", "Fecha", "Estado", "Acciones"], vacio: "No hay recargas por revisar.", repetida: "Operación repetida", repetidaTexto: "Este número ya se usó en otra recarga aprobada. Revisa antes de decidir.",
    filtros: { pending: "Pendientes", approved: "Aprobadas", rejected: "Rechazadas" }, filtro: "Filtrar por estado", aprobar: "Aprobar", rechazar: "Rechazar",
    aprobarTitulo: (m: string) => `Aprobar ${m}`, aprobarTexto: (u: string, n: number) => `Se sumarán ${n} créditos a ${u}.`, verifique: "Verifiqué en Yape que el dinero ingresó", confirmar: "Aprobar y sumar créditos",
    rechazarTitulo: "Rechazar recarga", rechazarTexto: "El usuario verá este motivo.", confirmarRechazo: "Rechazar recarga", nueva: "Última",
    avisoRepetidas: "Hay un número de operación repetido entre las pendientes.",
  },
  usuarios: {
    titulo: "Usuarios", buscar: "Buscar por apodo o correo", hacerAdmin: "Hacer admin", quitarAdmin: "Quitar admin", rolTitulo: (u: string, admin: boolean) => (admin ? `¿Quitar admin a ${u}?` : `¿Hacer admin a ${u}?`), rolTexto: "Un admin aprueba recargas, ajusta saldos y toma el control de la consola.", admin: "Admin", tu: "Tú", columnas: ["Apodo", "Correo", "Saldo", "Estado", "Acciones"], vacio: "Ningún usuario coincide con tu búsqueda.", activo: "Activo", bloqueado: "Bloqueado", bloquear: "Bloquear", desbloquear: "Desbloquear", ajustar: "Ajustar saldo",
    bloquearTitulo: (u: string) => `Bloquear a ${u}`, desbloquearTitulo: (u: string) => `Desbloquear a ${u}`, bloquearTexto: "Podrá mirar el directo, pero no hacer cola, recargar ni jugar.", desbloquearTexto: "Podrá volver a hacer cola, recargar y jugar.",
    ajustarTitulo: (u: string) => `Ajustar saldo de ${u}`, cantidad: "Créditos a sumar o restar", cantidadAyuda: "Usa un número negativo para restar.", cantidadError: "Escribe un número entero distinto de 0 que no deje el saldo negativo.", antes: "Saldo ahora", despues: "Saldo después", guardar: "Guardar ajuste",
  },
  sala: {
    titulo: "Sala", jugador: "Jugador actual", nadie: "Nadie está jugando.", tomar: "Tomar control", soltar: "Soltar control", saltar: "Saltar turno", pausar: "Pausar cola", reanudar: "Reanudar cola", devolver: "Devolver tiempo", cola: "Cola", subir: (u: string) => `Subir a ${u}`, bajar: (u: string) => `Bajar a ${u}`, vacio: "No hay nadie en la cola.",
    control: "Tienes el control. El turno del jugador está detenido.", pausada: "La cola está en pausa. Nadie recibe turnos nuevos.",
    tomarTitulo: "¿Tomar el control?", tomarTexto: "Detiene el turno del jugador y te da el mando. Su tiempo no corre mientras tanto.", saltarTitulo: "¿Saltar este turno?", saltarTexto: "Termina el turno actual y llama a la siguiente persona. Si corresponde, devuelve antes el tiempo.",
    devolverTitulo: "Devolver tiempo", minutos: "Minutos a devolver", minutosError: "Escribe entre 1 y 120 minutos.", equivale: (n: number) => `Equivale a ${n} créditos`, confirmar: "Devolver", directo: "Transmitir a YouTube", irJugar: "Ir a jugar", hecho: "Listo. Se registró el cambio.", minutosDe: (n: number) => `${n} min`,
  },
  sesiones: { titulo: "Sesiones", columnas: ["Inicio", "Usuario", "Juego", "Jugó", "Créditos", "Resultado"], vacio: "Todavía no hay sesiones." },
  juegos: { titulo: "Juegos", columnas: ["Juego", "Género", "Jugadores", "Disponibilidad"], vacio: "Todavía no hay juegos.", cambiar: (n: string) => `Disponibilidad de ${n}` },
  config: {
    titulo: "Configuración", precio: "Precio y turnos", minutos: "Minutos por bloque", creditos: "Créditos por bloque", maximo: "Máximo por compra, en minutos", aceptar: "Segundos para aceptar", yape: "Yape", titular: "Titular", numero: "Número", qr: "Imagen del QR", qrTexto: "Se cambia en los archivos del sitio.", directo: "Directo", canal: "ID del canal de YouTube", guardar: "Guardar cambios", guardado: "Cambios guardados.", error: "Revisa los datos: minutos, créditos, máximo y segundos deben ser números enteros mayores que 0, y el máximo debe ser múltiplo del bloque.", nota: "Los cambios se aplican a las compras nuevas. Los turnos en curso no cambian.",
  },
};
