/**
 * Webhook que recibe la respuesta asincrona de Deepgram.
 *
 * Cuando transcribimos audios largos en Vercel, Deepgram procesa en segundo plano
 * y llama a este endpoint al terminar (sea en 30 segundos o en 5 minutos).
 *
 * Este endpoint normaliza las intervenciones, las guarda temporalmente en
 * Vercel Blob bajo 'resultados/<id>.json' para que el frontend las consulte,
 * y elimina el archivo de audio original para ahorrar almacenamiento.
 */

import { NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import {
  agruparTurnos,
  normalizarDeepgram,
  type RespuestaDeepgram,
} from "@/lib/formato";
import { VOCABULARIO } from "@/lib/vocabulario";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const audioUrl = url.searchParams.get("audioUrl");

  if (!id) {
    return NextResponse.json({ error: "Falta el parámetro id" }, { status: 400 });
  }

  let body: RespuestaDeepgram & { err_code?: string; err_msg?: string; error?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Si Deepgram devolvio error
  if (body.err_code || body.err_msg || body.error) {
    const errorMsg = body.err_msg || body.error || `Error Deepgram: ${body.err_code}`;
    await put(
      `resultados/${id}.json`,
      JSON.stringify({
        status: "error",
        error: errorMsg,
        detalle: "Deepgram no pudo procesar la grabación.",
      }),
      { access: "public", addRandomSuffix: false },
    ).catch(() => {});

    if (audioUrl) await del(audioUrl).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const intervenciones = agruparTurnos(normalizarDeepgram(body));

  if (intervenciones.length === 0) {
    await put(
      `resultados/${id}.json`,
      JSON.stringify({
        status: "error",
        error: "No se reconoció ninguna voz en el audio.",
        detalle: "Revisa que la grabación tenga sonido y que se escuche a las personas.",
      }),
      { access: "public", addRandomSuffix: false },
    ).catch(() => {});

    if (audioUrl) await del(audioUrl).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // Guardar resultado normalizado en Vercel Blob
  await put(
    `resultados/${id}.json`,
    JSON.stringify({
      status: "completado",
      intervenciones,
      aviso: null,
      meta: {
        servicio: "deepgram",
        modelo: process.env.DEEPGRAM_MODELO?.trim() || "nova-3",
        intervenciones: intervenciones.length,
        terminos_de_vocabulario: VOCABULARIO.length,
      },
    }),
    { access: "public", addRandomSuffix: false },
  ).catch((e) => {
    console.error("Error al guardar resultado en Blob:", e);
  });

  // Borrar el audio original para no gastar cuota de Blob
  if (audioUrl) {
    await del(audioUrl).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
