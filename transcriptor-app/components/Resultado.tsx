"use client";

/**
 * Paso final: muestra el documento generado y ofrece copiarlo o descargarlo.
 *
 * El objetivo del documento es subirlo a la conversacion con Claude, asi que el
 * boton principal es "Copiar todo": desde el celular es lo mas comodo.
 */

import { useState } from "react";
import { detectarDecisiones, mmss, nombreArchivo, type Intervencion } from "@/lib/formato";

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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Listo</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Copia el texto y pégalo en la conversación con Claude, diciéndole de
          qué sesión es.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={copiar}
          className="flex-1 rounded-2xl bg-slate-900 px-5 py-4 text-lg font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          {copiado ? "¡Copiado!" : "Copiar todo"}
        </button>
        <button
          type="button"
          onClick={descargar}
          className="rounded-2xl border border-slate-300 px-5 py-4 font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
        >
          Descargar
        </button>
      </div>

      {decisiones.length > 0 ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">
            {decisiones.length}{" "}
            {decisiones.length === 1
              ? "posible decisión detectada"
              : "posibles decisiones detectadas"}
          </h3>
          <ul className="mt-2 space-y-2">
            {decisiones.map((d, k) => (
              <li
                key={k}
                className="text-sm leading-relaxed text-amber-900 dark:text-amber-100"
              >
                <span className="font-mono text-xs">[{mmss(d.inicio)}]</span>{" "}
                <span className="font-medium">{nombreDe(d.idHablante)}:</span>{" "}
                {d.fragmento}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-amber-800 dark:text-amber-300">
            Detección automática por frases clave. Puede fallar: revísalas contra
            el audio antes de pasarlas al acta.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          No se detectaron frases de cierre de acuerdo. Si en la sesión sí se
          tomaron decisiones, ayuda mucho decirlas en voz alta como{" "}
          <em>&ldquo;queda entonces como acuerdo que…&rdquo;</em>.
        </div>
      )}

      <details className="rounded-2xl border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer px-4 py-3 font-medium">
          Ver el documento completo
        </summary>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 px-4 py-3 text-xs leading-relaxed dark:border-slate-700">
          {markdown}
        </pre>
      </details>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onVolver}
          className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
        >
          Corregir nombres
        </button>
        <button
          type="button"
          onClick={onNueva}
          className="rounded-2xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 dark:border-slate-600 dark:text-slate-200"
        >
          Transcribir otra
        </button>
      </div>
    </div>
  );
}
