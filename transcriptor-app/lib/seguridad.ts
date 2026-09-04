/**
 * Utilidades de seguridad para los endpoints del servidor.
 *
 * Solo se importa desde rutas de API: usa 'node:crypto' y no debe llegar nunca
 * al navegador.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Nombre de archivo que usa el callback para dejar el resultado. */
export function rutaResultado(id: string): string {
  return `resultados/${id}.json`;
}

/**
 * Comprueba que el id sea un UUID.
 *
 * Es importante para /api/estado: sin esto, un id de una sola letra hace que la
 * busqueda por prefijo devuelva la transcripcion de otra persona.
 */
export function esUuid(valor: string | null): valor is string {
  if (!valor) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    valor,
  );
}

/** Solo se borran URLs que de verdad apunten al almacenamiento de Vercel Blob. */
export function esUrlDeBlob(valor: string | null): valor is string {
  if (!valor) return false;
  try {
    const u = new URL(valor);
    return (
      u.protocol === "https:" &&
      u.hostname.endsWith(".public.blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

/**
 * Host publico al que Deepgram debe enviar el webhook.
 *
 * La cabecera 'x-forwarded-host' llega desde fuera, asi que solo se acepta si
 * apunta a un dominio propio. Si no, se cae a la URL del despliegue. Sin esta
 * comprobacion, una peticion con una cabecera manipulada podria hacer que el
 * resultado de la transcripcion se entregue en un servidor ajeno.
 */
export function hostPublico(request: Request): string {
  const candidatos = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
  ];
  const propio = process.env.DOMINIO_PUBLICO?.trim().toLowerCase();

  for (const bruto of candidatos) {
    const host = bruto?.trim().toLowerCase();
    if (!host || !/^[a-z0-9.:-]+$/.test(host)) continue;
    const sinPuerto = host.split(":")[0];
    if (
      sinPuerto === "localhost" ||
      sinPuerto === "127.0.0.1" ||
      sinPuerto.endsWith(".vercel.app") ||
      (propio && (sinPuerto === propio || sinPuerto.endsWith("." + propio)))
    ) {
      return host;
    }
  }

  return process.env.VERCEL_URL?.trim() ?? "";
}

export function esHostLocal(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

/**
 * Firma del webhook.
 *
 * Deepgram no firma sus callbacks, asi que la firma va en la propia URL: se
 * calcula con la clave de Deepgram como secreto, de modo que no hace falta
 * configurar ninguna variable de entorno nueva. Sin esto, cualquiera podria
 * llamar a /api/callback y escribir resultados falsos o pedir el borrado de
 * archivos que no le pertenecen.
 */
export function firmarCallback(
  secreto: string,
  id: string,
  audioUrl: string,
  sinVocabulario: boolean,
): string {
  return createHmac("sha256", secreto)
    .update(`${id}|${audioUrl}|${sinVocabulario ? "1" : "0"}`)
    .digest("hex")
    .slice(0, 32);
}

/** Comparacion en tiempo constante, para no filtrar la firma a base de intentos. */
export function firmaValida(esperada: string, recibida: string | null): boolean {
  if (!recibida || recibida.length !== esperada.length) return false;
  return timingSafeEqual(Buffer.from(esperada), Buffer.from(recibida));
}

/** Mensaje exacto que el navegador reconoce para no reintentar por otro camino. */
export const CODIGO_INCORRECTO = "Código de acceso incorrecto.";

/** Compara el codigo de acceso, si el despliegue configuro uno. */
export function codigoCorrecto(recibido: string): boolean {
  const esperado = process.env.CODIGO_ACCESO?.trim();
  if (!esperado) return true; // sin codigo configurado, la app queda abierta
  return recibido.trim() === esperado;
}
