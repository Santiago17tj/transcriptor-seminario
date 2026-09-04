/**
 * Ventana de diagnostico para saber que se le pidio a Deepgram.
 *
 * Cuando Deepgram no consigue descargar el audio, no llama al webhook ni avisa
 * de nada: la app se queda esperando en silencio y desde fuera es imposible
 * saber por que. Cada peticion deja aqui una anotacion de lo que se envio y de
 * lo que Deepgram contesto, para poder leerlo despues.
 *
 * Requiere firma, calculada con la clave de Deepgram como secreto, asi que solo
 * lo puede consultar quien ya conoce esa clave.
 */

import { NextResponse } from "next/server";
import { list, get, del } from "@vercel/blob";
import { firmaValida, firmarDescarga } from "@/lib/seguridad";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const clave = process.env.DEEPGRAM_API_KEY?.trim();
  if (!clave) {
    return NextResponse.json({ error: "Servidor sin configurar" }, { status: 500 });
  }
  if (!firmaValida(firmarDescarga(clave, "diagnostico"), params.get("firma"))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { blobs } = await list({ prefix: "diagnostico/", limit: 20 });
  blobs.sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );

  const anotaciones = [];
  for (const b of blobs.slice(0, 8)) {
    try {
      const c = await get(b.pathname, { access: "private", useCache: false });
      if (c && c.statusCode === 200) {
        anotaciones.push(JSON.parse(await new Response(c.stream).text()));
      }
    } catch (e) {
      anotaciones.push({
        pathname: b.pathname,
        errorAlLeer: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ total: blobs.length, anotaciones });
}

/** Borra las anotaciones acumuladas. */
export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const clave = process.env.DEEPGRAM_API_KEY?.trim();
  if (!clave) {
    return NextResponse.json({ error: "Servidor sin configurar" }, { status: 500 });
  }
  if (!firmaValida(firmarDescarga(clave, "diagnostico"), params.get("firma"))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { blobs } = await list({ prefix: "diagnostico/", limit: 200 });
  if (blobs.length > 0) await del(blobs.map((b) => b.url));
  return NextResponse.json({ borradas: blobs.length });
}
