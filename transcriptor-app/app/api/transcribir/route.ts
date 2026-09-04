/**
 * Recibe la peticion de transcripcion.
 *
 * Soporta dos modos:
 *   1. Modo Asincrono (Produccion / Vercel):
 *      - El audio ya se subio a Vercel Blob.
 *      - Enviamos la URL a Deepgram con un parametro 'callback'.
 *      - Deepgram responde de inmediato (< 1 seg) con el request_id.
 *      - Respondemos al cliente con { status: "procesando", id }.
 *      - Asi NUNCA superamos el limite de 60 segundos de Vercel Hobby.
 *
 *   2. Modo Sincrono (Local / Archivos directos):
 *      - En local o con FormData, enviamos el audio directo a Deepgram y esperamos.
 */

import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { VOCABULARIO } from "@/lib/vocabulario";
import {
  agruparTurnos,
  normalizarDeepgram,
  type RespuestaDeepgram,
} from "@/lib/formato";
import {
  codigoCorrecto,
  esHostLocal,
  esUrlDeBlob,
  firmarCallback,
  hostPublico,
} from "@/lib/seguridad";

export const runtime = "nodejs";
export const maxDuration = 300; // segundos

/** Tamano maximo que acepta una funcion de Vercel en modo directo. */
const LIMITE_BYTES = 95 * 1024 * 1024;

function error(mensaje: string, status: number, detalle?: string) {
  return NextResponse.json({ error: mensaje, detalle }, { status });
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
    // Solo se acepta un archivo de nuestro propio almacenamiento: si no, se
    // podria hacer que Deepgram descargue cualquier direccion de internet.
    if (!esUrlDeBlob(cuerpo.url)) {
      return { error: error("La URL del audio no es válida.", 400) };
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
        "Vuelve a exportarlo con menor calidad, pártelo en dos, o usa el script de escritorio, que no tiene ese límite.",
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
  if (!codigoCorrecto(datos.codigo)) {
    return error(
      "Código de acceso incorrecto.",
      401,
      "Pídeselo a quien desplegó la aplicación.",
    );
  }

  const modelo = process.env.DEEPGRAM_MODELO?.trim() || "nova-3";
  const idioma = process.env.DEEPGRAM_IDIOMA?.trim() || "es";

  // Host publico al que Deepgram enviara el webhook. Se valida contra dominios
  // propios: la cabecera llega desde fuera y no se puede tomar tal cual.
  const host = hostPublico(request);
  const esLocal = esHostLocal(host);

  // Generamos un ID unico para esta transcripcion
  const transcripcionId = crypto.randomUUID();

  const construirUrl = (conVocabulario: boolean, conCallback: boolean) => {
    const p = new URLSearchParams({
      model: modelo,
      language: idioma,
      diarize_model: "latest",
      punctuate: "true",
      smart_format: "true",
      utterances: "true",
    });

    if (conCallback && !esLocal && datos.modo === "blob") {
      const sinVocabulario = !conVocabulario;
      const firma = firmarCallback(clave, transcripcionId, sinVocabulario);
      const cb = new URL(`https://${host}/api/callback`);
      cb.searchParams.set("id", transcripcionId);
      cb.searchParams.set("audioUrl", datos.url);
      if (sinVocabulario) cb.searchParams.set("sinVocab", "1");
      cb.searchParams.set("firma", firma);
      p.append("callback", cb.toString());
      p.append("callback_method", "post");
    }

    if (conVocabulario) {
      const campo = modelo.startsWith("nova-3") ? "keyterm" : "keywords";
      for (const t of VOCABULARIO) {
        p.append(campo, campo === "keywords" ? `${t}:2` : t);
      }
    }
    return `https://api.deepgram.com/v1/listen?${p.toString()}`;
  };

  // Si estamos en produccion con modo Blob, usamos Deepgram Asincrono (Callback)
  const usarCallback = !esLocal && datos.modo === "blob";

  let cabeceras: Record<string, string>;
  let cuerpoDeepgram: BodyInit;

  if (datos.modo === "blob") {
    cabeceras = {
      Authorization: `Token ${clave}`,
      "Content-Type": "application/json",
    };
    cuerpoDeepgram = JSON.stringify({ url: datos.url });
  } else {
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
    respuesta = await fetch(construirUrl(true, usarCallback), {
      method: "POST",
      headers: cabeceras,
      body: cuerpoDeepgram,
    });

    if (respuesta.status === 400) {
      avisoVocabulario =
        "Deepgram rechazó la lista de vocabulario técnico con este modelo, " +
        "así que la transcripción se hizo sin ella.";
      respuesta = await fetch(construirUrl(false, usarCallback), {
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

  // Si usamos Callback en produccion, Deepgram responde inmediatamente
  if (usarCallback) {
    return NextResponse.json({
      status: "procesando",
      id: transcripcionId,
    });
  }

  // Modo Sincrono (Local): procesar resultado directamente
  if (datos.modo === "blob") {
    await del(datos.url).catch(() => {});
  }

  const data = (await respuesta.json()) as RespuestaDeepgram;
  const intervenciones = agruparTurnos(normalizarDeepgram(data));

  if (intervenciones.length === 0) {
    return error(
      "No se reconoció ninguna voz en el audio.",
      422,
      "Revisa que la grabación tenga sonido y que se escuche a las personas.",
    );
  }

  return NextResponse.json({
    status: "completado",
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
