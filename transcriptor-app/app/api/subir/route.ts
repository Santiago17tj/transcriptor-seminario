/**
 * Endpoint para subir archivos a Vercel Blob desde el navegador.
 *
 * Usa la subida en modo "client" de @vercel/blob: el navegador sube
 * directamente al blob storage, sin que los bytes pasen por esta funcion.
 * Asi se evita el limite de 4.5 MB de las Serverless Functions de Vercel.
 *
 * Flujo:
 *   1. El navegador pide un token de subida a este endpoint, mandando el
 *      codigo de acceso en el clientPayload.
 *   2. Este endpoint comprueba el codigo y genera un token temporal.
 *   3. El navegador sube el archivo directo a Vercel Blob usando ese token.
 *   4. Vercel Blob devuelve la URL publica del archivo.
 *   5. El navegador envia esa URL a /api/transcribir.
 *
 * El codigo se valida AQUI y no solo en /api/transcribir: para cuando se
 * transcribe, el archivo ya esta subido. Sin esta comprobacion cualquiera que
 * conozca la direccion podria llenar el almacenamiento con archivos de 100 MB.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { CODIGO_INCORRECTO, codigoCorrecto } from "@/lib/seguridad";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const respuesta = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        if (!codigoCorrecto(String(clientPayload ?? ""))) {
          throw new Error(CODIGO_INCORRECTO);
        }
        return {
          allowedContentTypes: [
            "audio/webm",
            "audio/mp4",
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
            "audio/x-wav",
            "audio/aac",
            "audio/x-m4a",
            "audio/mp3",
            "audio/flac",
            "audio/x-flac",
            "video/mp4",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
          tokenPayload: JSON.stringify({ origen: "transcriptor" }),
        };
      },
      onUploadCompleted: async () => {
        // No hace falta nada al completar: el navegador envia la URL a
        // /api/transcribir por su cuenta.
      },
    });

    return NextResponse.json(respuesta);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : "Error al subir el archivo.";
    return NextResponse.json(
      { error: mensaje },
      { status: mensaje === CODIGO_INCORRECTO ? 401 : 400 },
    );
  }
}
