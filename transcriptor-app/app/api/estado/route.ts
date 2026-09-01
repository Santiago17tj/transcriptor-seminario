/**
 * Endpoint de consulta (polling) para el estado de una transcripcion asincrona.
 *
 * El frontend consulta cada 3 segundos:
 *   - Si Deepgram sigue procesando: devuelve { status: "procesando" }.
 *   - Si Deepgram ya termino: lee el JSON de Vercel Blob, lo devuelve y borra el blob temporal.
 */

import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Falta el parámetro id" }, { status: 400 });
  }

  try {
    const { blobs } = await list({ prefix: `resultados/${id}` });

    if (blobs.length === 0) {
      return NextResponse.json({ status: "procesando" });
    }

    const blob = blobs[0];
    const res = await fetch(blob.url);
    const data = await res.json();

    // Borramos el blob temporal del resultado
    await del(blob.url).catch(() => {});

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: "Error al consultar estado", detalle: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
