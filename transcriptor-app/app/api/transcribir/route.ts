/**
 * Recibe el audio (por FormData o por URL de Vercel Blob), lo manda a Deepgram
 * con diarizacion y vocabulario del proyecto, y devuelve las intervenciones
 * ya normalizadas.
 *
 * Dos modos de recibir el audio:
 *   1. FormData con campo "audio" (local / archivos pequenos).
 *   2. JSON con { url, codigo } (cuando el audio se subio a Vercel Blob).
 *
 * La clave de Deepgram vive SOLO aqui, en el servidor, como variable de entorno.
 * Nunca viaja al celular, asi que nadie puede sacarla de la app.
 */

import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { VOCABULARIO } from "@/lib/vocabulario";
import {
  agruparTurnos,
  letraHablante,
  type Intervencion,
  type Palabra,
} from "@/lib/formato";

export const runtime = "nodejs";
export const maxDuration = 300; // segundos: una sesion de 2 h tarda 1-3 min

/** Tamano maximo que acepta una funcion de Vercel. */
const LIMITE_BYTES = 95 * 1024 * 1024;

type RespuestaDeepgram = {
  results?: {
    utterances?: {
      start?: number;
      end?: number;
      speaker?: number;
      transcript?: string;
      words?: { word?: string; punctuated_word?: string; confidence?: number }[];
    }[];
    channels?: {
      alternatives?: {
        words?: {
          word?: string;
          punctuated_word?: string;
          confidence?: number;
          speaker?: number;
          start?: number;
        }[];
      }[];
    }[];
  };
};

function error(mensaje: string, status: number, detalle?: string) {
  return NextResponse.json({ error: mensaje, detalle }, { status });
}

/** Convierte la respuesta de Deepgram al formato que usa la app. */
function normalizar(data: RespuestaDeepgram): Intervencion[] {
  const resultados = data.results ?? {};
  const intervenciones: Intervencion[] = [];

  for (const u of resultados.utterances ?? []) {
    const palabras: Palabra[] = (u.words ?? []).map((w) => ({
      texto: w.punctuated_word || w.word || "",
      confianza: typeof w.confidence === "number" ? w.confidence : 1,
    }));
    intervenciones.push({
      inicio: u.start ?? 0,
      fin: u.end ?? u.start ?? 0,
      idHablante: letraHablante(u.speaker ?? 0),
      palabras,
      textoPlano: (u.transcript ?? "").trim(),
    });
  }
  if (intervenciones.length > 0) return intervenciones;

  // Respaldo: si no vinieron utterances, agrupo las palabras por hablante.
  const alt = resultados.channels?.[0]?.alternatives?.[0];
  let actual: Intervencion | null = null;
  for (const w of alt?.words ?? []) {
    const hablante = letraHablante(w.speaker ?? 0);
    if (!actual || actual.idHablante !== hablante) {
      actual = {
        inicio: w.start ?? 0,
        idHablante: hablante,
        palabras: [],
        textoPlano: "",
      };
      intervenciones.push(actual);
    }
    actual.palabras.push({
      texto: w.punctuated_word || w.word || "",
      confianza: typeof w.confidence === "number" ? w.confidence : 1,
    });
  }
  for (const i of intervenciones) {
    i.textoPlano = i.palabras.map((p) => p.texto).join(" ").trim();
  }
  return intervenciones;
}

/**
 * Detecta si el request viene con JSON (modo Blob) o FormData (modo directo).
 */
async function extraerDatos(request: Request): Promise<
  | { modo: "blob"; url: string; codigo: string }
  | { modo: "directo"; audio: Blob; codigo: string }
  | { error: ReturnType<typeof error> }
> {
  const tipo = request.headers.get("content-type") ?? "";

  // Modo Blob: el cliente envio un JSON con la URL del archivo.
  if (tipo.includes("application/json")) {
    let cuerpo: { url?: string; codigo?: string };
    try {
      cuerpo = await request.json();
    } catch {
      return { error: error("No se pudo leer la petición.", 400) };
    }
    if (!cuerpo.url || typeof cuerpo.url !== "string") {
      return { error: error("Falta la URL del audio.", 400) };
    }
    return { modo: "blob", url: cuerpo.url, codigo: String(cuerpo.codigo ?? "") };
  }

  // Modo directo: el cliente envio FormData con el archivo.
  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return { error: error("No se pudo leer el audio enviado.", 400) };
  }

  const audio = formulario.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return { error: error("No llegó ningún archivo de audio.", 400) };
  }
  if (audio.size > LIMITE_BYTES) {
    const mb = Math.round(audio.size / (1024 * 1024));
    return {
      error: error(
        `El audio pesa ${mb} MB y el máximo es 95 MB.`,
        413,
        "Vuelve a exportarlo con menor calidad, pártilo en dos, o usa el script de escritorio, que no tiene ese límite.",
      ),
    };
  }

  return {
    modo: "directo",
    audio,
    codigo: String(formulario.get("codigo") ?? ""),
  };
}

export async function POST(request: Request) {
  const clave = process.env.DEEPGRAM_API_KEY?.trim();
  if (!clave) {
    return error(
      "El servidor no tiene configurada la clave de Deepgram.",
      500,
      "Falta la variable de entorno DEEPGRAM_API_KEY. Ver el README.",
    );
  }

  const datos = await extraerDatos(request);
  if ("error" in datos) return datos.error;

  // Codigo de acceso: solo se exige si el despliegue lo configuro.
  const esperado = process.env.CODIGO_ACCESO?.trim();
  if (esperado) {
    const recibido = datos.codigo.trim();
    if (recibido !== esperado) {
      return error(
        "Código de acceso incorrecto.",
        401,
        "Pídeselo a quien desplegó la aplicación.",
      );
    }
  }

  const modelo = process.env.DEEPGRAM_MODELO?.trim() || "nova-3";
  const idioma = process.env.DEEPGRAM_IDIOMA?.trim() || "es";

  const construirUrl = (conVocabulario: boolean) => {
    const p = new URLSearchParams({
      model: modelo,
      language: idioma,
      // OJO: el parametro viejo 'diarize=true' ya no hace nada. Deepgram lo
      // acepta sin quejarse y devuelve todo como un solo hablante. La
      // separacion de voces se activa con 'diarize_model'.
      diarize_model: "latest",
      punctuate: "true",
      smart_format: "true",
      utterances: "true",
    });
    if (conVocabulario) {
      // nova-3 usa 'keyterm'; los modelos anteriores usan 'keywords'.
      const campo = modelo.startsWith("nova-3") ? "keyterm" : "keywords";
      for (const t of VOCABULARIO) {
        p.append(campo, campo === "keywords" ? `${t}:2` : t);
      }
    }
    return `https://api.deepgram.com/v1/listen?${p.toString()}`;
  };

  // Preparar la peticion a Deepgram segun el modo.
  let cabeceras: Record<string, string>;
  let cuerpoDeepgram: BodyInit;

  if (datos.modo === "blob") {
    // Modo Blob: enviar la URL para que Deepgram descargue el audio.
    cabeceras = {
      Authorization: `Token ${clave}`,
      "Content-Type": "application/json",
    };
    cuerpoDeepgram = JSON.stringify({ url: datos.url });
  } else {
    // Modo directo: enviar los bytes crudos.
    const buffer = Buffer.from(await datos.audio.arrayBuffer());
    cabeceras = {
      Authorization: `Token ${clave}`,
      "Content-Type": datos.audio.type || "application/octet-stream",
    };
    cuerpoDeepgram = new Uint8Array(buffer);
  }

  let avisoVocabulario: string | null = null;
  let respuesta: Response;
  try {
    respuesta = await fetch(construirUrl(true), {
      method: "POST",
      headers: cabeceras,
      body: cuerpoDeepgram,
    });

    // Si el modelo no acepta el vocabulario en este idioma, reintento sin el.
    if (respuesta.status === 400) {
      avisoVocabulario =
        "Deepgram rechazó la lista de vocabulario técnico con este modelo, " +
        "así que la transcripción se hizo sin ella. Los términos del proyecto " +
        "pueden salir peor escritos.";
      respuesta = await fetch(construirUrl(false), {
        method: "POST",
        headers: cabeceras,
        body: cuerpoDeepgram,
      });
    }
  } catch (e) {
    return error(
      "No se pudo contactar a Deepgram.",
      502,
      e instanceof Error ? e.message : String(e),
    );
  }

  // Si usamos Blob, borrar el archivo temporal despues de transcribir.
  if (datos.modo === "blob") {
    try {
      await del(datos.url);
    } catch {
      // Si no se pudo borrar (ej: token invalido, ya borrado), no importa.
      // Vercel Blob no cobra por almacenamiento excesivo en el plan gratuito.
    }
  }

  if (respuesta.status === 401) {
    return error(
      "Deepgram rechazó la clave del servidor.",
      502,
      "La clave DEEPGRAM_API_KEY es inválida o fue revocada.",
    );
  }
  if (respuesta.status === 402) {
    return error(
      "Se agotó el crédito gratuito de Deepgram.",
      502,
      "Hay que crear otra cuenta o usar el script de escritorio en modo local.",
    );
  }
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => "");
    return error(
      `Deepgram respondió ${respuesta.status}.`,
      502,
      texto.slice(0, 300),
    );
  }

  const data = (await respuesta.json()) as RespuestaDeepgram;
  const intervenciones = agruparTurnos(normalizar(data));

  if (intervenciones.length === 0) {
    return error(
      "No se reconoció ninguna voz en el audio.",
      422,
      "Revisa que la grabación tenga sonido y que se escuche a las personas.",
    );
  }

  return NextResponse.json({
    intervenciones,
    aviso: avisoVocabulario,
    meta: {
      servicio: "deepgram",
      modelo,
      intervenciones: intervenciones.length,
      terminos_de_vocabulario: avisoVocabulario ? 0 : VOCABULARIO.length,
    },
  });
}
