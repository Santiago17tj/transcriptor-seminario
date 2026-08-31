import type { MetadataRoute } from "next";

/**
 * Manifest de aplicacion web: es lo que hace que al darle "Agregar a pantalla de
 * inicio" en el celular quede con icono y se abra a pantalla completa, sin la
 * barra del navegador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Transcriptor del Seminario",
    short_name: "Transcriptor",
    description:
      "Convierte la grabación de una sesión del seminario en un documento con hablantes, decisiones y marcas de tiempo.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f172a",
    lang: "es",
    orientation: "portrait",
    icons: [
      {
        src: "/icono-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icono-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icono-mascara-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
