#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Transcriptor de sesiones del Seminario de Investigacion (UIS).

Recibe un archivo de audio ya grabado y produce un documento Markdown limpio con:
  - hablantes separados e identificados por nombre real,
  - vocabulario tecnico del proyecto reforzado,
  - marcas de tiempo [mm:ss],
  - posibles decisiones resaltadas,
  - fragmentos de baja confianza marcados como [inaudible: ...].

Uso tipico:
    python transcribir.py sesion10.m4a --numero 10 --fecha 2026-09-04

No graba audio. No redacta el acta. Solo transcribe y formatea.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import mimetypes
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ARCHIVO_VOCABULARIO = RAIZ / "vocabulario.txt"
ARCHIVO_CONFIG = RAIZ / "config.json"

CONFIG_POR_DEFECTO = {
    "servicio": "deepgram",
    "idioma": "es",
    "modelo": "nova-3",
    "modelo_local": "small",
    "umbral_confianza": 0.6,
    "api_keys": {"deepgram": "", "assemblyai": ""},
}

VARIABLES_ENTORNO = {
    "deepgram": "DEEPGRAM_API_KEY",
    "assemblyai": "ASSEMBLYAI_API_KEY",
}

TIPOS_MIME = {
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".oga": "audio/ogg",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
    ".aac": "audio/aac",
    ".amr": "audio/amr",
    ".wma": "audio/x-ms-wma",
}

# Frases que en el protocolo del grupo indican el cierre de una decision.
# Se evaluan sobre texto normalizado (minusculas y sin tildes).
PATRONES_DECISION = [
    r"queda(?:mos)?\s+(?:entonces\s+)?(?:como\s+)?(?:un\s+)?acuerdo",
    r"como\s+acuerdo\s+que",
    r"quedamos\s+en\s+que",
    r"(?:entonces\s+)?decidimos\s+que",
    r"acordamos\s+que",
    r"queda(?:mos)?\s+(?:entonces\s+)?en\s+que",
    r"qued[o]\s+aprobad[oa]",
    r"queda\s+aprobad[oa]",
    r"el\s+acuerdo\s+(?:es|queda|seria)",
    r"nos\s+comprometemos\s+a",
    r"el\s+compromiso\s+(?:es|queda|seria)",
    r"tarea\s+para\s+la\s+proxima",
]
REGEX_DECISION = re.compile("|".join(PATRONES_DECISION))


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------

def consola_utf8():
    """La consola de Windows suele venir en cp1252 y revienta con tildes."""
    for flujo in (sys.stdout, sys.stderr, sys.stdin):
        try:
            flujo.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def aviso(msg):
    print("  ! " + msg, file=sys.stderr)


def paso(msg):
    print("==> " + msg, flush=True)


def morir(msg, codigo=1):
    print("\nERROR: " + msg + "\n", file=sys.stderr)
    sys.exit(codigo)


def sin_tildes(texto):
    descompuesto = unicodedata.normalize("NFD", texto)
    return "".join(c for c in descompuesto if unicodedata.category(c) != "Mn")


def normalizar(texto):
    return sin_tildes(texto.lower())


def mmss(segundos):
    total = int(round(segundos or 0))
    return "%02d:%02d" % (total // 60, total % 60)


def letra_hablante(indice):
    """Convierte el id del servicio (0,1,2... o 'A','B') en A, B, C..."""
    if isinstance(indice, str) and indice.strip():
        if indice.strip().isdigit():
            indice = int(indice.strip())
        else:
            return indice.strip().upper()
    if not isinstance(indice, int) or indice < 0:
        return "A"
    letras = ""
    n = indice
    while True:
        letras = chr(ord("A") + (n % 26)) + letras
        n = n // 26 - 1
        if n < 0:
            break
    return letras


# ----------------------------------------------------------------------------
# Configuracion y vocabulario
# ----------------------------------------------------------------------------

def cargar_config():
    cfg = dict(CONFIG_POR_DEFECTO)
    cfg["api_keys"] = dict(CONFIG_POR_DEFECTO["api_keys"])
    if ARCHIVO_CONFIG.exists():
        try:
            usuario = json.loads(ARCHIVO_CONFIG.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            morir("config.json tiene un error de formato JSON: " + str(e))
        claves = usuario.pop("api_keys", None)
        usuario.pop("_comentario", None)
        cfg.update(usuario)
        if isinstance(claves, dict):
            cfg["api_keys"].update(claves)
    return cfg


def obtener_api_key(servicio, cfg):
    clave = (cfg.get("api_keys", {}).get(servicio) or "").strip()
    if clave:
        return clave
    variable = VARIABLES_ENTORNO.get(servicio, "")
    clave = (os.environ.get(variable, "") or "").strip()
    if clave:
        return clave
    morir(
        "No encontre la clave de API para '" + servicio + "'.\n"
        "  Opcion 1: copia config.example.json a config.json y pega la clave ahi.\n"
        "  Opcion 2: define la variable de entorno " + variable + ".\n"
        "  El README explica como conseguir una clave gratuita."
    )


def cargar_vocabulario(ruta=ARCHIVO_VOCABULARIO):
    if not ruta.exists():
        aviso("No existe " + ruta.name + "; sigo sin vocabulario personalizado.")
        return []
    terminos = []
    for linea in ruta.read_text(encoding="utf-8").splitlines():
        linea = linea.split("#", 1)[0].strip()
        if not linea:
            continue
        for termino in linea.split(","):
            termino = termino.strip()
            if termino and termino not in terminos:
                terminos.append(termino)
    return terminos


# ----------------------------------------------------------------------------
# Backend: Deepgram
# ----------------------------------------------------------------------------

def _mime(ruta):
    ext = ruta.suffix.lower()
    if ext in TIPOS_MIME:
        return TIPOS_MIME[ext]
    adivinado, _ = mimetypes.guess_type(str(ruta))
    return adivinado or "application/octet-stream"


def transcribir_deepgram(ruta, api_key, vocab, cfg):
    import requests

    modelo = cfg.get("modelo") or "nova-3"
    idioma = cfg.get("idioma") or "es"

    base = [
        ("model", modelo),
        ("language", idioma),
        # OJO: el parametro viejo 'diarize=true' ya no hace nada. Deepgram lo
        # acepta sin quejarse y devuelve todo como un solo hablante. La
        # separacion de voces se activa con 'diarize_model'.
        ("diarize_model", "latest"),
        ("punctuate", "true"),
        ("smart_format", "true"),
        ("utterances", "true"),
    ]
    # nova-3 usa 'keyterm'; los modelos anteriores usan 'keywords'.
    if modelo.startswith("nova-3"):
        extras = [("keyterm", t) for t in vocab]
    else:
        extras = [("keywords", t + ":2") for t in vocab]

    datos = ruta.read_bytes()
    cabeceras = {"Authorization": "Token " + api_key, "Content-Type": _mime(ruta)}

    def pedir(params):
        return requests.post(
            "https://api.deepgram.com/v1/listen",
            params=params,
            headers=cabeceras,
            data=datos,
            timeout=(30, 1800),
        )

    paso("Enviando a Deepgram (modelo=%s, idioma=%s, %d terminos de vocabulario)..."
         % (modelo, idioma, len(vocab)))
    r = pedir(base + extras)

    if r.status_code == 400 and extras:
        aviso("Deepgram rechazo el vocabulario personalizado con este modelo. "
              "Reintento sin el (la transcripcion sigue funcionando).")
        aviso("Respuesta: " + r.text[:300])
        r = pedir(base)

    if r.status_code == 401:
        morir("Deepgram respondio 401: la clave de API es invalida o expiro.")
    if r.status_code == 402:
        morir("Deepgram respondio 402: se agoto el credito gratuito de la cuenta.")
    if r.status_code >= 400:
        morir("Deepgram respondio %d: %s" % (r.status_code, r.text[:600]))

    return r.json()


def normalizar_deepgram(data):
    resultados = data.get("results", {}) or {}
    intervenciones = []

    for u in resultados.get("utterances") or []:
        palabras = [
            {
                "texto": w.get("punctuated_word") or w.get("word") or "",
                "confianza": float(w.get("confidence", 1.0) or 0.0),
            }
            for w in (u.get("words") or [])
        ]
        intervenciones.append({
            "inicio": float(u.get("start", 0.0) or 0.0),
            "fin": float(u.get("end", u.get("start", 0.0)) or 0.0),
            "id_hablante": letra_hablante(u.get("speaker", 0)),
            "palabras": palabras,
            "texto_plano": (u.get("transcript") or "").strip(),
        })

    if intervenciones:
        return intervenciones

    # Respaldo: si no vinieron utterances, reconstruyo agrupando por hablante.
    canales = resultados.get("channels") or []
    if canales:
        alt = (canales[0].get("alternatives") or [{}])[0]
        actual = None
        for w in alt.get("words") or []:
            hablante = letra_hablante(w.get("speaker", 0))
            if actual is None or actual["id_hablante"] != hablante:
                actual = {
                    "inicio": float(w.get("start", 0.0) or 0.0),
                    "id_hablante": hablante,
                    "palabras": [],
                    "texto_plano": "",
                }
                intervenciones.append(actual)
            actual["palabras"].append({
                "texto": w.get("punctuated_word") or w.get("word") or "",
                "confianza": float(w.get("confidence", 1.0) or 0.0),
            })
        for i in intervenciones:
            i["texto_plano"] = " ".join(p["texto"] for p in i["palabras"]).strip()
    return intervenciones


# ----------------------------------------------------------------------------
# Backend: AssemblyAI
# ----------------------------------------------------------------------------

def transcribir_assemblyai(ruta, api_key, vocab, cfg):
    import requests

    cabeceras = {"authorization": api_key}
    idioma = cfg.get("idioma") or "es"

    paso("Subiendo el audio a AssemblyAI...")
    with ruta.open("rb") as f:
        r = requests.post(
            "https://api.assemblyai.com/v2/upload",
            headers=cabeceras, data=f, timeout=(30, 1800),
        )
    if r.status_code >= 400:
        morir("AssemblyAI (subida) respondio %d: %s" % (r.status_code, r.text[:600]))
    url_audio = r.json()["upload_url"]

    cuerpo = {
        "audio_url": url_audio,
        "speaker_labels": True,
        "language_code": idioma,
        "punctuate": True,
        "format_text": True,
    }
    if vocab:
        # AssemblyAI limita el word_boost a 1000 terminos.
        cuerpo["word_boost"] = vocab[:1000]
        cuerpo["boost_param"] = "high"

    paso("Pidiendo transcripcion con diarizacion y %d terminos de vocabulario..." % len(vocab))
    r = requests.post(
        "https://api.assemblyai.com/v2/transcript",
        headers=cabeceras, json=cuerpo, timeout=60,
    )
    if r.status_code >= 400:
        morir("AssemblyAI respondio %d: %s" % (r.status_code, r.text[:600]))
    id_trans = r.json()["id"]

    paso("Esperando el resultado (puede tardar uno o dos minutos)...")
    consulta = "https://api.assemblyai.com/v2/transcript/" + id_trans
    espera = 3
    while True:
        r = requests.get(consulta, headers=cabeceras, timeout=60)
        if r.status_code >= 400:
            morir("AssemblyAI respondio %d: %s" % (r.status_code, r.text[:600]))
        data = r.json()
        estado = data.get("status")
        if estado == "completed":
            return data
        if estado == "error":
            morir("AssemblyAI fallo: " + str(data.get("error")))
        print("    estado: " + str(estado) + " ...", flush=True)
        time.sleep(espera)
        espera = min(espera + 2, 15)


def normalizar_assemblyai(data):
    intervenciones = []
    for u in data.get("utterances") or []:
        palabras = [
            {
                "texto": w.get("text") or "",
                "confianza": float(w.get("confidence", 1.0) or 0.0),
            }
            for w in (u.get("words") or [])
        ]
        intervenciones.append({
            "inicio": float(u.get("start", 0) or 0) / 1000.0,  # ms -> s
            "fin": float(u.get("end", u.get("start", 0)) or 0) / 1000.0,
            "id_hablante": letra_hablante(u.get("speaker", "A")),
            "palabras": palabras,
            "texto_plano": (u.get("text") or "").strip(),
        })
    return intervenciones


# ----------------------------------------------------------------------------
# Backend: local (faster-whisper) - costo cero garantizado, SIN diarizacion
# ----------------------------------------------------------------------------

def transcribir_local(ruta, vocab, cfg):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        morir(
            "El modo local necesita faster-whisper. Instalalo con:\n"
            "    pip install -r requirements-local.txt\n"
            "Recuerda que el modo local NO separa hablantes."
        )

    aviso("MODO LOCAL: este backend no diariza. Todas las intervenciones quedaran "
          "bajo un solo hablante y tendras que separarlas a mano.")

    tam = cfg.get("modelo_local") or "small"
    idioma = cfg.get("idioma") or "es"
    paso("Cargando modelo local '" + tam + "' (la primera vez lo descarga)...")
    modelo = WhisperModel(tam, device="cpu", compute_type="int8")

    # El vocabulario se inyecta como contexto inicial: es el equivalente local
    # del 'word boost' de los servicios en la nube.
    prompt = ", ".join(vocab)[:800] if vocab else None

    paso("Transcribiendo localmente (lento: varios minutos por hora de audio)...")
    segmentos, _info = modelo.transcribe(
        str(ruta), language=idioma, word_timestamps=True,
        initial_prompt=prompt, vad_filter=True,
    )

    crudo = {"segments": []}
    for s in segmentos:
        crudo["segments"].append({
            "start": float(s.start or 0.0),
            "end": float(s.end or s.start or 0.0),
            "text": (s.text or "").strip(),
            "words": [
                {"text": (w.word or "").strip(),
                 "confidence": float(getattr(w, "probability", 1.0) or 0.0)}
                for w in (s.words or [])
            ],
        })
        print("    [%s] %s" % (mmss(s.start), (s.text or "").strip()[:70]), flush=True)
    return crudo


def normalizar_local(data):
    return [
        {
            "inicio": float(s.get("start", 0.0) or 0.0),
            "fin": float(s.get("end", s.get("start", 0.0)) or 0.0),
            "id_hablante": "A",
            "palabras": [
                {"texto": w.get("text", ""),
                 "confianza": float(w.get("confidence", 1.0) or 0.0)}
                for w in (s.get("words") or [])
            ],
            "texto_plano": (s.get("text") or "").strip(),
        }
        for s in data.get("segments") or []
    ]


NORMALIZADORES = {
    "deepgram": normalizar_deepgram,
    "assemblyai": normalizar_assemblyai,
    "local": normalizar_local,
}


# ----------------------------------------------------------------------------
# Agrupacion de turnos
# ----------------------------------------------------------------------------

def agrupar_turnos(intervenciones, max_hueco=3.0, max_caracteres=900):
    """Une las intervenciones seguidas de un mismo hablante.

    El servicio corta en cuanto hay una pausa de menos de un segundo, asi que
    una sola frase puede llegar partida en tres pedazos. Para el acta se lee
    mucho mejor un bloque por turno de palabra. No se unen turnos separados por
    un silencio largo, para que las marcas de tiempo sigan sirviendo.
    """
    agrupadas = []
    for i in intervenciones:
        previa = agrupadas[-1] if agrupadas else None
        hueco = (i["inicio"] - previa["fin"]) if previa and previa.get("fin") is not None else float("inf")
        se_puede_unir = (
            previa is not None
            and previa["id_hablante"] == i["id_hablante"]
            and hueco <= max_hueco
            and len(previa["texto_plano"]) + len(i["texto_plano"]) + 1 <= max_caracteres
        )
        if se_puede_unir:
            previa["palabras"] = previa["palabras"] + i["palabras"]
            previa["texto_plano"] = (previa["texto_plano"] + " " + i["texto_plano"]).strip()
            previa["fin"] = i.get("fin")
        else:
            copia = dict(i)
            copia["palabras"] = list(i.get("palabras") or [])
            agrupadas.append(copia)
    return agrupadas


# ----------------------------------------------------------------------------
# Marcado de fragmentos inciertos
# ----------------------------------------------------------------------------

def texto_con_marcas(intervencion, umbral):
    """Envuelve las rachas de palabras de baja confianza en [inaudible: ...]."""
    palabras = intervencion.get("palabras") or []
    if not palabras:
        return intervencion.get("texto_plano", "")

    partes = []
    racha = []

    def cerrar_racha():
        if racha:
            fragmento = " ".join(racha).strip()
            # La puntuacion final va fuera del corchete, para que se lea natural.
            cola = ""
            m = re.search(r"([,.;:!?]+)$", fragmento)
            if m:
                cola = m.group(1)
                fragmento = fragmento[:m.start()].strip()
            if fragmento:
                partes.append("[inaudible: " + fragmento + "]" + cola)
            racha.clear()

    for p in palabras:
        txt = (p.get("texto") or "").strip()
        if not txt:
            continue
        if p.get("confianza", 1.0) < umbral:
            racha.append(txt)
        else:
            cerrar_racha()
            partes.append(txt)
    cerrar_racha()

    salida = " ".join(partes)
    # Los signos de puntuacion no deben quedar separados de la palabra anterior.
    salida = re.sub(r"\s+([,.;:!?)\]])", r"\1", salida)
    salida = re.sub(r"([(\[¿¡])\s+", r"\1", salida)
    return salida.strip()


def contar_inciertas(intervenciones, umbral):
    total = 0
    bajas = 0
    for i in intervenciones:
        for p in i.get("palabras") or []:
            if not (p.get("texto") or "").strip():
                continue
            total += 1
            if p.get("confianza", 1.0) < umbral:
                bajas += 1
    return bajas, total


# ----------------------------------------------------------------------------
# Deteccion de decisiones
# ----------------------------------------------------------------------------

def detectar_decisiones(intervenciones, ancho=220):
    """Devuelve las intervenciones que contienen una frase de cierre de acuerdo."""
    encontradas = []
    for i in intervenciones:
        texto = i.get("texto_plano") or ""
        if not texto:
            continue
        m = REGEX_DECISION.search(normalizar(texto))
        if not m:
            continue
        if len(texto) <= ancho:
            fragmento = texto
        else:
            # Ventana alrededor de la frase detectada, sin cortar a mitad de palabra.
            centro = m.start()
            ini = max(0, centro - 40)
            fin = min(len(texto), ini + ancho)
            fragmento = texto[ini:fin].strip()
            if ini > 0:
                fragmento = "..." + fragmento
            if fin < len(texto):
                fragmento = fragmento + "..."
        encontradas.append({
            "inicio": i["inicio"],
            "id_hablante": i["id_hablante"],
            "fragmento": fragmento,
        })
    return encontradas


# ----------------------------------------------------------------------------
# Identificacion de hablantes
# ----------------------------------------------------------------------------

def hablantes_en_orden(intervenciones):
    orden = []
    for i in intervenciones:
        if i["id_hablante"] not in orden:
            orden.append(i["id_hablante"])
    return orden


def muestras_de(intervenciones, id_hablante, cuantas=3, minimo_palabras=3):
    muestras = []
    for i in intervenciones:
        if i["id_hablante"] != id_hablante:
            continue
        texto = (i.get("texto_plano") or "").strip()
        if len(texto.split()) < minimo_palabras:
            continue
        muestras.append((i["inicio"], texto))
        if len(muestras) >= cuantas:
            break
    if not muestras:  # el hablante solo dijo frases muy cortas
        for i in intervenciones:
            if i["id_hablante"] == id_hablante and (i.get("texto_plano") or "").strip():
                muestras.append((i["inicio"], i["texto_plano"].strip()))
                break
    return muestras


def parsear_mapeo(cadena):
    """Convierte 'A=Ferney (director),B=Luis' en un diccionario."""
    mapeo = {}
    if not cadena:
        return mapeo
    for par in cadena.split(","):
        if "=" not in par:
            continue
        etiqueta, nombre = par.split("=", 1)
        etiqueta = letra_hablante(etiqueta.strip())
        nombre = nombre.strip()
        if etiqueta and nombre:
            mapeo[etiqueta] = nombre
    return mapeo


def preguntar_nombres(intervenciones, mapeo_previo, interactivo=True):
    nombres = {}
    orden = hablantes_en_orden(intervenciones)

    if not interactivo:
        for etiqueta in orden:
            nombres[etiqueta] = mapeo_previo.get(etiqueta, "Hablante " + etiqueta)
        return nombres

    print("")
    print("-" * 70)
    print("IDENTIFICACION DE HABLANTES")
    print("Se detectaron %d voces. Escribe el nombre de cada una." % len(orden))
    print("Si no sabes quien es, deja vacio y presiona Enter.")
    print("-" * 70)

    for etiqueta in orden:
        if etiqueta in mapeo_previo:
            nombres[etiqueta] = mapeo_previo[etiqueta]
            print("\nHablante %s -> %s (dado por linea de comandos)" % (etiqueta, mapeo_previo[etiqueta]))
            continue
        print("")
        for inicio, texto in muestras_de(intervenciones, etiqueta):
            recorte = texto if len(texto) <= 160 else texto[:160].rstrip() + "..."
            print('  Hablante %s dijo [%s]: "%s"' % (etiqueta, mmss(inicio), recorte))
        try:
            respuesta = input("  Quien es Hablante %s? > " % etiqueta).strip()
        except (EOFError, KeyboardInterrupt):
            print("")
            respuesta = ""
        nombres[etiqueta] = respuesta or ("Hablante " + etiqueta)

    return nombres


# ----------------------------------------------------------------------------
# Salida Markdown
# ----------------------------------------------------------------------------

def construir_markdown(intervenciones, nombres, decisiones, numero, fecha,
                       umbral, meta):
    L = []
    L.append("# Transcripcion — Sesion %s · %s" % (numero, fecha))
    L.append("")

    L.append("## Participantes identificados")
    for etiqueta in hablantes_en_orden(intervenciones):
        L.append("- " + nombres.get(etiqueta, "Hablante " + etiqueta))
    L.append("")

    L.append("## Posibles decisiones detectadas")
    if decisiones:
        L.append("<!-- Deteccion automatica por frases clave. Revisar a mano: puede fallar. -->")
        L.append("")
        for d in decisiones:
            L.append('- [%s] %s: "%s"' % (
                mmss(d["inicio"]),
                nombres.get(d["id_hablante"], "Hablante " + d["id_hablante"]),
                d["fragmento"].replace('"', "'"),
            ))
    else:
        L.append("_No se detectaron frases de cierre de acuerdo "
                 '("queda como acuerdo", "quedamos en que", "acordamos que", ...). '
                 "Revisar la transcripcion completa a mano._")
    L.append("")

    L.append("## Transcripcion completa")
    L.append("")
    for i in intervenciones:
        texto = texto_con_marcas(i, umbral)
        if not texto:
            continue
        L.append("**[%s] %s:** %s" % (
            mmss(i["inicio"]),
            nombres.get(i["id_hablante"], "Hablante " + i["id_hablante"]),
            texto,
        ))
        L.append("")

    L.append("---")
    L.append("")
    L.append("<!--")
    L.append("Generado por transcribir.py (Seminario de Investigacion, UIS).")
    for clave, valor in meta.items():
        L.append("%s: %s" % (clave, valor))
    L.append("Los fragmentos [inaudible: ...] tienen confianza menor a %.2f "
             "y deben verificarse contra el audio original." % umbral)
    L.append("-->")
    L.append("")

    return "\n".join(L)


# ----------------------------------------------------------------------------
# Programa principal
# ----------------------------------------------------------------------------

def construir_parser():
    p = argparse.ArgumentParser(
        prog="transcribir.py",
        description="Transcribe una sesion grabada del seminario y genera un "
                    "Markdown con hablantes, decisiones y marcas de tiempo.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Ejemplos:\n"
            "  python transcribir.py sesion10.m4a --numero 10 --fecha 2026-09-04\n"
            "  python transcribir.py audio.mp3 --numero 11 --hablantes \"A=Ferney,B=Luis\"\n"
            "  python transcribir.py --desde-json crudo.json --numero 10\n"
        ),
    )
    p.add_argument("audio", nargs="?", help="Archivo de audio (m4a, mp3, wav, ogg...)")
    p.add_argument("--numero", "-n", default=None, help="Numero de la sesion")
    p.add_argument("--fecha", "-f", default=None, help="Fecha de la sesion (AAAA-MM-DD)")
    p.add_argument("--servicio", "-s", choices=["deepgram", "assemblyai", "local"],
                   default=None, help="Motor de transcripcion (por defecto: el de config.json)")
    p.add_argument("--salida", "-o", default=None, help="Ruta del .md de salida")
    p.add_argument("--hablantes", default=None,
                   help='Mapeo directo sin preguntar, ej: "A=Ferney (director),B=Luis"')
    p.add_argument("--sin-interaccion", action="store_true",
                   help="No preguntar nombres; usar los de --hablantes o etiquetas genericas")
    p.add_argument("--umbral-confianza", type=float, default=None,
                   help="Confianza minima para NO marcar como [inaudible] (0 a 1)")
    p.add_argument("--vocabulario", default=None, help="Ruta a otro archivo de vocabulario")
    p.add_argument("--guardar-json", default=None,
                   help="Guarda la respuesta cruda del servicio (util para reprocesar gratis)")
    p.add_argument("--desde-json", default=None,
                   help="Reprocesa una respuesta ya guardada, sin volver a llamar al servicio")
    return p


def main(argv=None):
    consola_utf8()
    args = construir_parser().parse_args(argv)
    cfg = cargar_config()

    servicio = args.servicio or cfg.get("servicio") or "deepgram"
    umbral = args.umbral_confianza
    if umbral is None:
        umbral = float(cfg.get("umbral_confianza", 0.6))
    if not 0.0 <= umbral <= 1.0:
        morir("--umbral-confianza debe estar entre 0 y 1.")

    ruta_vocab = Path(args.vocabulario) if args.vocabulario else ARCHIVO_VOCABULARIO
    vocab = cargar_vocabulario(ruta_vocab)

    # --- 1. Obtener la transcripcion cruda ---
    if args.desde_json:
        origen = Path(args.desde_json)
        if not origen.exists():
            morir("No existe el archivo " + str(origen))
        paso("Reprocesando " + origen.name + " (sin llamar al servicio).")
        crudo = json.loads(origen.read_text(encoding="utf-8"))
        nombre_base = origen.stem
    else:
        if not args.audio:
            morir("Falta el archivo de audio. Usa -h para ver la ayuda.")
        ruta = Path(args.audio)
        if not ruta.exists():
            morir("No existe el archivo de audio: " + str(ruta))
        nombre_base = ruta.stem
        mb = ruta.stat().st_size / (1024 * 1024)
        paso("Audio: %s (%.1f MB)" % (ruta.name, mb))

        if servicio == "deepgram":
            crudo = transcribir_deepgram(ruta, obtener_api_key("deepgram", cfg), vocab, cfg)
        elif servicio == "assemblyai":
            crudo = transcribir_assemblyai(ruta, obtener_api_key("assemblyai", cfg), vocab, cfg)
        else:
            crudo = transcribir_local(ruta, vocab, cfg)

        destino_json = Path(args.guardar_json) if args.guardar_json else \
            Path.cwd() / (nombre_base + "_crudo.json")
        destino_json.write_text(json.dumps(crudo, ensure_ascii=False, indent=2),
                                encoding="utf-8")
        paso("Respuesta cruda guardada en " + destino_json.name +
             " (permite reprocesar con --desde-json sin gastar credito).")

    # --- 2. Normalizar ---
    intervenciones = agrupar_turnos(NORMALIZADORES[servicio](crudo))
    if not intervenciones:
        morir("El servicio no devolvio ninguna intervencion. Revisa que el audio "
              "tenga voz audible y que el idioma configurado sea el correcto.")

    duracion = max(i["inicio"] for i in intervenciones)
    orden = hablantes_en_orden(intervenciones)
    paso("Listo: %d intervenciones, %d voces detectadas, hasta [%s]."
         % (len(intervenciones), len(orden), mmss(duracion)))

    # --- 3. Identificar hablantes ---
    mapeo_previo = parsear_mapeo(args.hablantes)
    interactivo = not args.sin_interaccion and sys.stdin is not None and sys.stdin.isatty()
    if not args.sin_interaccion and not interactivo:
        aviso("No hay terminal interactiva; uso etiquetas genericas. "
              'Puedes pasar los nombres con --hablantes "A=Ferney,B=Luis".')
    nombres = preguntar_nombres(intervenciones, mapeo_previo, interactivo)

    # --- 4. Decisiones y fragmentos inciertos ---
    decisiones = detectar_decisiones(intervenciones)
    bajas, total = contar_inciertas(intervenciones, umbral)

    # --- 5. Escribir el Markdown ---
    numero = args.numero
    if numero is None:
        digitos = re.findall(r"\d+", nombre_base)
        numero = digitos[-1] if digitos else "?"
    fecha = args.fecha or _dt.date.today().isoformat()

    meta = {
        "servicio": servicio,
        "modelo": cfg.get("modelo_local") if servicio == "local" else cfg.get("modelo"),
        "intervenciones": len(intervenciones),
        "voces_detectadas": len(orden),
        "palabras_marcadas_inaudibles": "%d de %d" % (bajas, total) if total else "sin datos de confianza",
        "terminos_de_vocabulario": len(vocab),
    }

    md = construir_markdown(intervenciones, nombres, decisiones, numero, fecha, umbral, meta)

    salida = Path(args.salida) if args.salida else \
        Path.cwd() / ("Transcripcion_Sesion_%s.md" % numero)
    salida.write_text(md, encoding="utf-8")

    print("")
    paso("Archivo generado: " + str(salida))
    print("    Participantes:  " + ", ".join(nombres[e] for e in orden))
    print("    Decisiones detectadas: %d (revisar a mano)" % len(decisiones))
    if total:
        print("    Fragmentos inciertos: %d de %d palabras bajo confianza %.2f"
              % (bajas, total, umbral))
    print("")
    print("    Siguiente paso: sube ese .md a la conversacion con Claude,")
    print("    indicando el numero de sesion.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrumpido por el usuario.", file=sys.stderr)
        sys.exit(130)
