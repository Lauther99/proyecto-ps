import { espera, soles, type Precio } from "@/lib/config";

export const P = {
  salas: { titulo: "Salas", texto: "Mira el directo o ponte en la cola. Mirar es gratis y sin cuenta.", entrar: "Entrar a la sala", consola: "Consola", juego: "Juego", vacio: "No hay salas abiertas", vacioTexto: "Vuelve más tarde. Tus créditos siguen en tu saldo.", nadie: "Nadie" },
  juegos: {
    titulo: "Juegos", texto: "Esto es lo que puedes jugar en la consola.", jugadores: (n: number) => (n === 1 ? "1 jugador" : `Hasta ${n} jugadores`),
    estados: { available: "Disponible", soon: "Pronto", unavailable: "No disponible" }, vacio: "Todavía no hay juegos publicados", vacioTexto: "Estamos preparando el catálogo.", accion: "Ir a la sala",
  },
  precios: {
    titulo: "Precios", texto: (p: Precio) => `1 crédito es ${soles(1)}. Cada ${p.blockMinutes} minutos son ${p.blockCredits} créditos. Puedes comprar hasta ${espera(p.maxMinutes)} por turno.`,
    columnas: ["Bloque", "Minutos", "Créditos", "Pagas"], tabla: "Bloques y precios", accion: "Recargar créditos",
    cobroTitulo: "Cuándo se cobra",
    cobro: (p: Precio) => [["Al entrar a la cola", "Reservamos los créditos del bloque que elegiste."], ["Al aceptar tu turno", `Se cobran. Tienes ${p.acceptSeconds} segundos para aceptar.`], ["Si sales antes", "La reserva se cancela y los créditos vuelven a tu saldo."]],
    devTitulo: "Devoluciones",
    dev: [["Se cae la consola o el servicio", "Te devolvemos los minutos que no jugaste."], ["Se corta tu internet", "Puedes reconectarte mientras dure tu turno. El tiempo sigue corriendo."], ["Se pasa tu turno sin aceptar", "Tus créditos vuelven a tu saldo."], ["Terminas antes por tu cuenta", "Los minutos que quedan no se devuelven."]],
    masDev: "Leer la política de reembolsos",
  },
  prueba: {
    titulo: "Prueba tu conexión y tu mando", texto: "Son dos pruebas separadas. Ninguna mide la demora total del juego, que también depende del video y de tu pantalla.",
    conexion: "Conexión", conexionTexto: "Mide el camino entre tu equipo y nuestro servicio.", medir: "Medir conexión", otra: "Medir otra vez", midiendo: "Midiendo, no cierres esta página", sin: "Todavía no mediste tu conexión.",
    medidas: [["Ping", "Cuánto tarda en ir y volver"], ["Jitter", "Cuánto varía el ping"], ["Fallos", "Intentos sin respuesta"]],
    resultado: { buena: "Tu conexión está lista para jugar.", regular: "Se puede jugar, pero notarás demoras en juegos rápidos.", mala: "El juego puede verse entrecortado o responder tarde." },
    mando: "Mando", mandoTexto: "Se revisa en tu equipo. No se envía nada.", botones: "Botones", palancas: "Palancas", izq: "Izquierda", der: "Derecha", frecuencia: "Frecuencia", mueve: "Mueve una palanca para medir", falloMedir: "No pudimos medir: el servicio no respondió. Intenta otra vez.", nombres: ["Arriba", "Derecha", "Abajo", "Izquierda"], gatillos: ["Superior izq.", "Superior der.", "Gatillo izq.", "Gatillo der."], presionado: "presionado",
    sinMando: "No vemos ningún mando", sinMandoTexto: "Conéctalo por USB y presiona cualquier botón.", mandoBien: "Presiona los botones y mueve las palancas: deben encenderse al instante.", noEstandar: "Tu navegador no reconoce la distribución de este mando. Algunos botones pueden no coincidir.",
    consejos: "Para jugar mejor", lista: [["Usa cable de red", "Si no puedes, usa Wi-Fi de 5 GHz y acércate al router."], ["Conecta el mando por USB", "Evita las demoras del Bluetooth."], ["Activa el modo juego de tu TV", "Solo si usas una TV por HDMI. Reduce el tiempo que tarda en mostrar la imagen."]],
    listo: "Elegir mi bloque",
  },
  ayuda: {
    titulo: "Ayuda", texto: "Respuestas cortas a lo que más nos preguntan.",
    faq: [
      ["¿Necesito una consola?", "No. Juegas desde el navegador con mando o teclado. La consola está con nosotros."],
      ["¿Necesito cuenta para mirar?", "No. El directo es público. Solo necesitas entrar con Google para hacer cola, recargar y jugar."],
      ["¿Cuánto tarda mi recarga?", "Una persona revisa cada pago. [Tiempo de atención por definir]"],
      ["¿Qué hago si se corta mi internet?", "Vuelve a entrar y presiona Reconectar. Puedes hacerlo mientras dure tu turno."],
      ["¿Qué pasa si falla la consola?", "Te devolvemos los minutos que no jugaste."],
      ["¿Quién ve mi correo?", "En la sala solo se ve tu apodo."],
    ],
    contacto: "¿No encontraste tu respuesta?", contactoTexto: "Escríbenos a [correo de contacto]. Incluye tu apodo y, si es por una recarga, el número de operación.",
  },
  plantilla: "Plantilla. Este texto debe revisarlo el responsable del servicio antes de publicarse.", indice: "En esta página", actualizado: "Última actualización: [fecha]",
  documentos: {
    terminos: { titulo: "Términos del servicio", secciones: [["Quiénes somos", "[Nombre o razón social], responsable de We Love Gaming. [Datos de contacto]"], ["Qué ofrecemos", "Acceso por turnos a una consola real desde el navegador. Una persona juega y las demás pueden mirar un directo."], ["Tu cuenta", "Entras con Google. Eres responsable de lo que se haga con tu cuenta. [Edad mínima por definir]"], ["Créditos y turnos", "Los créditos se reservan al entrar a la cola y se cobran al aceptar el turno. Hay 60 segundos para aceptar."], ["Uso permitido", "[Conductas no permitidas y consecuencias]"], ["Bloqueo de cuentas", "[Motivos de bloqueo y cómo reclamar]"], ["Cambios", "[Cómo se avisan los cambios a estos términos]"]] },
    privacidad: { titulo: "Privacidad", secciones: [["Qué datos usamos", "Tu nombre y correo de Google, tu apodo, tus recargas y tus sesiones de juego."], ["Para qué los usamos", "Para darte acceso, llevar tu saldo y resolver problemas con tus turnos."], ["Qué ven los demás", "Tu apodo, tu lugar en la cola y lo que juegas en el directo. Nunca tu correo."], ["Con quién se comparten", "[Proveedores que intervienen en el servicio]"], ["Cuánto tiempo los guardamos", "[Plazos por definir]"], ["Tus derechos", "[Cómo pedir acceso, corrección o eliminación de tus datos]"]] },
    reembolsos: { titulo: "Reembolsos", secciones: [["Si salimos de servicio", "Si falla la consola o el servicio, devolvemos a tu saldo los minutos que no jugaste."], ["Si falla tu conexión", "No hay devolución, pero puedes reconectarte mientras dure tu turno."], ["Antes de tu turno", "Si sales de la cola o no aceptas a tiempo, los créditos reservados vuelven a tu saldo."], ["Si terminas antes", "Los minutos que dejas de jugar por decisión propia no se devuelven."], ["Recargas rechazadas", "Si no encontramos tu pago, verás el motivo y podrás corregir el número de operación."], ["Devolución en dinero", "[Condiciones y plazos por definir]"]] },
  },
};
