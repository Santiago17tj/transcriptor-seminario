"use client";

/**
 * Paso final: muestra el documento generado y ofrece copiarlo o descargarlo.
 *
 * El documento es el insumo para redactar el acta, asi que el boton principal
 * es "Copiar todo": desde el celular es lo mas comodo.
 */

import { useState } from "react";
import {
  contarInciertas,
  detectarDecisiones,
  hablantesEnOrden,
  mmss,
  nombreArchivo,
  type Intervencion,
} from "@/lib/formato";

type Props = {
  markdown: string;
  intervenciones: Intervencion[];
  nombres: Record<string, string>;
  numero: string;
  onVolver: () => void;
  onNueva: () => void;
};

export default function Resultado({
  markdown,
  intervenciones,
  nombres,
  numero,
  onVolver,
  onNueva,
}: Props) {
  const [copiado, setCopiado] = useState(false);
  const decisiones = detectarDecisiones(intervenciones);
  const voces = hablantesEnOrden(intervenciones).length;
  const { bajas, total } = contarInciertas(intervenciones);
  const duracion = intervenciones.length
    ? mmss(intervenciones[intervenciones.length - 1].inicio)
    : "00:00";
  const nombreDe = (id: string) => nombres[id]?.trim() || `Hablante ${id}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Algunos navegadores bloquean el portapapeles: queda la descarga.
      setCopiado(false);
    }
  };

  const descargar = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivo(numero);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const dato = (valor: string, etiqueta: string) => (
    <div className="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-center dark:bg-slate-800">
      <p className="text-base font-semibold tabular-nums">{valor}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{etiqueta}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Transcripción lista</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Cópiala o descárgala para redactar el acta de la sesión.
        </p>
      </div>

      <div className="flex gap-2">
        {dato(duracion, "duración")}
        {dato(String(voces), voces === 1 ? "voz" : "voces")}
        {dato(String(intervenciones.length), "intervenciones")}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={copiar}
          className={`flex-1 rounded-2xl px-5 py-4 text-base font-semibold shadow-sm transition active:scale-[0.99] ${
            copiado
              ? "bg-emerald-600 text-white"
              : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          }`}
        >
          {copiado ? "¡Copiado!" : "Copiar todo"}
        </button>
        <button
          type="button"
          onClick={descargar}
          className="rounded-2xl border border-slate-300 px-5 py-4 font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Descargar
        </button>
      </div>

      {decisiones.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">
            {decisiones.length}{" "}
            {decisiones.length === 1
              ? "posible decisión detectada"
              : "posibles decisiones detectadas"}
          </h3>
          <ul className="mt-3 space-y-3">
            {decisiones.map((d, k) => (
              <li
                key={k}
                className="border-l-2 border-amber-300 pl-3 text-sm leading-relaxed text-amber-900 dark:border-amber-700 dark:text-amber-100"
              >
                <span className="font-mono text-[11px]">{mmss(d.inicio)}</span>{" "}
                <span className="font-medium">{nombreDe(d.idHablante)}:</span>{" "}
                {d.fragmento}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
            Detección automática por frases clave. Puede fallar: revísalas contra
            el audio antes de pasarlas al acta.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
          No se detectaron frases de cierre de acuerdo. Si en la sesión sí se
          tomaron decisiones, ayuda mucho decirlas en voz alta como{" "}
          <em>&ldquo;queda entonces como acuerdo que…&rdquo;</em>.
        </div>
      )}

      {total > 0 && bajas > 0 && (
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {bajas} de {total} palabras quedaron marcadas como{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">
            [inaudible: …]
          </code>
          . Es el texto que el servicio no escuchó con claridad: conviene
          verificarlo contra el audio antes de citarlo.
        </p>
      )}

      <details className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-800/50">
        <summary className="cursor-pointer select-none px-5 py-3.5 text-sm font-medium">
          Ver el documento completo
        </summary>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 px-5 py-4 text-xs leading-relaxed text-slate-700 dark:border-slate-700 dark:text-slate-300">
          {markdown}
        </pre>
      </details>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Corregir nombres
        </button>
        <button
          type="button"
          onClick={onNueva}
          className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Transcribir otra
        </button>
      </div>
    </div>
  );
}
