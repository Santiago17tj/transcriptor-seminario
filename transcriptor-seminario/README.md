# Transcriptor de sesiones — Seminario de Investigación (UIS)

Convierte la grabación de una sesión con el director en un documento Markdown limpio,
con los hablantes separados e identificados por nombre, el vocabulario técnico del
proyecto bien reconocido, marcas de tiempo y las decisiones resaltadas.

La salida está pensada para subirla directamente a una conversación con Claude, que
la usa como insumo para el borrador del acta.

**Lo que hace:** transcribe, separa hablantes, marca decisiones y fragmentos dudosos.
**Lo que no hace:** no graba audio, no redacta el acta, no tiene interfaz gráfica.

---

## 1. Costo: cómo dejarlo en cero

El requisito del grupo es no pagar nada. Hay dos caminos, y el script soporta ambos.

### Camino recomendado — Deepgram (nube, gratis en la práctica)

Al crear la cuenta, Deepgram regala **200 USD de crédito sin pedir tarjeta**. Con la
tarifa estándar del modelo `nova-3`, eso equivale a **cientos de horas de audio**.
Una sesión semanal de dos horas consume centavos. En la práctica el crédito nunca se
agota durante lo que resta del seminario.

Es el único camino que da diarización (separación de hablantes) de buena calidad,
que es justamente el problema que se quiere resolver.

### Camino de respaldo — modo local (gratis para siempre, pero peor)

Si el crédito se acaba o el grupo prefiere no depender de un servicio en la nube,
existe `--servicio local`, que transcribe en el computador con `faster-whisper`. Es
gratis de forma permanente y funciona sin internet, **pero no separa hablantes**:
todo queda bajo una sola etiqueta y hay que dividir las intervenciones a mano.
También es bastante más lento (varios minutos por cada hora de audio).

Está incluido como red de seguridad, no como opción principal.

---

## 2. Instalación

Se necesita Python 3.9 o superior. En este equipo ya está instalado Python 3.13.

Desde la carpeta `transcriptor-seminario`:

```bash
pip install -r requirements.txt
```

Eso instala una sola dependencia: `requests`. Nada pesado.

(Solo si se va a usar el modo local, además: `pip install -r requirements-local.txt`.)

---

## 3. Conseguir la clave de API y guardarla

1. Entrar a <https://console.deepgram.com/signup> y crear la cuenta con el correo
   institucional. No pide tarjeta.
2. En el panel, ir a **API Keys** y crear una clave nueva. Copiarla apenas aparezca:
   solo se muestra una vez.
3. Copiar el archivo de plantilla y pegar la clave:

```bash
copy config.example.json config.json
```

Abrir `config.json` y reemplazar `PEGA_AQUI_TU_CLAVE_DE_DEEPGRAM` por la clave real:

```json
{
  "servicio": "deepgram",
  "idioma": "es",
  "modelo": "nova-3",
  "umbral_confianza": 0.6,
  "api_keys": {
    "deepgram": "abc123...la_clave_real...",
    "assemblyai": ""
  }
}
```

Solo se reemplaza el texto `PEGA_AQUI_TU_CLAVE_DE_DEEPGRAM`. La clave es una sola
cadena de unos 40 caracteres entre letras y números: sin espacios, sin rutas de
carpetas y sin barras invertidas.

**`config.json` no se comparte con nadie ni se sube a ningún repositorio.** Ya está
listado en `.gitignore`. Una clave filtrada la puede gastar cualquiera.

Alternativa, si se prefiere no dejar la clave en un archivo: definir la variable de
entorno `DEEPGRAM_API_KEY`.

### Comprobar que la clave quedó bien

```bash
python verificar_clave.py
```

Le pregunta al servicio si reconoce la clave. No transcribe nada, así que no gasta
crédito. Debe responder `CLAVE VALIDA`.

> **Nota sobre PowerShell.** Los comandos de este README se escriben **uno por línea**.
> Si se encadenan dos con `&&`, la *Windows PowerShell* clásica (la ventana azul,
> versión 5.1) da error de sintaxis porque ese operador no existe ahí. Primero se
> hace `cd` a la carpeta, se presiona Enter, y después se escribe el comando.

---

## 4. Uso

El comando normal, tal como se usará cada semana:

```bash
python transcribir.py sesion10.m4a --numero 10 --fecha 2026-09-04
```

El script:

1. Sube el audio a Deepgram con diarización y vocabulario activados.
2. Espera el resultado (uno o dos minutos para una sesión de dos horas).
3. Guarda la respuesta cruda en `sesion10_crudo.json` (ver sección 7).
4. Pregunta en pantalla quién es cada hablante, mostrando lo que dijo:

```
  Hablante A dijo [00:00]: "Buenas, entonces sobre lo de la taxonomía..."
  Hablante A dijo [12:34]: "Listo, entonces queda como acuerdo que..."
  Quien es Hablante A? > Ferney (director)
```

5. Marca las decisiones y los fragmentos de baja confianza.
6. Guarda `Transcripcion_Sesion_10.md` en la carpeta actual.

### Opciones

| Opción | Para qué sirve |
|---|---|
| `--numero N`, `-n` | Número de la sesión (sale en el título y en el nombre del archivo). |
| `--fecha AAAA-MM-DD`, `-f` | Fecha de la sesión. Si se omite, usa la fecha de hoy. |
| `--servicio` , `-s` | `deepgram` (por defecto), `assemblyai` o `local`. |
| `--salida ruta.md`, `-o` | Cambia dónde se guarda el resultado. |
| `--hablantes "A=Ferney,B=Luis"` | Da los nombres de una vez, sin preguntar. |
| `--sin-interaccion` | No pregunta nada; deja "Hablante A", "Hablante B"... |
| `--umbral-confianza 0.6` | Debajo de este valor, el texto se marca `[inaudible: ...]`. |
| `--vocabulario otro.txt` | Usa otra lista de términos. |
| `--desde-json crudo.json` | Reprocesa una transcripción ya pagada, sin volver a llamar al servicio. |

Ver todo con `python transcribir.py -h`.

---

## 5. El vocabulario técnico

`vocabulario.txt` contiene los términos propios del proyecto — *taxonomía*,
*trazabilidad evolutiva*, *gobernanza tecnológica*, *MAPE-K*, los apellidos de los
autores que se citan seguido. Esa lista se le envía al servicio en cada llamada para
que los reconozca en lugar de inventar palabras parecidas.

**Es el archivo que más conviene mantener al día.** Cada vez que aparezca un término
nuevo que la transcripción escriba mal, agregarlo ahí, uno por línea. Las líneas que
empiezan con `#` son comentarios.

---

## 6. Cómo leer la salida

```markdown
# Transcripción — Sesión 10 · 2026-09-04

## Participantes identificados
- Ferney Mauricio Calderón (director)
- Luis Santiago Tarazona Jiménez

## Posibles decisiones detectadas
- [12:34] Ferney Mauricio Calderón (director): "Listo, entonces queda como acuerdo que
  la dimensión de trazabilidad evolutiva va antes de gobernanza tecnológica..."

## Transcripción completa

**[00:00] Ferney Mauricio Calderón (director):** Buenas, entonces sobre lo de la taxonomía...

**[00:45] Luis Santiago Tarazona Jiménez:** Sí profe, ya lo revisamos y aplicamos el
método de Nickerson sobre el [inaudible: corpus documental].
```

Dos advertencias importantes sobre esa salida:

- **Las decisiones detectadas son una ayuda, no una verdad.** Se buscan frases como
  *"queda como acuerdo"*, *"quedamos en que"*, *"acordamos que"*, *"decidimos que"*,
  *"quedó aprobado"*, *"nos comprometemos a"*. Si en la sesión no se dicen esas
  frases, no se detecta nada. Por eso vale la pena mantener el protocolo del grupo de
  cerrar cada punto diciendo en voz alta *"queda entonces como acuerdo que..."*.
- **`[inaudible: texto probable]` significa que el servicio no estaba seguro.** El
  texto entre corchetes es su mejor intento. Hay que volver al audio en esa marca de
  tiempo antes de citarlo en el acta.

---

## 7. El archivo `_crudo.json`

Cada corrida guarda la respuesta completa del servicio en `<nombre>_crudo.json`. Sirve
para volver a generar el Markdown sin gastar crédito otra vez:

```bash
python transcribir.py --desde-json sesion10_crudo.json --numero 10 --fecha 2026-09-04
```

Útil cuando alguien se equivocó al escribir un nombre, cuando se quiere subir el
umbral de confianza, o cuando se agregaron patrones de decisión nuevos.

---

## 8. Problemas frecuentes

**`ERROR: No encontre la clave de API`** — falta crear `config.json` a partir de
`config.example.json`, o la clave quedó vacía.

**`Deepgram respondio 401`** — la clave está mal copiada o fue revocada. Generar otra
en el panel de Deepgram.

**`Deepgram respondio 402`** — se agotó el crédito gratuito. Pasar al modo local
(`--servicio local`) o crear una cuenta nueva.

**`Deepgram rechazo el vocabulario personalizado`** — es solo un aviso, no un error.
El script reintenta sin la lista de términos y la transcripción sale igual, con un
poco menos de precisión en las palabras técnicas. Si pasa siempre, cambiar `"modelo"`
a `"nova-2"` en `config.json`.

**Detecta más voces de las que había** — pasa cuando alguien habla lejos del teléfono
o cuando se cruzan al hablar. En el prompt de identificación se le puede dar el mismo
nombre a dos etiquetas; quedarán como dos participantes con el mismo nombre y se
corrige a mano en el `.md`.

**Todo queda como un solo hablante** — en modo local es el comportamiento esperado:
`faster-whisper` no diariza. Con Deepgram, en cambio, es un síntoma conocido: la
separación de voces se activa con el parámetro `diarize_model`, no con el antiguo
`diarize=true`. Deepgram acepta el parámetro viejo sin dar ningún error, pero lo
ignora y devuelve la sesión entera bajo una sola persona. Si vuelve a pasar,
revisar esa línea en `transcribir.py`.

**Para grabar mejor:** poner el teléfono en el centro de la mesa, no cerca de una sola
persona. La diarización mejora muchísimo cuando todos se oyen a volumen parecido.

---

## 9. Qué hacer con el resultado

Subir el `.md` a la conversación con Claude junto con una nota como
*"Esta es la transcripción de la sesión 10"*. El formato ya resuelto de hablantes,
tiempos y decisiones permite que el borrador del acta salga mucho más preciso que con
la transcripción cruda del teléfono.

Antes de subirlo, vale la pena una pasada rápida: revisar las decisiones detectadas y
los fragmentos `[inaudible: ...]` de los momentos que importan.
