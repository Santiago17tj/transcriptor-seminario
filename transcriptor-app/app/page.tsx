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
  const [subido, setSubido] = useState(false);
  const [mensaje, setMensaje] = useState(MENSAJES_ESPERA[0]);
  const [error, setError] = useState<{ texto: string; detalle?: string } | null>(
    null,
  );

  const [intervenciones, setIntervenciones] = useState<Intervencion[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [meta, setMeta] = useState<Record<string, string | number>>({});

  const inputArchivoRef = useRef<HTMLInputElement>(null);

  // Mensajes rotativos SOLO mientras se espera a Deepgram.
  //
  // Antes rotaban desde el primer segundo y pisaban el progreso real de la
  // subida: la pantalla decia "Casi listo..." con el archivo al 40%. Con
  // archivos de decenas de megas eso es enganoso y hace parecer que se colgo.
  useEffect(() => {
    if (paso !== "procesando" || !subido) return;
    let i = 0;
    const t = setInterval(() => {
      i = Math.min(i + 1, MENSAJES_ESPERA.length - 1);
      setMensaje(MENSAJES_ESPERA[i]);
    }, 12000);
    return () => clearInterval(t);
  }, [paso, subido]);

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

  /** Le dice al servidor que ya puede borrar el resultado guardado. */
  const liberarResultado = (id: string) => {
    fetch(`/api/estado?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {
        // Si falla, el servidor lo limpiara solo a las 24 horas.
      },
    );
  };

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
    setSubido(false);
    setMensaje("Subiendo el audio…");
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
        // Privado: el almacen del proyecto esta configurado asi, y una
        // grabacion de la sesion no tiene por que ser accesible desde fuera.
        // Deepgram la lee a traves de /api/audio con un enlace firmado.
        access: "private",
        handleUploadUrl: "/api/subir",
        // Sin esto, los 75 MB van en una sola peticion y cualquier bache de red
        // la tumba entera. Por partes se sube en trozos y se puede reintentar.
        multipart: true,
        // El servidor comprueba el codigo ANTES de dar permiso de subida, para
        // que nadie sin codigo pueda llenar el almacenamiento.
        clientPayload: codigo.trim(),
        onUploadProgress: (e) => {
          const pct = Math.round(e.percentage);
          setProgreso(pct);
          setMensaje(
            pct >= 100
              ? "Audio subido. Enviando a Deepgram…"
              : `Subiendo el audio… ${pct}%`,
          );
        },
      });
      blobUrl = blob.url;
      setSubido(true);
    } catch (e) {
      // Si el codigo esta mal, no tiene sentido reintentar por el otro camino:
      // volveria a fallar despues de subir el archivo entero.
      if (e instanceof Error && e.message.includes("Código de acceso")) {
        setError({
          texto: "Código de acceso incorrecto.",
          detalle: "Pídeselo a quien desplegó la aplicación.",
        });
        setPaso("inicio");
        return;
      }
      // En local no hay almacenamiento configurado y el camino directo por
      // FormData es el correcto. En produccion, en cambio, caer ahi significa
      // resubir el archivo entero en silencio: mejor decir que fallo.
      const enProduccion = !location.hostname.startsWith("localhost");
      if (enProduccion) {
        setError({
          texto: "No se pudo subir el audio al almacenamiento.",
          detalle: e instanceof Error ? e.message : String(e),
        });
        setPaso("inicio");
        return;
      }
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
                // El servidor ya no borra el resultado al leerlo: si la
                // respuesta se perdiera en el camino, la transcripcion se
                // perderia con ella. Se borra ahora, que ya esta a salvo.
                liberarResultado(id);
                return;
              }

              if (estado.status === "error" || estado.error) {
                liberarResultado(id);
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

        // El servidor respondio algo que no entendemos. Antes se seguia de
        // largo y se reintentaba subiendo el archivo entero otra vez por el
        // camino viejo, en silencio: la pantalla se quedaba igual, girando,
        // mientras por detras se resubian decenas de megas. Mejor parar aqui.
        setError({
          texto: "El servidor respondió de una forma inesperada.",
          detalle:
            "Respuesta recibida: " + JSON.stringify(cuerpo).slice(0, 300),
        });
        setPaso("inicio");
        return;
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
              "No se pudo usar la subida directa al almacenamiento, así que " +
              "el archivo viajó por una ruta con límite de tamaño. Vuelve a " +
              "intentarlo, o usa el script de escritorio si sigue fallando.",
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
    setSubido(false);
    if (inputArchivoRef.current) inputArchivoRef.current.value = "";
    setPaso("inicio");
  };

  const tomarArchivo = (f: File | null | undefined) => {
    if (!f) return;
    setArchivo(f);
    setError(null);
  };

  const PASOS = ["Audio", "Sesión", "Hablantes", "Listo"];
  const pasoActual =
    paso === "inicio"
      ? 0
      : paso === "procesando"
        ? 1
        : paso === "hablantes"
          ? 2
          : 3;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-slate-50/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 py-3.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center gap-[3px] rounded-xl bg-slate-900 dark:bg-white"
          >
            {[9, 15, 20, 13, 8].map((h, k) => (
              <span
                key={k}
                className="w-[2.5px] rounded-full bg-slate-50 dark:bg-slate-900"
                style={{ height: h }}
              />
            ))}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight">
              Transcriptor del Seminario
            </h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              Hablantes separados, tiempos y decisiones
            </p>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-2xl gap-1.5 px-5 pb-3">
          {PASOS.map((nombre, k) => (
            <div key={nombre} className="flex-1">
              <div
                className={`h-1 rounded-full transition-colors ${
                  k <= pasoActual
                    ? "bg-slate-900 dark:bg-white"
                    : "bg-slate-200 dark:bg-slate-700"
                }`}
              />
              <span
                className={`mt-1.5 block text-[11px] transition-colors ${
                  k === pasoActual
                    ? "font-medium text-slate-900 dark:text-white"
                    : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {nombre}
              </span>
            </div>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-6">
        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <div className="flex gap-3 p-4">
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white"
              >
                !
              </span>
              <div className="min-w-0">
                <p className="font-medium text-red-900 dark:text-red-200">
                  {error.texto}
                </p>
                {error.detalle && (
                  <p className="mt-1 break-words text-sm text-red-800/90 dark:text-red-300">
                    {error.detalle}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {paso === "inicio" && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800/50">
              <h2 className="text-base font-semibold">La grabación</h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Sube el archivo de la sesión, o graba si es algo corto.
              </p>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  tomarArchivo(e.dataTransfer.files?.[0]);
                }}
                className="mt-4"
              >
                <button
                  type="button"
                  onClick={() => inputArchivoRef.current?.click()}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-5 py-8 text-center transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.995] dark:border-slate-600 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                >
                  <span aria-hidden className="text-2xl leading-none text-slate-400">
                    &#8593;
                  </span>
                  <span className="text-base font-semibold">
                    Subir una grabación
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    m4a, mp3, wav, ogg &mdash; hasta 100 MB
                  </span>
                </button>
              </div>

              <input
                ref={inputArchivoRef}
                type="file"
                accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.opus,.aac,.webm,.mpeg,.mpg,.mp4,.flac,.wma"
                className="hidden"
                onChange={(e) => tomarArchivo(e.target.files?.[0])}
              />

              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  o
                </span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              </div>

              <Grabadora onGrabacionLista={(f) => tomarArchivo(f)} />

              {archivo && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-950/40">
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white"
                  >
                    &#10003;
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-emerald-900 dark:text-emerald-200">
                      {archivo.name}
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {pesoLegible(archivo.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setArchivo(null);
                      if (inputArchivoRef.current)
                        inputArchivoRef.current.value = "";
                    }}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                  >
                    Quitar
                  </button>
                </div>
              )}

              <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Para las sesiones de dos horas conviene grabar con la grabadora
                del celular y subir el archivo: es más seguro que grabar aquí.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800/50">
              <h2 className="text-base font-semibold">Datos de la sesión</h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Solo se usan para el título del documento.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="numero"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Número
                  </label>
                  <input
                    id="numero"
                    type="text"
                    inputMode="numeric"
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="10"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
                  />
                </div>
                <div>
                  <label
                    htmlFor="fecha"
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    Fecha
                  </label>
                  <input
                    id="fecha"
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label
                  htmlFor="codigo"
                  className="block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Código de acceso
                </label>
                <input
                  id="codigo"
                  type="password"
                  value={codigo}
                  onChange={(e) => setCodigoEditado(e.target.value)}
                  placeholder="El que compartió el grupo"
                  autoComplete="off"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
                />
              </div>
            </section>

            <button
              type="button"
              onClick={transcribir}
              disabled={!archivo}
              className="w-full rounded-2xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
            >
              Transcribir
            </button>
          </div>
        )}

        {paso === "procesando" && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-800/50">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900 dark:border-slate-700 dark:border-t-white" />
            <p className="mt-5 text-base font-medium">{mensaje}</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">
              {subido
                ? "Una sesión de dos horas tarda entre uno y tres minutos. No cierres esta pantalla."
                : "Subir una grabación grande puede tardar varios minutos según tu conexión. No cierres esta pantalla."}
            </p>

            {!subido && (
              <div className="mx-auto mt-6 w-full max-w-xs">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-slate-900 transition-all duration-300 dark:bg-white"
                    style={{ width: `${progreso}%` }}
                  />
                </div>
                <p className="mt-2 text-xs tabular-nums text-slate-500">
                  {progreso}% subido
                </p>
              </div>
            )}
          </div>
        )}

        {paso === "hablantes" && (
          <>
            {aviso && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
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
    </div>
  );
}
