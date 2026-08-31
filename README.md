# Transcriptor del Seminario de Investigación — UIS

Herramienta para transcribir las sesiones semanales del trabajo de grado
(modalidad Seminario de Investigación, Ingeniería de Sistemas, UIS).

Toma la grabación de una sesión y produce un documento Markdown limpio, con los
hablantes separados e identificados por nombre, el vocabulario técnico del
proyecto bien reconocido, marcas de tiempo y las decisiones resaltadas. La salida
está pensada para subirla directamente a una conversación con Claude, que la usa
como insumo para redactar el acta.

**Lo que hace:** transcribe, separa hablantes, marca decisiones y fragmentos dudosos.
**Lo que no hace:** no redacta el acta. Eso se sigue haciendo aparte, ahora con
mejor materia prima.

---

## Las dos versiones

Hay dos formas de usarlo. Comparten la misma lógica y producen el mismo documento.

| | [App para el celular](transcriptor-app) | [Script de escritorio](transcriptor-seminario) |
|---|---|---|
| Dónde se usa | Navegador del celular o del PC | Terminal del PC |
| Instalación | Ninguna: se abre una URL | `pip install -r requirements.txt` |
| Grabar desde la app | Sí (para sesiones cortas) | No |
| Límite de tamaño | 95 MB | Sin límite |
| Para qué sirve | El uso semanal normal | Audios muy largos y reprocesar sin gastar crédito |

Cada carpeta tiene su propio README con las instrucciones detalladas.

---

## Costo: cero

- **Deepgram** regala 200 USD de crédito al crear la cuenta, **sin pedir tarjeta**.
  A $0.26 por hora de audio, una sesión semanal de dos horas gasta unos 52
  centavos. El crédito no se agota durante lo que resta del seminario.
- **Vercel** aloja la app en su plan gratuito, que sobra para este uso.
- El script de escritorio incluye además un modo `--servicio local` que transcribe
  en el computador sin conexión y sin costo permanente, aunque **no separa
  hablantes** y es bastante más lento. Está como red de seguridad.

---

## El problema que resuelve

Las transcripciones automáticas corrientes perdían tres cosas:

1. **El vocabulario técnico del proyecto.** Términos como *taxonomía*,
   *trazabilidad evolutiva* o *gobernanza tecnológica* salían mal escritos. Ahora
   se le envían al servicio como lista de refuerzo.
2. **Quién dijo cada cosa.** Ahora se separan las voces automáticamente y la
   herramienta pregunta el nombre de cada una mostrando lo que dijo.
3. **El cierre de las decisiones.** Se detectan las frases del protocolo del grupo
   (*"queda entonces como acuerdo que…"*, *"quedamos en que…"*, *"acordamos
   que…"*) y se recogen en una sección aparte para revisión manual.

---

## Configuración inicial

Ninguna de las dos versiones trae la clave de Deepgram: hay que ponerla.

1. Crear cuenta en <https://console.deepgram.com/signup> (no pide tarjeta).
2. En el panel: **API Keys** → *Create a New API Key*. Se muestra una sola vez.
3. Para el script: copiar `config.example.json` a `config.json` y pegarla ahí.
   Para la app: configurarla como variable de entorno en Vercel.

> **Las claves no se suben a este repositorio.** `config.json` y los archivos
> `.env*` están excluidos en `.gitignore`. Tampoco se suben las grabaciones ni las
> transcripciones generadas, que pueden contener información de las sesiones.

---

## Mantenimiento

Lo único que conviene mantener al día es la **lista de vocabulario**: cada vez que
aparezca un término nuevo que la transcripción escriba mal, agregarlo.

- App: [`transcriptor-app/lib/vocabulario.ts`](transcriptor-app/lib/vocabulario.ts)
- Script: [`transcriptor-seminario/vocabulario.txt`](transcriptor-seminario/vocabulario.txt)

---

## Recomendaciones de grabación

- Poner el teléfono **en el centro de la mesa**, no al lado de una sola persona.
  La separación de voces mejora mucho cuando todos se oyen a volumen parecido.
- Al cerrar cada punto, decir en voz alta *"queda entonces como acuerdo que…"*.
  Es lo que la herramienta busca para armar la lista de decisiones.
- Para sesiones largas, grabar con la grabadora de voz del celular y subir el
  archivo, en vez de grabar dentro del navegador.
