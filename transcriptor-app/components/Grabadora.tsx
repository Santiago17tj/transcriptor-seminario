"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Grabacion desde el navegador del celular.
 *
 * Advertencia honesta: para una sesion de dos horas es mas seguro grabar con la
 * grabadora de voz que ya trae el telefono y subir el archivo. Si Android
 * suspende la pestana del navegador (pantalla bloqueada, poca memoria), una
 * grabacion larga hecha aqui se puede perder.
 */

type Props = {
  onGrabacionLista: (archivo: File) => void;
  deshabilitado?: boolean;
};

function reloj(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  const dos = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

export default function Grabadora({ onGrabacionLista, deshabilitado }: Props) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const grabadorRef = useRef<MediaRecorder | null>(null);
  const trozosRef = useRef<Blob[]>([]);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Si el usuario cierra la pagina en plena grabacion, suelto el microfono.
  useEffect(() => {
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
      grabadorRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const empezar = async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "Este navegador no permite grabar. Usa el botón de subir un archivo ya grabado.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const grabador = new MediaRecorder(stream);
      trozosRef.current = [];

      grabador.ondataavailable = (e) => {
        if (e.data.size > 0) trozosRef.current.push(e.data);
      };
      grabador.onstop = () => {
        const tipo = grabador.mimeType || "audio/webm";
        const blob = new Blob(trozosRef.current, { type: tipo });
        const extension = tipo.includes("mp4") ? "m4a" : "webm";
        stream.getTracks().forEach((t) => t.stop());
        if (blob.size > 0) {
          onGrabacionLista(
            new File([blob], `grabacion.${extension}`, { type: tipo }),
          );
        }
      };

      grabador.start(1000); // un trozo por segundo, para no perderlo todo
      grabadorRef.current = grabador;
      setGrabando(true);
      setSegundos(0);
      intervaloRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch {
      setError(
        "No se pudo acceder al micrófono. Revisa que le hayas dado permiso al navegador.",
      );
    }
  };

  const detener = () => {
    if (intervaloRef.current) clearInterval(intervaloRef.current);
    intervaloRef.current = null;
    grabadorRef.current?.stop();
    grabadorRef.current = null;
    setGrabando(false);
  };

  return (
    <div className="space-y-3">
      {!grabando ? (
        <button
          type="button"
          onClick={empezar}
          disabled={deshabilitado}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-300 bg-white px-5 py-5 text-lg font-semibold text-slate-800 transition active:scale-[0.99] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          <span
            aria-hidden
            className="inline-block h-4 w-4 rounded-full bg-red-500"
          />
          Grabar ahora
        </button>
      ) : (
        <button
          type="button"
          onClick={detener}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-5 py-5 text-lg font-semibold text-white transition active:scale-[0.99]"
        >
          <span
            aria-hidden
            className="inline-block h-4 w-4 animate-pulse rounded-sm bg-white"
          />
          Detener · {reloj(segundos)}
        </button>
      )}

      {grabando && (
        <p className="text-center text-sm text-amber-700 dark:text-amber-500">
          No bloquees la pantalla ni cambies de aplicación mientras grabas.
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
