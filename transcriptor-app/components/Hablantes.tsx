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
  const sinNombre = orden.filter((id) => !(nombres[id] ?? "").trim()).length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">¿Quién es cada quién?</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Se {orden.length === 1 ? "detectó" : "detectaron"} {orden.length}{" "}
          {orden.length === 1 ? "voz" : "voces"}. Lee lo que dijo cada una y
          escribe el nombre.
        </p>
      </div>

      {orden.length === 1 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Solo se reconoció una voz en toda la grabación, así que no hubo
          separación de hablantes. Suele pasar cuando el micrófono queda lejos o
          todos se oyen a un volumen parecido. Para la próxima sesión ayuda poner
          el teléfono en el centro de la mesa.
        </div>
      )}

      {orden.map((id) => {
        const muestras = muestrasDe(intervenciones, id);
        return (
          <div
            key={id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800/50"
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-white dark:text-slate-900"
              >
                {id}
              </span>
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Hablante {id}
              </span>
            </div>

            <div className="mb-4 space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
              {muestras.map((m, k) => (
                <p
                  key={k}
                  className="text-sm leading-relaxed text-slate-600 dark:text-slate-300"
                >
                  <span className="mr-2 font-mono text-[11px] text-slate-400">
                    {mmss(m.inicio)}
                  </span>
                  {m.texto.length > 170 ? m.texto.slice(0, 170) + "…" : m.texto}
                </p>
              ))}
            </div>

            <label
              className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              htmlFor={`hablante-${id}`}
            >
              Su nombre
            </label>
            <input
              id={`hablante-${id}`}
              type="text"
              value={nombres[id] ?? ""}
              onChange={(e) => onCambio(id, e.target.value)}
              placeholder="Ej: Ferney (director)"
              autoComplete="off"
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-slate-300"
            />
          </div>
        );
      })}

      {sinNombre > 0 && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {sinNombre === orden.length
            ? "Si no reconoces las voces, puedes continuar y quedarán como “Hablante A”, “Hablante B”…"
            : `Falta${sinNombre === 1 ? "" : "n"} ${sinNombre} por nombrar. Puedes continuar igual.`}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-2xl border border-slate-300 px-5 py-4 font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={onListo}
          className="flex-1 rounded-2xl bg-slate-900 px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.99] dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
          Generar documento
        </button>
      </div>
    </div>
  );
}
