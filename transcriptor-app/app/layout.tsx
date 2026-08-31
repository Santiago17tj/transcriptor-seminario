import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transcriptor del Seminario",
  description:
    "Convierte la grabación de una sesión del seminario en un documento con hablantes, decisiones y marcas de tiempo.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Transcriptor",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
  // Sin maximumScale: bloquear el zoom perjudica a quien necesita acercar.
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-50">
        {children}
        <footer className="px-5 pb-8 text-center text-xs text-slate-400">
          Seminario de Investigación · Ingeniería de Sistemas UIS
        </footer>
      </body>
    </html>
  );
}
