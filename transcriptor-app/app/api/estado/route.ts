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
import { list, del, get } from "@vercel/blob";
import { esUuid } from "@/lib/seguridad";

export const runtime = "nodejs";

/**
 * Busca el resultado de UNA transcripcion.
 *
 * Lo que hace segura esta busqueda es que el id ya se validó como UUID: 'list'
 * busca por prefijo, y sin esa validacion un id de una sola letra devolvia la
 * transcripcion de otra persona. Con un UUID completo por delante, el prefijo
 * no puede alcanzar el resultado de nadie mas.
 *
 * Se busca por el id y no por el nombre exacto del archivo a proposito: el
 * almacenamiento puede devolver la ruta con alguna variacion, y una comparacion
 * estricta dejaria al navegador sondeando para siempre.
 */
async function buscarResultado(id: string) {
  const { blobs } = await list({ prefix: `resultados/${id}`, limit: 10 });
  return blobs[0] ?? null;
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

    // Se lee con el SDK y no con un fetch a la URL: el resultado es privado,
    // asi que solo se puede recuperar con el token del servidor.
    const contenido = await get(blob.pathname, {
      access: "private",
      useCache: false,
    });
    if (!contenido || contenido.statusCode !== 200) {
      return NextResponse.json({ status: "procesando" });
    }

    const texto = await new Response(contenido.stream).text();
    return NextResponse.json(JSON.parse(texto));
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
