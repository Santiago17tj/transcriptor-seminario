/**
 * Vocabulario tecnico del proyecto de grado (Seminario de Investigacion, UIS).
 *
 * Esta lista se le envia a Deepgram en cada transcripcion para que reconozca los
 * terminos propios del proyecto en lugar de inventar palabras parecidas.
 *
 * ---> ESTE ES EL ARCHIVO QUE MAS CONVIENE MANTENER AL DIA. <---
 * Cada vez que la transcripcion escriba mal un termino nuevo, agregalo aqui
 * entre comillas y con una coma al final de la linea.
 */

export const VOCABULARIO: string[] = [
  // Marco taxonomico
  "taxonomía",
  "taxonómico",
  "meta-característica",
  "dimensión",
  "característica",
  "Nickerson",
  "Varshney",
  "Muntermann",

  // Autores y referencias
  "Weyns",
  "Kephart",
  "Chess",
  "Gasser",
  "Almeida",
  "Kitchenham",
  "Charters",

  // Computacion autonomica
  "MAPE-K",
  "computación autonómica",
  "autonomic manager",
  "touchpoint",
  "knowledge source",
  "manual manager",
  "quiescencia",
  "fail-safe",

  // Dimensiones propias de la taxonomia
  "trazabilidad evolutiva",
  "gobernanza tecnológica",
  "proveniencia del cambio",
  "reversibilidad",
  "impacto organizacional",
  "alcance de control",
  "nivel de autonomía",
  "auto-adaptación",
  "auto-evolución",
  "arquitecturas auto-evolutivas",
  "retroalimentación en producción",

  // Metodologia y contexto academico
  "Sistemas de Información",
  "estado del arte",
  "corpus documental",
  "revisión sistemática",
  "acta",
  "seminario",
  "objetivo específico",
  "enfoque",
  "lineamientos conceptuales",

  // Tecnologia
  "ISO 25010",
  "observabilidad",
  "adaptación en runtime",
  "modelos de lenguaje",
  "LLM",
  "Claude",
];
