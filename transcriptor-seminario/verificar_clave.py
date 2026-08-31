#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Comprueba que la clave de API guardada en config.json sea valida.

    python verificar_clave.py

No transcribe nada, asi que no gasta credito. Solo le pregunta al servicio
si reconoce la clave.
"""

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ARCHIVO_CONFIG = RAIZ / "config.json"

# Como se ve una clave de cada servicio, para detectar pegados equivocados.
CONSULTAS = {
    "deepgram": ("https://api.deepgram.com/v1/projects", lambda k: {"Authorization": "Token " + k}),
    "assemblyai": ("https://api.assemblyai.com/v2/transcript?limit=1", lambda k: {"authorization": k}),
}


def main():
    try:
        import requests
    except ImportError:
        print("Falta la dependencia 'requests'. Instalala con:")
        print("    pip install -r requirements.txt")
        return 1

    if not ARCHIVO_CONFIG.exists():
        print("No existe config.json.")
        print("Creralo copiando la plantilla:")
        print("    copy config.example.json config.json")
        return 1

    try:
        cfg = json.loads(ARCHIVO_CONFIG.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print("config.json no es JSON valido: " + str(e))
        print("Revisa que no falten comillas o comas, y que la clave este entre comillas.")
        return 1

    servicio = cfg.get("servicio", "deepgram")
    if servicio == "local":
        print("El servicio configurado es 'local': no usa clave de API.")
        return 0
    if servicio not in CONSULTAS:
        print("Servicio desconocido en config.json: " + str(servicio))
        return 1

    clave = (cfg.get("api_keys", {}).get(servicio) or "").strip()

    if not clave:
        print("El campo '" + servicio + "' esta vacio en config.json.")
        return 1
    if clave.startswith("PEGA_AQUI"):
        print("Todavia esta el texto de ejemplo. Reemplazalo por tu clave real.")
        return 1
    if "\\" in clave or "/" in clave or " " in clave:
        print("Lo que hay en el campo '" + servicio + "' no parece una clave:")
        print("  contiene espacios o barras, y una clave es una sola cadena de")
        print("  letras y numeros. Parece que se pego una ruta o un comando.")
        return 1

    print("Clave leida para '%s' (%d caracteres). Consultando al servicio..." % (servicio, len(clave)))

    url, cabeceras = CONSULTAS[servicio]
    try:
        r = requests.get(url, headers=cabeceras(clave), timeout=30)
    except Exception as e:
        print("No se pudo conectar: " + str(e))
        print("Revisa la conexion a internet.")
        return 1

    if r.status_code == 200:
        print("")
        print("  CLAVE VALIDA. Ya puedes transcribir:")
        print("      python transcribir.py tu_audio.m4a --numero 10")
        return 0
    if r.status_code in (401, 403):
        print("")
        print("  CLAVE RECHAZADA (HTTP %d)." % r.status_code)
        print("  Esta mal copiada o fue revocada. Genera otra en el panel del servicio.")
        return 1

    print("")
    print("  Respuesta inesperada (HTTP %d): %s" % (r.status_code, r.text[:200]))
    return 1


if __name__ == "__main__":
    sys.exit(main())
