"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Grabadora from "@/components/Grabadora";
import Hablantes from "@/components/Hablantes";
import Resultado from "@/components/Resultado";
import {
  construirMarkdown,
  hablantesEnOrden,
  type Intervencion,
} from "@/lib/formato";

type Paso = "inicio" | "procesando" | "hablantes" | "resultado";

const MENSAJES_ESPERA = [
  "Subiendo el audio…",
  "Deepgram está escuchando la grabación…",
  "Separando las voces…",
  "Reconociendo el vocabulario del proyecto…",
  "Casi listo…",
];

function hoy(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function pesoLegible(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1 ? `${Math.round(bytes / 1024)} KB` : `${mb.toFixed(1)} MB`;
}

/**
 * Lee el codigo de acceso recordado en el celular.
 *
 * Se hace con useSyncExternalStore y no dentro de un efecto porque en el
 * servidor no existe localStorage: asi React sabe que durante el renderizado
 * del servidor el valor es vacio y no hay discrepancia al hidratar.
 */
const almacen = {
  suscribir: () => () => {},
  leer: () => {
    try {
      return localStorage.getItem("codigo-acceso") ?? "";
    } catch {
      return ""; // modo incognito o almacenamiento bloqueado
    }
  },
  leerEnServidor: () => "",
};

export default function Pagina() {
  const [paso, setPaso] = useState<Paso>("inicio");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoy());

  const codigoRecordado = useSyncExternalStore(
    almacen.suscribir,
    almacen.leer,
    almacen.leerEnServidor,
  );
  const [codigoEditado, setCodigoEditado] = useState<string | null>(null);
  const codigo = codigoEditado ?? codigoRecordado;

  const [progreso, setProgreso] = useState(0);
  const [mensaje, setMensaje] = useState(MENSAJES_ESPERA[0]);
  const [error, setError] = useState<{ texto: string; detalle?: string } | null>(
    null,
  );

  const [intervenciones, setIntervenciones] = useState<Intervencion[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, string | number>>({});

  const inputArchivoRef = useRef<HTMLInputElement>(null);

  // Mensajes rotativos mientras se espera, para que no parezca colgado.
  useEffect(() => {
    if (paso !== "procesando") return;
    let i = 0;
    const t = setInterval(() => {
      i = Math.min(i + 1, MENSAJES_ESPERA.length - 1);
      setMensaje(MENSAJES_ESPERA[i]);
    }, 12000);
    return () => clearInterval(t);
  }, [paso]);

  const orden = useMemo(() => hablantesEnOrden(intervenciones), [intervenciones]);

  const markdown = useMemo(() => {
    if (intervenciones.length === 0) return "";
    return construirMarkdown({
      intervenciones,
      nombres,
      numero: numero.trim() || "?",
      fecha,
      meta,
    });
  }, [intervenciones, nombres, numero, fecha, meta]);

  /**
   * Envia la transcripcion al servidor.
   *
   * Intenta dos caminos:
   *   1. Subir el audio a Vercel Blob y enviar solo la URL (evita el limite
   *      de 4.5 MB de las funciones serverless de Vercel).
   *   2. Si Blob no esta configurado, envia el archivo directamente por
   *      FormData (funciona siempre en local).
   */
  const transcribir = async () => {
    if (!archivo) return;
    setError(null);
    setProgreso(0);
    setMensaje(MENSAJES_ESPERA[0]);
    setPaso("procesando");

    try {
      if (codigo.trim()) localStorage.setItem("codigo-acceso", codigo.trim());
    } catch {
      // sin almacenamiento: seguimos igual
    }

    // --- Intento 1: subir via Vercel Blob ---
    let blobUrl: string | null = null;
    try {
      setMensaje("Subiendo el audio…");
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(archivo.name, archivo, {
        access: "public",
        handleUploadUrl: "/api/subir",
        onUploadProgress: (e) => {
          const pct = Math.round(e.percentage);
          setProgreso(pct);
          if (pct >= 100) setMensaje("Audio subido. Transcribiendo…");
        },
      });
      blobUrl = blob.url;
    } catch {
      // Blob no esta configurado (falta BLOB_READ_WRITE_TOKEN) o fallo la
      // subida. Caemos al metodo directo mas abajo.
    }

    // Si el Blob se subio bien, enviar solo la URL al servidor.
    if (blobUrl) {
      try {
        setMensaje("Deepgram está escuchando la grabación…");
        const res = await fetch("/api/transcribir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: blobUrl, codigo: codigo.trim() }),
          signal: AbortSignal.timeout(15 * 60 * 1000),
        });

        let cuerpo: {
          status?: "procesando" | "completado" | "error";
          id?: string;
          intervenciones?: Intervencion[];
          aviso?: string | null;
          meta?: Record<string, string | number>;
          error?: string;
          detalle?: string;
        };
        try {
          cuerpo = await res.json();
        } catch {
          // Vercel devolvio HTML (ej: 504 timeout) en vez de JSON.
          setError({
            texto:
              res.status === 504
                ? "La transcripción tardó demasiado y Vercel la cortó."
                : `El servidor respondió con error ${res.status}.`,
            detalle:
              res.status === 504
                ? "El audio es muy largo para el plan actual de Vercel. " +
                  "Prueba con un audio más corto o usa el script de escritorio."
                : "Revisa los logs en el panel de Vercel para más detalles.",
          });
          setPaso("inicio");
          return;
        }

        if (res.status !== 200 || cuerpo.error) {
          setError({
            texto: cuerpo.error ?? "No se pudo transcribir el audio.",
            detalle: cuerpo.detalle,
          });
          setPaso("inicio");
          return;
        }

        // Si el backend inicio procesamiento asincrono con Deepgram callback:
        if (cuerpo.status === "procesando" && cuerpo.id) {
          const id = cuerpo.id;
          const inicioPoll = Date.now();
          const MAX_TIEMPO_MS = 15 * 60 * 1000; // 15 minutos maximo

          while (Date.now() - inicioPoll < MAX_TIEMPO_MS) {
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const resEstado = await fetch(`/api/estado?id=${id}`);
              if (!resEstado.ok) continue;
              const estado = await resEstado.json();

              if (estado.status === "completado" && estado.intervenciones) {
                setIntervenciones(estado.intervenciones);
                setAviso(estado.aviso ?? null);
                setMeta(estado.meta ?? {});
                setNombres({});
                setPaso("hablantes");
                return;
              }

              if (estado.status === "error" || estado.error) {
                setError({
                  texto: estado.error ?? "No se pudo transcribir el audio.",
                  detalle: estado.detalle,
                });
                setPaso("inicio");
                return;
              }
            } catch {
              // error de red puntual al consultar estado, seguimos esperando
            }
          }

          setError({
            texto: "La transcripción tardó más de 15 minutos y se canceló.",
            detalle: "Intenta nuevamente o usa el script de escritorio.",
          });
          setPaso("inicio");
          return;
        }

        // Modo Sincrono (Local)
        if (cuerpo.intervenciones) {
          setIntervenciones(cuerpo.intervenciones);
          setAviso(cuerpo.aviso ?? null);
          setMeta(cuerpo.meta ?? {});
          setNombres({});
          setPaso("hablantes");
          return;
        }
      } catch (e) {
        const msg =
          e instanceof Error && e.name === "TimeoutError"
            ? "La transcripción tardó demasiado y se canceló."
            : "Se perdió la conexión mientras se transcribía.";
        setError({
          texto: msg,
          detalle: "Revisa la conexión a internet e inténtalo de nuevo.",
        });
        setPaso("inicio");
        return;
      }
    }

    // --- Intento 2: enviar directo por FormData (modo local) ---
    const datos = new FormData();
    datos.append("audio", archivo);
    datos.append("codigo", codigo.trim());

    // XMLHttpRequest en vez de fetch para poder mostrar el avance de la subida.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/transcribir");
    xhr.timeout = 15 * 60 * 1000;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setProgreso(pct);
        if (pct >= 100) setMensaje("Audio subido. Transcribiendo…");
      }
    };

    xhr.onload = () => {
      let cuerpo: {
        intervenciones?: Intervencion[];
        aviso?: string | null;
        meta?: Record<string, string | number>;
        error?: string;
        detalle?: string;
      };
      try {
        cuerpo = JSON.parse(xhr.responseText);
      } catch {
        if (xhr.status === 413) {
          setError({
            texto: "El audio es demasiado grande para el servidor.",
            detalle:
              "El plan gratuito de Vercel acepta hasta ~4.5 MB. " +
              "Comprime el audio, pártelo en fragmentos más cortos, " +
              "o usa el script de escritorio que no tiene ese límite.",
          });
        } else {
          setError({
            texto: "El servidor respondió algo que no se pudo leer.",
            detalle: `Código ${xhr.status}.`,
          });
        }
        setPaso("inicio");
        return;
      }

      if (xhr.status !== 200 || !cuerpo.intervenciones) {
        setError({
          texto: cuerpo.error ?? "No se pudo transcribir el audio.",
          detalle: cuerpo.detalle,
        });
        setPaso("inicio");
        return;
      }

      setIntervenciones(cuerpo.intervenciones);
      setAviso(cuerpo.aviso ?? null);
      setMeta(cuerpo.meta ?? {});
      setNombres({});
      setPaso("hablantes");
    };

    const manejarFallo = (texto: string) => {
      setError({
        texto,
        detalle: "Revisa la conexión a internet e inténtalo de nuevo.",
      });
      setPaso("inicio");
    };

    xhr.onerror = () =>
      manejarFallo("Se perdió la conexión mientras se enviaba el audio.");
    xhr.ontimeout = () =>
      manejarFallo("La transcripción tardó demasiado y se canceló.");

    xhr.send(datos);
  };

  const reiniciar = () => {
    setArchivo(null);
    setIntervenciones([]);
    setNombres({});
    setAviso(null);
    setError(null);
    setProgreso(0);
    if (inputArchivoRef.current) inputArchivoRef.current.value = "";
    setPaso("inicio");
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-8 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Transcriptor del Seminario
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Convierte la grabación de la sesión en un documento listo para pasarle
          a Claude.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
          <p className="font-semibold text-red-900 dark:text-red-200">
            {error.texto}
          </p>
          {error.detalle && (
            <p className="mt-1 text-sm text-red-800 dark:text-red-300">
              {error.detalle}
            </p>
          )}
        </div>
      )}

      {paso === "inicio" && (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">1. El audio de la sesión</h2>

            <button
              type="button"
              onClick={() => inputArchivoRef.current?.click()}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-900 px-5 py-5 text-lg font-semibold text-white transition active:scale-[0.99] dark:bg-white dark:text-slate-900"
            >
              Subir una grabación
            </button>
            <input
              ref={inputArchivoRef}
              type="file"
              accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mpeg,.mpg,.mp4,.flac,.wma"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setArchivo(f);
                  setError(null);
                }
              }}
            />

            <p className="text-center text-sm text-slate-500">o</p>

            <Grabadora
              onGrabacionLista={(f) => {
                setArchivo(f);
                setError(null);
              }}
            />

            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Para las sesiones de dos horas conviene grabar con la grabadora de
              voz del celular y subir el archivo: es más seguro que grabar aquí.
              Máximo 95 MB.
            </p>

            {archivo && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-700 dark:bg-emerald-950/40">
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                  Audio listo: {archivo.name}
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                  {pesoLegible(archivo.size)}
                </p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">2. Datos de la sesión</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="numero" className="block text-sm font-medium">
                  Número
                </label>
                <input
                  id="numero"
                  type="text"
                  inputMode="numeric"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="10"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
                />
              </div>
              <div>
                <label htmlFor="fecha" className="block text-sm font-medium">
                  Fecha
                </label>
                <input
                  id="fecha"
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
                />
              </div>
            </div>
            <div>
              <label htmlFor="codigo" className="block text-sm font-medium">
                Código de acceso
              </label>
              <input
                id="codigo"
                type="password"
                value={codigo}
                onChange={(e) => setCodigoEditado(e.target.value)}
                placeholder="Solo si el grupo le puso uno"
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
              />
            </div>
          </section>

          <button
            type="button"
            onClick={transcribir}
            disabled={!archivo}
            className="w-full rounded-2xl bg-emerald-600 px-5 py-5 text-lg font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            Transcribir
          </button>
        </div>
      )}

      {paso === "procesando" && (
        <div className="space-y-6 py-10 text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
          <div>
            <p className="text-lg font-medium">{mensaje}</p>
            <p className="mt-1 text-sm text-slate-500">
              Una sesión de dos horas tarda entre uno y tres minutos. No cierres
              esta pantalla.
            </p>
          </div>
          {progreso > 0 && progreso < 100 && (
            <div className="mx-auto w-full max-w-xs">
              <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all dark:bg-white"
                  style={{ width: `${progreso}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">{progreso}% subido</p>
            </div>
          )}
        </div>
      )}

      {paso === "hablantes" && (
        <>
          {aviso && (
            <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              {aviso}
            </div>
          )}
          <Hablantes
            intervenciones={intervenciones}
            orden={orden}
            nombres={nombres}
            onCambio={(id, nombre) =>
              setNombres((prev) => ({ ...prev, [id]: nombre }))
            }
            onListo={() => setPaso("resultado")}
            onVolver={reiniciar}
          />
        </>
      )}

      {paso === "resultado" && (
        <Resultado
          markdown={markdown}
          intervenciones={intervenciones}
          nombres={nombres}
          numero={numero.trim() || "?"}
          onVolver={() => setPaso("hablantes")}
          onNueva={reiniciar}
        />
      )}
    </main>
  );
}
