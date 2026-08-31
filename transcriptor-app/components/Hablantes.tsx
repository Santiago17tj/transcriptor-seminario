"use client";

/**
 * Paso de identificacion de hablantes.
 *
 * Deepgram solo entrega etiquetas genericas (Hablante A, Hablante B). Aqui se le
 * muestran al usuario las primeras frases de cada voz para que reconozca quien es
 * y le ponga el nombre real.
 */

import { mmss, muestrasDe, type Intervencion } from "@/lib/formato";

type Props = {
  intervenciones: Intervencion[];
  orden: string[];
  nombres: Record<string, string>;
  onCambio: (id: string, nombre: string) => void;
  onListo: () => void;
  onVolver: () => void;
};

export default function Hablantes({
  intervenciones,
  orden,
  nombres,
  onCambio,
  onListo,
  onVolver,
}: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">¿Quién es cada quién?</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Se detectaron {orden.length}{" "}
          {orden.length === 1 ? "voz" : "voces"}. Lee lo que dijo cada una y
          escribe el nombre. Si no reconoces alguna, déjala en blanco.
        </p>
      </div>

      {orden.map((id) => {
        const muestras = muestrasDe(intervenciones, id);
        return (
          <div
            key={id}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="mb-3 space-y-2">
              {muestras.map((m, k) => (
                <p
                  key={k}
                  className="text-sm leading-relaxed text-slate-700 dark:text-slate-300"
                >
                  <span className="mr-2 font-mono text-xs text-slate-400">
                    [{mmss(m.inicio)}]
                  </span>
                  &ldquo;
                  {m.texto.length > 180 ? m.texto.slice(0, 180) + "…" : m.texto}
                  &rdquo;
                </p>
              ))}
            </div>
            <label
              className="block text-sm font-medium"
              htmlFor={`hablante-${id}`}
            >
              Hablante {id} es:
            </label>
            <input
              id={`hablante-${id}`}
              type="text"
              value={nombres[id] ?? ""}
              onChange={(e) => onCambio(id, e.target.value)}
              placeholder="Ej: Ferney (director)"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
            />
          </div>
        );
      })}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-2xl border border-slate-300 px-5 py-4 font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={onListo}
          className="flex-1 rounded-2xl bg-slate-900 px-5 py-4 text-lg font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          Generar documento
        </button>
      </div>
    </div>
  );
}
