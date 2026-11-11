# Claimable Bot: plan de creación

Fecha: 2026-11-10 (versión 1). Apuesta 4 de `/mnt/project-files/fable-5-2/plan.md`. Solo plan: nada de esto está construido. El avance se apunta en `docs/BOT-PROGRESS.md`.

Cómo leer este documento: las secciones 1 a 7 son para Enrique. Las secciones 8 y 9 son las órdenes de trabajo para quien construye (Opus y Sonnet, sin Fable): se siguen en orden, una por PR.

Aviso de honestidad: los límites de la API de GitHub de la orden I0.1 están escritos de memoria; esa orden los mide antes de fijar el tamaño del índice.

## 1. La meta en una frase

Un proyecto añade un archivo de 15 líneas y, desde ese momento, quien comenta `/claim` en un issue se lo queda, recibe un aviso si lo deja parado y lo pierde solo si no responde; y cualquiera puede abrir una página con los issues que hoy están libres de verdad en miles de proyectos.

Son dos productos que se alimentan:

1. **El bot** (una GitHub Action que instala cada proyecto): reserva, avisa y libera.
2. **El índice** (un sitio estático público, actualizado cada día): issues para empezar que pasan los filtros de Claimable, por lenguaje y por proyecto.

Lo que se promete al mantenedor, en este orden:

1. **No molesta.** Un solo comentario del bot por issue, que se va editando. Nunca asigna ni libera por una frase ambigua.
2. **No se equivoca en contra de nadie.** Nunca libera un issue con un PR abierto o con actividad reciente de quien lo tiene.
3. **Cuesta cero** y no pide permisos fuera del propio repositorio.
4. **Se entiende en un minuto.** Tres órdenes: `/claim`, `/unclaim`, `/claim status`.

## 2. Dónde estamos hoy y qué se medirá

Claimable 0.3.0 está en npm y en el Marketplace como Action de auditoría (`action.yml` en la raíz, `action/main.ts`). Ya sabe leer hilos: `isClaim`, `isRetraction` y `standingClaims` en `src/checks/claimants.ts`, con un corpus etiquetado a mano (`test/claim-corpus.ts`) y 21 issues de verdad-terreno. El sitio (`web/` → `site/`) se publica en Pages.

| Qué se mide | Hoy | Meta |
|---|---|---|
| Acciones equivocadas del bot en el banco de 40 hilos reales reproducidos | sin banco | 0 |
| Comentarios del bot por issue en el banco | sin banco | 1 |
| Órdenes reconocidas en el banco de 120 comentarios (`/claim` y variantes, con citas y bloques de código) | sin banco | 100 %, 0 falsos |
| Proyectos del índice refrescados cada día dentro del límite de la API | 0 | 300, después 1.000, después 3.000 |
| Issues del índice que resultan estar tomados al revisarlos a mano (muestra de 50) | sin índice | 0 |

## 3. Qué es gratis y qué es Pro (decisión cerrada)

**La regla:** gratis para siempre en repositorios públicos, con todas las funciones. De pago, más adelante, para empresas con repositorios privados. La auditoría actual (CLI, Action, web) sigue gratis en todas partes, como hoy.

| Función | Queda en | Por qué |
|---|---|---|
| Bot completo en repositorios públicos: `/claim`, `/unclaim`, estado, avisos, liberación, límites por persona | **Gratis** | Cada proyecto que lo instala lo enseña a sus colaboradores |
| Índice público y sus datos en JSON | **Gratis** | Alcance |
| CLI, Action de auditoría y página web actuales | **Gratis** | Ya lo son |
| Bot en repositorios privados, **modo informe** (dice en el resumen del trabajo qué haría, sin actuar) | **Gratis** | Deja probarlo; no quita nada que hoy exista |
| Bot actuando en repositorios privados | **Pro** | Empresas |
| Informe semanal para el equipo (issues parados, tiempo medio hasta el PR, por persona) | **Pro** | Gestión |
| Reglas por equipo (quién puede reservar qué etiquetas, cupos por equipo) | **Pro** | Empresas |

Precio de referencia, apagado: 8 USD al mes por organización. Mientras Pro esté apagado no hay forma de comprarlo ni se menciona: en un repositorio privado el bot trabaja en modo informe y lo dice en una línea, sin hablar de precios. La clave se comprobará con `license-online.ts` (de `obsidian-dev/tools/pro-license/`) como entrada `license` de la Action. **El código Pro no va en este repositorio público** (regla de Enrique, 2026-11-11): vive en privado (obsidian-dev) y este repo solo deja el punto de enganche, como hace Book Studio con `src/edition.ts`.

Otras decisiones cerradas:

1. **El bot es una Action dentro del mismo repositorio**, en la carpeta `bot/` (`uses: perezamadorluisenrique-gif/claimable/bot@v1`). Sin servidor, sin aplicación de GitHub, sin secretos nuestros. Una ficha propia en el Marketplace exigiría otro repositorio: se decide en el hilo E, con OK.
2. **Sin estado propio.** Todo se deduce del issue: a quién está asignado, la cronología y un marcador oculto en el comentario del bot.
3. **Solo órdenes explícitas actúan.** Una frase como «¿puedo encargarme?» nunca asigna: como mucho, y si el proyecto lo activa, el bot responde una vez con «comenta `/claim` para reservarlo».
4. **Prudente por defecto:** aviso a los 7 días sin actividad, liberación 7 días después del aviso, 2 reservas por persona. Todo configurable.
5. **El índice nunca dice que un issue «está libre»** como hecho: dice «sin señales de estar tomado, comprobado el <fecha>», con el enlace a la evidencia. Regla del repositorio: un filtro jamás puede dar por libre un issue tomado.
6. **Sin IA.** Reglas y patrones probados contra el corpus.
7. **Inglés** en bot, documentación e índice (el público es mundial); el índice tendrá además portada en español.

## 4. Las fases

| Hilo | Fase | Qué entrega | PRs |
|---|---|---|---|
| A | 0 y 1 | Banco de hilos; órdenes; motor de decisiones; la Action; publicar v1 | B0.1, B1.1, B1.2, B1.3, B1.4 |
| B | 2 | Avisos y liberación; configuración; modo informe; 1.1 | B2.1, B2.2, B2.3, B2.4 |
| C | 3 | Índice: presupuesto de API, recolector, sitio con 300 proyectos | I0.1, I1.1, I1.2, I1.3 |
| D | 4 | Índice a 1.000 y 3.000; páginas por lenguaje; insignia | I2.1, I2.2, I2.3 |
| E | 5 | Lanzamiento y adopción | L1, L2, L3 |
| F | 6 | Pro (apagado) | R1, R2 |

Lo que se verá al final de cada hilo:

- **A:** en un repositorio de prueba, `/claim` asigna el issue y deja un comentario claro.
- **B:** un issue reservado y abandonado recibe su aviso y se libera solo.
- **C:** una página pública con los issues libres de 300 proyectos, actualizada cada mañana.
- **D:** 3.000 proyectos y una insignia «N issues libres» que los proyectos pegan en su README.

## 5. Cómo se gana dinero después (apagado hasta que Enrique diga)

El Pro de la sección 3 para organizaciones con repositorios privados. El índice no lleva anuncios ni seguimiento.

## 6. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Un bot que se equivoca molesta en público | Solo órdenes explícitas; banco de hilos reales con cero acciones equivocadas como puerta; un comentario por issue; `dry-run` como primer paso de la guía de instalación |
| Alguien abusa (reserva todo, o libera lo ajeno) | Cupo por persona; `/unclaim` solo para quien lo tiene o para mantenedores; lista de bloqueados en la configuración |
| Seguridad: el flujo se dispara con texto escrito por cualquiera | El texto del comentario llega solo por variables de entorno, nunca interpolado en órdenes; no se hace `checkout` de código ajeno; permisos mínimos (`issues: write`); prueba que vigila el `action.yml` |
| El límite de la API no da para 3.000 proyectos al día | I0.1 lo mide; el índice crece por etapas y rota: cada proyecto se refresca según su actividad |
| El índice enseña un issue tomado | Solo se listan los veredictos VIABLE; muestra manual de 50 antes de cada ampliación; botón «informar de un error» que abre un issue |
| GitHub desactiva el cron tras 60 días sin commits | El trabajo diario hace un commit de datos en la rama `index-data` |
| Rechazo de proyectos a recibir visitas del índice | Archivo de exclusión `index/exclude.txt` y respeto a quien lo pida por issue |

## 7. Lo único que necesita Enrique

- **Nada para empezar:** el repositorio existe y es público (Actions gratis).
- **Una vez, en la laptop, al cerrar el hilo A:** mover la etiqueta `v1` tras publicar (las etiquetas no se pueden mover desde aquí). Se apuntará en `cola-laptop.md`.
- **OK antes de:** anunciar el bot (X, y cualquier mensaje a proyectos ajenos, que además solo puede enviar él), y la ficha propia en el Marketplace si se decide.
- **Nunca se abre un issue ni un PR en un proyecto ajeno** para proponer el bot sin que lo envíe él.

---

## 8. Reglas para quien ejecuta

1. **Una orden de trabajo = un PR,** en el orden de la sección 9. Máximo 5 PRs por hilo.
2. **Antes de cada PR:** `npm run check && npm test && npm run compare && npm run check:docs && npm run build && npm run build:web`, y `npm run demo` si cambia la salida. CI verde antes de fusionar.
3. **Nunca:** editar la verdad-terreno ni las etiquetas del corpus para que cuadren con la herramienta (se añade una `correction` con evidencia); `fetch` directo fuera de `src/github.ts`; dependencias (el paquete no tiene ninguna); TypeScript que no se pueda quitar con `stripTypeScriptTypes` (ni enums ni espacios de nombres); enlaces de claude.ai o de sesión en commits o PRs; saltar o aflojar una prueba.
4. **Las pruebas no tocan la red.** Lo que se pruebe del bot se prueba con casetes, como el resto (`CLAIMABLE_CASSETTE=replay`), y el reloj fijado con `CLAIMABLE_NOW`.
5. **Nunca se prueba el bot contra un repositorio ajeno.** Las pruebas en vivo usan solo un issue de pruebas en el propio repositorio `claimable`, con la etiqueta `bot-sandbox`.
6. **Si una meta numérica no se alcanza:** no se toca la prueba; se apunta en `docs/BOT-PROGRESS.md` y, si la meta es «0 acciones equivocadas», el PR no se fusiona.
7. **Si el mismo check falla dos veces:** parar y pasar la orden al modelo siguiente, en hilo nuevo, con lo aprendido escrito.
8. **Publicar:** subir `version` en `package.json` en un commit y lanzar a mano «Publish to npm». Es un producto ya publicado: no hace falta OK, sí todo en verde.
9. **Las contribuciones dicen en el PR que se hicieron con ayuda de IA** (CONTRIBUTING.md).

Modelo y esfuerzo (regla MODELOS del proyecto):

| Órdenes | Modelo | Esfuerzo | Por qué |
|---|---|---|---|
| B0.1, B1.1, B1.3, B1.4, B2.2, B2.3, B2.4 | Sonnet | medio | Orden clara |
| B1.2, B2.1 | Opus | medio | El motor de decisiones: aquí se evita molestar en público |
| I0.1, I1.1 | Opus | medio | Optimización contra un límite duro |
| I1.2, I1.3, I2.x, L1 a L3, R1, R2 | Sonnet | medio | Orden clara |
| Revisión de seguridad de B1.3 antes de publicar | Opus | alto | Primer release de algo que escribe en repositorios ajenos |
| Etiquetar hilos del banco, leer registros | Haiku, en subagente | bajo | Lectura |

## 9. Órdenes de trabajo

Mapa del código actual, para no explorar: `src/cli.ts` (argumentos), `src/analyze.ts` (`analyze()`, `CHECKS`), `src/types.ts` (`CheckId`, `CHECK_ORDER`), `src/checks/*.ts` (un filtro por archivo), `src/checks/claimants.ts` (`isClaim`, `isRetraction`, `standingClaims`), `src/github.ts` (`api()`, `apiOptional()`, `configure()`, casetes), `src/fetchers.ts` (accesos, `now()`, `daysSince()`), `src/report.ts` (`formatMarkdown`), `action.yml` y `action/main.ts` (Action de auditoría), `web/` y `scripts/build-web.js` (sitio), `test/fixtures/` (casetes).

Arquitectura del bot. Todo lo que decide es puro y no toca la red:

- `src/bot/commands.ts`: `parseCommand(body) → { kind: "claim" | "unclaim" | "status" } | null`.
- `src/bot/state.ts`: `readState(issue, timeline, comments, now) → State` (quién lo tiene, desde cuándo, última actividad suya, PR enlazados, si ya se avisó y cuándo).
- `src/bot/decide.ts`: `decide(event, state, config) → Action[]`, donde `Action` es `assign`, `unassign`, `label`, `unlabel`, `comment` (crear o editar el único comentario) o `none` con motivo.
- `src/bot/apply.ts`: ejecuta las acciones con `api()`; en `dry-run` solo las escribe en el resumen.
- `bot/action.yml` y `bot/main.ts`: la Action.

---

### HILO A: el bot, versión 1

### B0.1 Banco de hilos (Sonnet, medio)

**Pasos:**

1. `test/bot-corpus.ts`: 120 comentarios reales o calcados de reales, etiquetados a mano con la orden que contienen o `null`: `/claim` solo, con texto alrededor, en mayúsculas, dentro de una cita (`> /claim`), dentro de un bloque de código, en mitad de una frase («usa /claim para…»), `/claim` escrito por un bot, `/unclaim`, `/claim status`. Los comentarios de `test/claim-corpus.ts` entran todos como `null` (ninguno es una orden).
2. `test/bot-threads/`: 40 situaciones como archivos JSON (`issue`, `timeline`, `comments`, `event`, `now`, `config` y `expected: Action[]`), escritas a partir de los 21 issues de la verdad-terreno y de casos difíciles: reserva de un issue ya asignado; reserva con PR abierto de otra persona; quien reserva supera el cupo; `/unclaim` de quien no lo tiene; issue cerrado; issue bloqueado por etiqueta; mantenedor que asigna a mano; persona asignada que comenta el día antes de la liberación; PR en borrador enlazado; cuenta borrada.
3. Prueba que comprueba el formato de los dos bancos (todavía sin lógica).

**Hecho cuando:** `npm test` pasa y los recuentos nuevos están en README y CONTRIBUTING (`npm run check:docs -- --fix`).

**PR:** `Add corpora for bot commands and threads`.

### B1.1 Órdenes (Sonnet, medio)

**Pasos:** `src/bot/commands.ts`. Una orden vale solo si es la primera palabra de una línea, fuera de citas, de bloques y de código en línea, y el autor no es un bot (`user.type === "Bot"` o sufijo `[bot]`). Alias: `/claim`, `.take` y `/assign me` para reservar; `/unclaim`, `/release` y `/unassign me` para soltar. Prueba contra los 120 comentarios.

**Hecho cuando:** 120 de 120 y ningún falso positivo.

**PR:** `Parse bot commands`.

### B1.2 Estado y decisiones (Opus, medio)

**Pasos:**

1. `src/bot/state.ts` y `src/bot/decide.ts`, puros. Reglas de `claim`: si el issue está cerrado, bloqueado por etiqueta (reutilizar `blocked-label.ts`) o tiene PR abierto de otra persona, no asigna y lo dice con el enlace; si ya está asignado a otra persona, no asigna y dice a quién y desde cuándo; si quien pide supera el cupo, lo dice con sus issues; si no, asigna, pone la etiqueta `claimed` y deja el comentario de estado. Reglas de `unclaim`: solo quien lo tiene o un mantenedor (`author_association` OWNER, MEMBER o COLLABORATOR).
2. Un único comentario por issue, identificado por el marcador `<!-- claimable-bot:v1 {json} -->`; las acciones siguientes lo editan. El JSON guarda `claimant`, `since`, `nudgedAt`.
3. Texto del comentario en `src/bot/messages.ts`: corto, sin exclamaciones, con las fechas de aviso y liberación y cómo soltarlo. Todos los nombres de usuario y textos ajenos pasan por `mdInline` de `report.ts`.
4. Prueba: las 40 situaciones dan exactamente `expected`.

**Hecho cuando:** 40 de 40.

**PR:** `Decide what the bot does, as pure functions`.

### B1.3 La Action (Sonnet, medio; revisión de seguridad Opus, alto)

**Pasos:**

1. `bot/action.yml` (compuesta, como la actual): entradas `token` (por defecto `github.token`), `dry-run` (`false`), `config` (ruta, por defecto `.github/claimable.yml`). Se dispara con `issue_comment: created` y, desde B2.1, con `schedule`. Las entradas y el evento llegan al código solo por `env:`; ninguna expresión `${{ }}` dentro de `run:` salvo rutas de la propia Action.
2. `bot/main.ts`: lee el evento de `GITHUB_EVENT_PATH`, descarta comentarios en PRs y de bots, obtiene el estado con los accesos de `fetchers.ts` (añadir `getTimeline` si falta, con su casete), llama a `decide` y a `apply`, y escribe el resumen del trabajo.
3. `src/bot/apply.ts`: asignar, desasignar, etiquetar (crea la etiqueta si no existe), comentar o editar. Ante un 403 o 404, lo dice en el resumen y termina en verde: el bot nunca rompe el CI de nadie.
4. `docs/bot.md`: instalación en 15 líneas de YAML con `permissions: issues: write`, primero con `dry-run: true`. Prueba de deriva (`test/bot-action.test.ts`) entre `bot/action.yml`, `bot/main.ts` y `docs/bot.md`, como `test/action.test.ts`.
5. Prueba de extremo a extremo sin red: evento de ejemplo más casetes → acciones esperadas.
6. Revisión de seguridad (Opus, alto) antes de fusionar: inyección por el cuerpo del comentario, por nombres de etiqueta y por el archivo de configuración; permisos; qué pasa en un fork. Los bloqueantes se arreglan en este PR.

**Hecho cuando:** pruebas verdes y, en el issue de pruebas del propio repositorio, `/claim` y `/unclaim` funcionan (enlace al issue en el PR).

**PR:** `Add the claim bot action`.

### B1.4 Publicar la versión 1 del bot (Sonnet, medio)

**Pasos:** el propio repositorio `claimable` instala el bot (`.github/workflows/claim-bot.yml`); sección en el README con el YAML y una captura real; `package.json` a 0.4.0 y «Publish to npm»; línea en `cola-laptop.md` para crear `v0.4.0` y mover `v1`; `npm run demo` y `check:docs -- --fix`.

**Hecho cuando:** 0.4.0 en npm y el bot respondiendo en el repositorio.

**PR:** `Release 0.4.0: the claim bot`.

---

### HILO B: avisos, liberación y configuración

- **B2.1 Avisos y liberación (Opus, medio).** Disparo `schedule` diario: por cada issue abierto con la etiqueta `claimed`, `decide` con el evento `tick`. Actividad de quien lo tiene = comentario suyo en el issue, PR suyo enlazado (abierto o borrador) o commit suyo que mencione el issue. Sin actividad en `nudge-days`: edita el comentario y menciona una sola vez. Sin actividad `release-days` después del aviso y sin PR abierto: desasigna, quita la etiqueta y lo dice. Nunca libera con un PR abierto de esa persona. 12 situaciones más en `test/bot-threads/`. PR: `Nudge stale claims and release them`.
- **B2.2 Configuración (Sonnet, medio).** `.github/claimable.yml`: `nudge-days`, `release-days`, `max-claims`, `labels` (solo se pueden reservar issues con estas etiquetas), `blocked-labels`, `hint-on-natural-claims` (por defecto `false`: con `true`, ante un comentario que `isClaim` reconoce, responde una vez con cómo reservar), `exempt-users`, `messages` (textos propios). Analizador YAML mínimo propio (el paquete no tiene dependencias): solo claves planas, listas y cadenas; lo demás es error claro. Valores inválidos: se usa el valor por defecto y se avisa en el resumen. PR: `Add repository configuration`.
- **B2.3 Modo informe y repositorios privados (Sonnet, medio).** En un repositorio privado sin `license`, o con `dry-run: true`, el bot no actúa: escribe en el resumen qué haría. Una línea lo explica sin precios. Prueba que impide que el modo informe llame a un método que escriba. PR: `Report-only mode`.
- **B2.4 Publicar 1.1 (Sonnet, medio).** Documentación completa, preguntas frecuentes, guía «de `take` casero a Claimable Bot»; 0.5.0. PR: `Release 0.5.0`.

### HILO C: el índice

- **I0.1 Presupuesto de API (Opus, medio).** `index/budget.ts`: mide, con los casetes existentes, cuántas peticiones cuesta `analyze()` por issue con cada filtro; escribe en `docs/INDEX-BUDGET.md` el coste por proyecto y comprueba en la documentación oficial (WebFetch a docs.github.com) el límite por hora del `GITHUB_TOKEN` de Actions para REST y para búsqueda. Diseña la rotación: cada proyecto tiene un `nextCheck` según su actividad (diario si tuvo issues nuevos en 7 días; si no, cada 3 o cada 7 días), y los issues ya analizados se revalidan solo si su `updated_at` cambió. Prueba: simulación de 30 días con 3.000 proyectos sintéticos que nunca supera el 80 % del límite. Si los números no dan para 3.000, el plan dice cuántos caben y el hilo D se ajusta a eso. PR: `Measure the API budget and design the index rotation`.
- **I1.1 Recolector (Opus, medio).** `index/collect.ts`: lee `index/projects.json`, elige qué toca hoy según el presupuesto, lista los issues abiertos con etiquetas de entrada (`good first issue`, `help wanted` y sus variantes), ejecuta `analyze()` y guarda por issue veredicto, evidencias y fecha en `data/<owner>/<repo>.json`, en la rama `index-data`. Se detiene limpio al 80 % del límite y sigue al día siguiente. Solo los VIABLE salen al índice. Flujo `.github/workflows/index.yml` diario, con `concurrency`. PR: `Collect free issues daily within the API budget`.
- **I1.2 Lista de proyectos (Sonnet, medio).** `index/build-projects.ts` genera `index/projects.json` con la API de búsqueda de repositorios: por cada uno de 20 lenguajes, los repositorios con más estrellas que tengan issues abiertos con etiqueta de entrada, actividad en los últimos 90 días y no estén archivados. Primera tanda: 300. `index/exclude.txt` para quien pida no salir. PR: `Generate the project list`.
- **I1.3 El sitio del índice (Sonnet, medio).** `scripts/build-web.js` añade `site/free/`: portada con buscador y filtros por lenguaje y etiqueta (JavaScript mínimo sobre un JSON), una página estática por lenguaje y por proyecto (para buscadores), fecha de comprobación en cada issue, enlace a la evidencia, «informar de un error». Texto fijo: «sin señales de estar tomado, comprobado el…». Portada también en español. Pruebas: un `h1` por página, sin recursos de otros servidores, axe sin fallos; `test/web.test.ts` sigue verde. PR: `Publish the free-issues index`.

### HILO D: escala

- **I2.1 (Sonnet, medio)** Ampliar a 1.000 proyectos tras 7 días de índice estable; revisar a mano una muestra de 50 issues listados (subagente Haiku lee, quien ejecuta decide) y apuntar el resultado; si alguno estaba tomado, se añade a la verdad-terreno y se arregla el filtro antes de ampliar.
- **I2.2 (Sonnet, medio)** Ampliar a 3.000, o al máximo que diga I0.1; `sitemap.xml`; datos descargables en JSON con su licencia.
- **I2.3 (Sonnet, medio)** Insignia: `site/badge/<owner>/<repo>.svg` generada en la construcción («N free issues»), con el fragmento Markdown para el README de cada proyecto en su página del índice.

### HILO E: lanzamiento

- **L1** Vídeo para X de 30 a 45 s grabado del repositorio real (comentar `/claim`, ver la respuesta, ver el aviso), con el texto del post. Publicar solo con OK.
- **L2** Guía «Cómo gestionar los "yo me encargo" en tu proyecto» en el sitio; ficha del catálogo de github.io actualizada.
- **L3** Borradores, para que los envíe Enrique si quiere, de un mensaje corto a 10 proyectos que hoy usan un flujo casero de `/take`. No se envía nada desde aquí. Decisión con OK: ficha propia del bot en el Marketplace (exige repositorio nuevo).

### HILO F: Pro (apagado)

Todo lo de este hilo se construye en privado; aquí solo stubs con la misma forma que no hacen nada.

- **R1 (Sonnet, medio)** Entrada `license`, comprobación con `license-online.ts` en modo de prueba; con clave válida, el bot actúa en repositorios privados.
- **R2 (Sonnet, medio)** Informe semanal en el resumen del trabajo y como issue fijado; reglas por equipo en `claimable.yml`.
