/**
 * Genera los iconos PNG de la aplicacion sin depender de ninguna libreria.
 *
 *     node scripts/generar-iconos.mjs
 *
 * Solo hay que volver a correrlo si se cambia el diseno del icono. Los PNG
 * quedan en public/ y el manifest los referencia por nombre.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = join(RAIZ, "public");

const FONDO = [15, 23, 42]; // slate-900
const BARRA = [248, 250, 252]; // slate-50

// --- PNG minimo -------------------------------------------------------------

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** pixeles: Uint8Array RGBA de tamano ancho*alto*4 */
function png(ancho, alto, pixeles) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compresion
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // entrelazado

  // Cada fila lleva un byte de filtro (0 = sin filtro) por delante.
  const crudo = Buffer.alloc(alto * (1 + ancho * 4));
  for (let y = 0; y < alto; y++) {
    const destino = y * (1 + ancho * 4);
    crudo[destino] = 0;
    pixeles.copy(crudo, destino + 1, y * ancho * 4, (y + 1) * ancho * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(crudo, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Diseno del icono -------------------------------------------------------

/** Distancia al borde de un rectangulo de esquinas redondeadas. Negativo = dentro. */
function fueraDeRectRedondeado(x, y, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return Math.hypot(dx, dy) - r;
}

function dibujar(tamano, { maskable = false } = {}) {
  const px = Buffer.alloc(tamano * tamano * 4);

  // En un icono "maskable" Android puede recortar hasta un 20% de cada borde,
  // asi que el dibujo se encoge para quedar dentro de la zona segura.
  const escala = maskable ? 0.6 : 0.78;
  const radioFondo = maskable ? tamano : tamano * 0.23;

  // Cinco barras tipo onda de sonido, centradas.
  const alturas = [0.34, 0.62, 1.0, 0.56, 0.4];
  const anchoBarra = tamano * escala * 0.13;
  const separacion = tamano * escala * 0.075;
  const anchoTotal =
    alturas.length * anchoBarra + (alturas.length - 1) * separacion;
  const inicioX = (tamano - anchoTotal) / 2;
  const centroY = tamano / 2;
  const alturaMax = tamano * escala * 0.62;

  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      const i = (y * tamano + x) * 4;
      const cx = x + 0.5;
      const cy = y + 0.5;

      // Fondo (con antialiasing en el borde redondeado).
      const d = fueraDeRectRedondeado(
        cx,
        cy,
        0,
        0,
        tamano,
        tamano,
        radioFondo,
      );
      const alfaFondo = Math.min(1, Math.max(0, 0.5 - d));
      let [r, g, b] = FONDO;
      let a = alfaFondo;

      // Barras encima.
      for (let k = 0; k < alturas.length; k++) {
        const bx0 = inicioX + k * (anchoBarra + separacion);
        const bx1 = bx0 + anchoBarra;
        const mitad = (alturas[k] * alturaMax) / 2;
        const db = fueraDeRectRedondeado(
          cx,
          cy,
          bx0,
          centroY - mitad,
          bx1,
          centroY + mitad,
          anchoBarra / 2,
        );
        const alfaBarra = Math.min(1, Math.max(0, 0.5 - db));
        if (alfaBarra > 0) {
          r = Math.round(r * (1 - alfaBarra) + BARRA[0] * alfaBarra);
          g = Math.round(g * (1 - alfaBarra) + BARRA[1] * alfaBarra);
          b = Math.round(b * (1 - alfaBarra) + BARRA[2] * alfaBarra);
          a = Math.max(a, alfaBarra);
        }
      }

      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.round(a * 255);
    }
  }
  return png(tamano, tamano, px);
}

mkdirSync(SALIDA, { recursive: true });

const archivos = [
  ["icono-192.png", dibujar(192)],
  ["icono-512.png", dibujar(512)],
  ["icono-mascara-512.png", dibujar(512, { maskable: true })],
  ["apple-icon.png", dibujar(180)],
];

for (const [nombre, datos] of archivos) {
  writeFileSync(join(SALIDA, nombre), datos);
  console.log(`  ${nombre} (${(datos.length / 1024).toFixed(1)} KB)`);
}
console.log("Iconos generados en public/");
