/**
 * Endpoint para subir archivos a Vercel Blob desde el navegador.
 *
 * Usa la subida en modo "client" de @vercel/blob: el navegador sube
 * directamente al blob storage, sin que los bytes pasen por esta funcion.
 * Asi se evita el limite de 4.5 MB de las Serverless Functions de Vercel.
 *
 * Flujo:
 *   1. El navegador pide un token de subida a este endpoint.
 *   2. Este endpoint genera un token temporal con handleUpload.
 *   3. El navegador sube el archivo directo a Vercel Blob usando ese token.
 *   4. Vercel Blob devuelve la URL publica del archivo.
 *   5. El navegador envia esa URL a /api/transcribir.
 */

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const respuesta = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Aqui se podria validar el codigo de acceso si se quisiera.
        // Por ahora lo validamos en /api/transcribir.
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
            "application/octet-stream",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
          tokenPayload: JSON.stringify({ origen: "transcriptor" }),
        };
      },
      onUploadCompleted: async () => {
        // No necesitamos hacer nada al completar: el navegador se encarga
        // de enviar la URL al endpoint de transcripcion.
      },
    });

    return NextResponse.json(respuesta);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al subir el archivo." },
      { status: 400 },
    );
  }
}
