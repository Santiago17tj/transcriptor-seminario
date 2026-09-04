/**
 * Endpoint de consulta (polling) para el estado de una transcripcion asincrona.
 *
 * El frontend consulta cada 3 segundos:
 *   - Si Deepgram sigue procesando: devuelve { status: "procesando" }.
 *   - Si Deepgram ya termino: lee el JSON de Vercel Blob y lo devuelve.
 *
 * El resultado NO se borra al leerlo. Si la respuesta se perdiera en el camino
 * (algo normal en datos moviles), la transcripcion quedaria destruida y habria
 * que volver a pagarla. Lo borra el navegador con DELETE cuando ya lo tiene
 * guardado, y el callback limpia lo que haya quedado huerfano.
 */

import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { esUuid, rutaResultado } from "@/lib/seguridad";

export const runtime = "nodejs";

/**
 * Busca el resultado de UNA transcripcion.
 *
 * Se compara el nombre completo y no el prefijo: 'list' hace busqueda por
 * prefijo, asi que con un id de una sola letra devolveria la transcripcion de
 * otra persona.
 */
async function buscarResultado(id: string) {
  const ruta = rutaResultado(id);
  const { blobs } = await list({ prefix: ruta, limit: 10 });
  return blobs.find((b) => b.pathname === ruta) ?? null;
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!esUuid(id)) {
    return NextResponse.json(
      { error: "Identificador de transcripción inválido." },
      { status: 400 },
    );
  }

  try {
    const blob = await buscarResultado(id);
    if (!blob) {
      return NextResponse.json({ status: "procesando" });
    }

    const res = await fetch(blob.url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ status: "procesando" });
    }

    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json(
      {
        error: "Error al consultar el estado.",
        detalle: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

/** El navegador llama aqui cuando ya tiene el resultado en pantalla. */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");

  if (!esUuid(id)) {
    return NextResponse.json(
      { error: "Identificador de transcripción inválido." },
      { status: 400 },
    );
  }

  try {
    const blob = await buscarResultado(id);
    if (blob) await del(blob.url);
  } catch {
    // Si no se pudo borrar, el callback lo recogera mas adelante.
  }

  return NextResponse.json({ ok: true });
}
