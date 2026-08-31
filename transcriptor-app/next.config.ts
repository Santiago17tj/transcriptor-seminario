import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // La raiz se fija aqui porque hay un package-lock.json suelto mas arriba en
    // el disco y Turbopack, si no, no sabe cual es el proyecto.
    root: path.join(import.meta.dirname, "."),
  },
};

export default nextConfig;
