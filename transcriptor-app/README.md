# Transcriptor del Seminario — app para el celular

App web instalable que convierte la grabación de una sesión en un documento
Markdown con hablantes separados, vocabulario técnico corregido, marcas de tiempo
y decisiones resaltadas, listo para pasarle a Claude.

Se abre desde el navegador del celular y se instala en la pantalla de inicio, así
que se ve y se usa como una app normal. No hay que pasar por la Play Store.

> Existe también una versión de línea de comandos en `../transcriptor-seminario`,
> para correr desde el PC. Las dos usan la misma lógica y producen el mismo
> documento. La de escritorio sirve para audios de más de 95 MB.

---

## Cómo se usa (para el equipo)

1. Abrir la URL de la app en el celular.
2. **Subir una grabación** (o **Grabar ahora** para algo corto).
3. Escribir el número de sesión y la fecha.
4. Tocar **Transcribir** y esperar entre uno y tres minutos.
5. La app muestra las primeras frases de cada voz detectada y pregunta quién es
   cada una. Escribir los nombres.
6. **Copiar todo** y pegarlo en la conversación con Claude, diciéndole de qué
   sesión se trata.

### Instalarla en la pantalla de inicio

- **Android (Chrome):** menú de tres puntos → *Añadir a pantalla de inicio*.
- **iPhone (Safari):** botón de compartir → *Añadir a pantalla de inicio*.

### Recomendaciones de grabación

- Para las sesiones largas, grabar con la **grabadora de voz que ya trae el
  celular** y subir el archivo. Es más confiable que grabar dentro del navegador:
  si Android suspende la pestaña, una grabación de dos horas hecha aquí se puede
  perder.
- Poner el teléfono **en el centro de la mesa**, no al lado de una sola persona.
  La separación de voces mejora muchísimo cuando todos se oyen parecido.
- Al cerrar cada punto, decir en voz alta *"queda entonces como acuerdo que…"*.
  Eso es lo que la app detecta para armar la lista de decisiones.
- Límite de tamaño: **95 MB**. Una grabación de dos horas suele pesar entre 55 y
  90 MB. Si se pasa, usar el script de escritorio, que no tiene ese límite.

---

## Desplegarla (una sola vez)

Hace falta una cuenta de Vercel (gratuita) y la clave de Deepgram.

**1. Instalar la herramienta de Vercel**

```bash
npm i -g vercel
```

**2. Desde la carpeta del proyecto, desplegar**

```bash
cd "C:\Users\Isabel\Desktop\Seminario Herramienta\transcriptor-app"
```

```bash
vercel
```

La primera vez pide iniciar sesión y hace algunas preguntas; se puede aceptar
todo lo que propone por defecto. Al terminar imprime una URL.

**3. Configurar las variables de entorno**

```bash
vercel env add DEEPGRAM_API_KEY
```

Pega la clave cuando la pida y elige los tres entornos (Production, Preview,
Development). Luego, para proteger el crédito:

```bash
vercel env add CODIGO_ACCESO
```

Inventa una palabra y compártela solo con los cinco del grupo. Quien no la
sepa, no puede usar la app aunque tenga la URL.

**4. Publicar la versión definitiva**

```bash
vercel --prod
```

Esa es la URL que se le pasa al equipo.

### Costo

Cero. El plan gratuito de Vercel cubre de sobra este uso, y Deepgram regala 200
USD de crédito sin pedir tarjeta: a $0.26 por hora de audio, una sesión semanal
de dos horas gasta unos 52 centavos. El crédito no se agota durante el seminario.

---

## Para trabajar en el código

```bash
npm install
```

```bash
cp .env.example .env.local
```

Poner la clave en `.env.local` y levantar el servidor:

```bash
npm run dev
```

Queda en <http://localhost:3000>.

### Qué hay en cada archivo

| Archivo | Qué contiene |
|---|---|
| `lib/vocabulario.ts` | **Los términos del proyecto.** Es lo que más conviene mantener al día. |
| `lib/formato.ts` | Detección de decisiones, marcado de fragmentos dudosos, agrupación de turnos y armado del Markdown. |
| `app/api/transcribir/route.ts` | Habla con Deepgram. **Aquí vive la clave**, nunca en el navegador. |
| `app/page.tsx` | Las cuatro pantallas: audio → datos → hablantes → resultado. |
| `components/` | Grabadora, identificación de hablantes y pantalla de resultado. |
| `scripts/generar-iconos.mjs` | Genera los íconos de la app. Solo hay que correrlo si se cambia el diseño. |

### Cómo está protegida

La app es pública en internet, así que cada endpoint que gasta recursos comprueba
quién llama:

- **`/api/subir`** exige el código de acceso *antes* de entregar el permiso de
  subida. Si se validara solo al transcribir, el archivo ya estaría subido y
  cualquiera podría llenar el almacenamiento con audios de 100 MB.
- **`/api/callback`** exige una firma en la URL. Deepgram no firma sus webhooks,
  así que la firma se calcula aquí con la clave de Deepgram como secreto (no hace
  falta configurar nada nuevo) y cubre el id, la URL del audio y si el vocabulario
  se aplicó. Sin ella cualquiera podría escribir transcripciones falsas o pedir el
  borrado de archivos ajenos.
- **`/api/estado`** solo acepta identificadores con forma de UUID y compara el
  nombre completo del archivo, no el prefijo. Con una búsqueda por prefijo, un id
  de una sola letra devolvía la transcripción de otra persona.
- **Los resultados no se borran al leerlos.** Los borra el navegador cuando ya los
  tiene en pantalla, y el callback limpia a las 24 horas lo que quedó sin recoger.
  Si se borraran al leerlos, una respuesta perdida en datos móviles destruiría la
  transcripción y habría que volver a pagarla.

Nada de esto sustituye al código de acceso: **configúralo siempre** en un
despliegue público.

### Dos detalles que costaron encontrar

- **La diarización se activa con `diarize_model=latest`, no con `diarize=true`.**
  El parámetro viejo sigue siendo aceptado por Deepgram sin dar ningún error,
  pero no hace nada: devuelve la sesión entera como un solo hablante. Si algún
  día vuelven a salir todas las intervenciones bajo la misma persona, revisar eso
  primero.
- **Deepgram parte las frases en cuanto hay una pausa mínima**, así que una sola
  intervención llega en varios pedazos. `agruparTurnos()` los vuelve a unir
  cuando son del mismo hablante y el silencio entre ellos fue corto. Sin eso el
  documento queda lleno de líneas de una palabra.

### Añadir términos al vocabulario

Editar `lib/vocabulario.ts`, agregar la palabra entre comillas con una coma al
final, y volver a desplegar con `vercel --prod`. Conviene hacerlo cada vez que
aparezca un término nuevo que la transcripción escriba mal.
