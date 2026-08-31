/**
 * Logica de formateo compartida entre el servidor y el navegador.
 *
 * Es la misma que usa el script de escritorio transcribir.py: deteccion de
 * decisiones por frases clave, marcado de fragmentos de baja confianza y
 * armado del documento Markdown final.
 */

export type Palabra = {
  texto: string;
  confianza: number;
};

export type Intervencion = {
  inicio: number; // segundos desde el inicio del audio
  fin?: number;
  idHablante: string; // "A", "B", "C"...
  palabras: Palabra[];
  textoPlano: string;
};

export type Decision = {
  inicio: number;
  idHablante: string;
  fragmento: string;
};

/** Confianza por debajo de la cual el texto se marca como [inaudible: ...]. */
export const UMBRAL_CONFIANZA = 0.6;

/**
 * Frases que en el protocolo del grupo indican el cierre de una decision.
 * Se evaluan sobre texto normalizado (minusculas y sin tildes).
 */
const PATRONES_DECISION = [
  "queda(?:mos)?\\s+(?:entonces\\s+)?(?:como\\s+)?(?:un\\s+)?acuerdo",
  "como\\s+acuerdo\\s+que",
  "quedamos\\s+en\\s+que",
  "(?:entonces\\s+)?decidimos\\s+que",
  "acordamos\\s+que",
  "queda(?:mos)?\\s+(?:entonces\\s+)?en\\s+que",
  "qued[o]\\s+aprobad[oa]",
  "queda\\s+aprobad[oa]",
  "el\\s+acuerdo\\s+(?:es|queda|seria)",
  "nos\\s+comprometemos\\s+a",
  "el\\s+compromiso\\s+(?:es|queda|seria)",
  "tarea\\s+para\\s+la\\s+proxima",
];

const REGEX_DECISION = new RegExp(PATRONES_DECISION.join("|"));

export function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizar(texto: string): string {
  return sinTildes(texto.toLowerCase());
}

/** Convierte segundos en la marca de tiempo [mm:ss] que se ve en el documento. */
export function mmss(segundos: number): string {
  const total = Math.round(segundos || 0);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Convierte el id numerico del servicio (0, 1, 2...) en A, B, C... */
export function letraHablante(indice: number | string): string {
  if (typeof indice === "string") {
    const limpio = indice.trim();
    if (limpio && !/^\d+$/.test(limpio)) return limpio.toUpperCase();
    indice = Number(limpio || 0);
  }
  if (!Number.isFinite(indice) || indice < 0) return "A";
  let letras = "";
  let n = Math.floor(indice as number);
  for (;;) {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return letras;
}

/**
 * Envuelve las rachas de palabras de baja confianza en [inaudible: ...].
 * La puntuacion final queda fuera del corchete para que se lea natural.
 */
export function textoConMarcas(
  intervencion: Intervencion,
  umbral: number = UMBRAL_CONFIANZA,
): string {
  const palabras = intervencion.palabras ?? [];
  if (palabras.length === 0) return intervencion.textoPlano ?? "";

  const partes: string[] = [];
  let racha: string[] = [];

  const cerrarRacha = () => {
    if (racha.length === 0) return;
    let fragmento = racha.join(" ").trim();
    let cola = "";
    const m = fragmento.match(/([,.;:!?]+)$/);
    if (m) {
      cola = m[1];
      fragmento = fragmento.slice(0, m.index).trim();
    }
    if (fragmento) partes.push(`[inaudible: ${fragmento}]${cola}`);
    racha = [];
  };

  for (const p of palabras) {
    const txt = (p.texto ?? "").trim();
    if (!txt) continue;
    if ((p.confianza ?? 1) < umbral) {
      racha.push(txt);
    } else {
      cerrarRacha();
      partes.push(txt);
    }
  }
  cerrarRacha();

  return partes
    .join(" ")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[¿¡])\s+/g, "$1")
    .trim();
}

/**
 * Une las intervenciones seguidas de un mismo hablante.
 *
 * Deepgram corta en cuanto hay una pausa de menos de un segundo, asi que una
 * sola frase puede llegar partida en tres pedazos ("Buenas," / "entonces la
 * idea de hoy es..." / "que propusimos la semana pasada."). Para el acta se lee
 * mucho mejor un bloque por turno de palabra.
 *
 * No se unen turnos separados por un silencio largo, para que las marcas de
 * tiempo sigan sirviendo para volver al audio.
 */
export function agruparTurnos(
  intervenciones: Intervencion[],
  maxHuecoSeg = 3,
  maxCaracteres = 900,
): Intervencion[] {
  const agrupadas: Intervencion[] = [];

  for (const i of intervenciones) {
    const previa = agrupadas[agrupadas.length - 1];
    const hueco =
      previa && previa.fin !== undefined ? i.inicio - previa.fin : Infinity;

    const sePuedeUnir =
      previa !== undefined &&
      previa.idHablante === i.idHablante &&
      hueco <= maxHuecoSeg &&
      previa.textoPlano.length + i.textoPlano.length + 1 <= maxCaracteres;

    if (sePuedeUnir) {
      previa.palabras = previa.palabras.concat(i.palabras);
      previa.textoPlano = `${previa.textoPlano} ${i.textoPlano}`.trim();
      previa.fin = i.fin;
    } else {
      agrupadas.push({ ...i, palabras: [...i.palabras] });
    }
  }

  return agrupadas;
}

/** Cuenta cuantas palabras quedaron marcadas como inciertas. */
export function contarInciertas(
  intervenciones: Intervencion[],
  umbral: number = UMBRAL_CONFIANZA,
): { bajas: number; total: number } {
  let bajas = 0;
  let total = 0;
  for (const i of intervenciones) {
    for (const p of i.palabras ?? []) {
      if (!(p.texto ?? "").trim()) continue;
      total += 1;
      if ((p.confianza ?? 1) < umbral) bajas += 1;
    }
  }
  return { bajas, total };
}

/** Devuelve las intervenciones que contienen una frase de cierre de acuerdo. */
export function detectarDecisiones(
  intervenciones: Intervencion[],
  ancho = 220,
): Decision[] {
  const encontradas: Decision[] = [];
  for (const i of intervenciones) {
    const texto = i.textoPlano ?? "";
    if (!texto) continue;
    const m = REGEX_DECISION.exec(normalizar(texto));
    if (!m) continue;

    let fragmento: string;
    if (texto.length <= ancho) {
      fragmento = texto;
    } else {
      const ini = Math.max(0, m.index - 40);
      const fin = Math.min(texto.length, ini + ancho);
      fragmento = texto.slice(ini, fin).trim();
      if (ini > 0) fragmento = "..." + fragmento;
      if (fin < texto.length) fragmento = fragmento + "...";
    }
    encontradas.push({
      inicio: i.inicio,
      idHablante: i.idHablante,
      fragmento,
    });
  }
  return encontradas;
}

/** Etiquetas de hablante en el orden en que aparecen por primera vez. */
export function hablantesEnOrden(intervenciones: Intervencion[]): string[] {
  const orden: string[] = [];
  for (const i of intervenciones) {
    if (!orden.includes(i.idHablante)) orden.push(i.idHablante);
  }
  return orden;
}

/**
 * Primeras intervenciones de un hablante, para mostrarlas al momento de
 * preguntar quien es.
 */
export function muestrasDe(
  intervenciones: Intervencion[],
  idHablante: string,
  cuantas = 3,
  minimoPalabras = 3,
): { inicio: number; texto: string }[] {
  const muestras: { inicio: number; texto: string }[] = [];
  for (const i of intervenciones) {
    if (i.idHablante !== idHablante) continue;
    const texto = (i.textoPlano ?? "").trim();
    if (texto.split(/\s+/).length < minimoPalabras) continue;
    muestras.push({ inicio: i.inicio, texto });
    if (muestras.length >= cuantas) break;
  }
  if (muestras.length === 0) {
    // El hablante solo dijo frases muy cortas: muestro la primera que sea.
    const i = intervenciones.find(
      (x) => x.idHablante === idHablante && (x.textoPlano ?? "").trim(),
    );
    if (i) muestras.push({ inicio: i.inicio, texto: i.textoPlano.trim() });
  }
  return muestras;
}

export type DatosDocumento = {
  intervenciones: Intervencion[];
  nombres: Record<string, string>;
  numero: string;
  fecha: string;
  umbral?: number;
  meta?: Record<string, string | number>;
};

/** Arma el documento Markdown final, listo para subir a Claude. */
export function construirMarkdown({
  intervenciones,
  nombres,
  numero,
  fecha,
  umbral = UMBRAL_CONFIANZA,
  meta = {},
}: DatosDocumento): string {
  const nombreDe = (id: string) => nombres[id]?.trim() || `Hablante ${id}`;
  const L: string[] = [];

  L.push(`# Transcripción — Sesión ${numero} · ${fecha}`);
  L.push("");

  L.push("## Participantes identificados");
  for (const id of hablantesEnOrden(intervenciones)) L.push(`- ${nombreDe(id)}`);
  L.push("");

  const decisiones = detectarDecisiones(intervenciones);
  L.push("## Posibles decisiones detectadas");
  if (decisiones.length > 0) {
    L.push(
      "<!-- Deteccion automatica por frases clave. Revisar a mano: puede fallar. -->",
    );
    L.push("");
    for (const d of decisiones) {
      L.push(
        `- [${mmss(d.inicio)}] ${nombreDe(d.idHablante)}: "${d.fragmento.replace(/"/g, "'")}"`,
      );
    }
  } else {
    L.push(
      '_No se detectaron frases de cierre de acuerdo ("queda como acuerdo", ' +
        '"quedamos en que", "acordamos que", ...). Revisar la transcripción completa a mano._',
    );
  }
  L.push("");

  L.push("## Transcripción completa");
  L.push("");
  for (const i of intervenciones) {
    const texto = textoConMarcas(i, umbral);
    if (!texto) continue;
    L.push(`**[${mmss(i.inicio)}] ${nombreDe(i.idHablante)}:** ${texto}`);
    L.push("");
  }

  const { bajas, total } = contarInciertas(intervenciones, umbral);
  L.push("---");
  L.push("");
  L.push("<!--");
  L.push("Generado por el Transcriptor del Seminario (UIS).");
  for (const [k, v] of Object.entries(meta)) L.push(`${k}: ${v}`);
  L.push(
    `palabras_marcadas_inaudibles: ${total ? `${bajas} de ${total}` : "sin datos de confianza"}`,
  );
  L.push(
    `Los fragmentos [inaudible: ...] tienen confianza menor a ${umbral.toFixed(2)} ` +
      "y deben verificarse contra el audio original.",
  );
  L.push("-->");
  L.push("");

  return L.join("\n");
}

/** Nombre de archivo sugerido para la descarga. */
export function nombreArchivo(numero: string): string {
  const limpio = (numero || "0").replace(/[^\w.-]+/g, "_");
  return `Transcripcion_Sesion_${limpio}.md`;
}
