/**
 * Puente de descarga para que Deepgram pueda leer un audio privado.
 *
 * El almacenamiento del proyecto es privado, asi que la URL de Vercel Blob no
 * se puede abrir desde fuera. Deepgram, que es un servicio externo, hace un GET
 * normal sin credenciales: recibiria un rechazo y —esto es lo peor— no avisa,
 * simplemente nunca llama al webhook y la app se queda esperando para siempre.
 *
 * Este endpoint entrega el archivo a quien traiga una firma valida. La firma se
 * calcula con la clave de Deepgram como secreto, igual que la del webhook, asi
 * que no hace falta configurar nada nuevo y el enlace no se puede fabricar
 * desde fuera. El audio nunca se hace publico.
 */

import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { firmaValida, firmarDescarga } from "@/lib/seguridad";

export const runtime = "nodejs";
export const maxDuration = 300; // descargar 80 MB puede tardar

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const archivo = params.get("archivo");

  if (!archivo) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }

  const clave = process.env.DEEPGRAM_API_KEY?.trim();
  if (!clave) {
    return NextResponse.json({ error: "Servidor sin configurar" }, { status: 500 });
  }

  if (!firmaValida(firmarDescarga(clave, archivo), params.get("firma"))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // El almacen puede ser privado o publico segun como se haya creado; se
  // intentan los dos para no depender de esa configuracion.
  let contenido = null;
  for (const access of ["private", "public"] as const) {
    try {
      contenido = await get(archivo, { access, useCache: false });
      if (contenido) break;
    } catch {
      // se intenta con el otro modo de acceso
    }
  }

  if (!contenido || contenido.statusCode !== 200) {
    return NextResponse.json(
      { error: "No se encontró el audio" },
      { status: 404 },
    );
  }

  // Se devuelve el flujo tal cual, sin acumularlo en memoria: son decenas de
  // megabytes y la funcion no tiene por que cargarlos enteros.
  return new Response(contenido.stream, {
    headers: {
      "Content-Type": contenido.blob.contentType || "application/octet-stream",
      "Content-Length": String(contenido.blob.size),
      "Cache-Control": "no-store",
    },
  });
}
