/**
 * Webhook que recibe la respuesta asincrona de Deepgram.
 *
 * Cuando transcribimos audios largos en Vercel, Deepgram procesa en segundo plano
 * y llama a este endpoint al terminar (sea en 30 segundos o en 5 minutos).
 *
 * Este endpoint comprueba la firma de la URL, normaliza las intervenciones, las
 * guarda temporalmente en Vercel Blob bajo 'resultados/<id>.json' para que el
 * frontend las consulte, y borra el audio original.
 *
 * La firma es imprescindible: sin ella cualquiera podria llamar aqui para
 * escribir resultados falsos o para pedir el borrado de archivos ajenos.
 */

import { NextResponse } from "next/server";
import { put, del, list } from "@vercel/blob";
import {
  agruparTurnos,
  normalizarDeepgram,
  type RespuestaDeepgram,
} from "@/lib/formato";
import { VOCABULARIO } from "@/lib/vocabulario";
import {
  esUrlDeBlob,
  esUuid,
  firmaValida,
  firmarCallback,
  rutaResultado,
} from "@/lib/seguridad";

export const runtime = "nodejs";

/** Cuanto se conserva un resultado que nadie recogio. */
const HORAS_DE_VIDA = 24;

async function guardar(id: string, contenido: Record<string, unknown>) {
  // Si esto falla, el navegador se quedaria sondeando para siempre sin saber
  // por que. Se deja explotar para que quede en los registros de Vercel.
  const guardado = await put(rutaResultado(id), JSON.stringify(contenido), {
    // Privado a proposito: este archivo lo escribe y lo lee el servidor con el
    // token, nunca el navegador. No hay ninguna razon para publicarlo, y
    // contiene lo que se dijo en la sesion.
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  console.log("Resultado guardado en", guardado.pathname);
  return guardado;
}

/**
 * Borra lo que quedo sin recoger.
 *
 * Dos casos: resultados que el navegador nunca llego a leer porque cerraron la
 * pestana, y audios de transcripciones que fallaron a mitad de camino. Un audio
 * de una sesion pesa decenas de megas, asi que no puede quedarse ahi para
 * siempre. Se limpia aqui porque esto corre una vez por transcripcion, no en
 * cada consulta.
 */
async function limpiarHuerfanos() {
  const limite = Date.now() - HORAS_DE_VIDA * 60 * 60 * 1000;
  for (const prefijo of ["resultados/", ""]) {
    try {
      const { blobs } = await list({ prefix: prefijo, limit: 200 });
      const viejos = blobs.filter(
        (b) =>
          new Date(b.uploadedAt).getTime() < limite &&
          !b.pathname.startsWith("diagnostico/"),
      );
      if (viejos.length > 0) await del(viejos.map((b) => b.url));
    } catch {
      // La limpieza es oportunista: si falla, no debe tumbar el callback.
    }
  }
}

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const audioUrl = params.get("audioUrl") ?? "";
  const sinVocabulario = params.get("sinVocab") === "1";

  if (!esUuid(id)) {
    return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  }

  const clave = process.env.DEEPGRAM_API_KEY?.trim();
  if (!clave) {
    return NextResponse.json({ error: "Servidor sin configurar" }, { status: 500 });
  }

  const esperada = firmarCallback(clave, id, sinVocabulario);
  if (!firmaValida(esperada, params.get("firma"))) {
    // Sin ruido en la respuesta: quien llame sin firma no merece pistas.
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const borrarAudio = async () => {
    if (esUrlDeBlob(audioUrl)) await del(audioUrl).catch(() => {});
  };

  let body: RespuestaDeepgram & {
    err_code?: string;
    err_msg?: string;
    error?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Si Deepgram devolvio error
  if (body.err_code || body.err_msg || body.error) {
    await guardar(id, {
      status: "error",
      error: body.err_msg || body.error || `Error de Deepgram: ${body.err_code}`,
      detalle: "Deepgram no pudo procesar la grabación.",
    });
    await borrarAudio();
    return NextResponse.json({ ok: true });
  }

  // Diagnostico: si la escritura en Blob falla, el navegador se queda
  // sondeando sin saber por que. El mensaje solo lo puede ver quien traiga una
  // firma valida, es decir quien ya conoce la clave del servidor.
  const conDiagnostico = async (accion: () => Promise<unknown>) => {
    try {
      await accion();
      return null;
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      console.error("Fallo al guardar el resultado:", detalle);
      return NextResponse.json(
        { error: "No se pudo guardar el resultado.", detalle },
        { status: 500 },
      );
    }
  };

  const intervenciones = agruparTurnos(normalizarDeepgram(body));

  if (intervenciones.length === 0) {
    await guardar(id, {
      status: "error",
      error: "No se reconoció ninguna voz en el audio.",
      detalle:
        "Revisa que la grabación tenga sonido y que se escuche a las personas.",
    });
    await borrarAudio();
    return NextResponse.json({ ok: true });
  }

  const fallo = await conDiagnostico(() =>
    guardar(id, {
    status: "completado",
    intervenciones,
    // El aviso viaja en la URL del callback: si Deepgram rechazo la lista de
    // terminos, quien use la app en produccion tiene que enterarse igual.
    aviso: sinVocabulario
      ? "Deepgram rechazó la lista de vocabulario técnico con este modelo, " +
        "así que la transcripción se hizo sin ella. Los términos del proyecto " +
        "pueden salir peor escritos."
      : null,
    meta: {
      servicio: "deepgram",
      modelo: process.env.DEEPGRAM_MODELO?.trim() || "nova-3",
      intervenciones: intervenciones.length,
      terminos_de_vocabulario: sinVocabulario ? 0 : VOCABULARIO.length,
    },
    }),
  );
  if (fallo) return fallo;

  await borrarAudio();
  await limpiarHuerfanos();

  return NextResponse.json({ ok: true });
}
