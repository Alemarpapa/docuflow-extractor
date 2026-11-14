# 📑 DocuFlow Extractor — evals (versión en español)

*Traducción de la sección nueva "Evals" de [README.md](README.md), para revisión del autor. El resto del README no cambió. El texto oficial es el inglés.*

## Evals: ¿la extracción sigue funcionando después de un cambio?

`npm run eval` puntúa un extractor contra un conjunto dorado de 10 facturas sintéticas (`evals/golden.json`) y muestra la precisión por campo y total. Corre sin conexión (sin red, sin API key), da el mismo resultado siempre, y termina con código 1 cuando la precisión total queda por debajo del umbral, así el CI falla.

**Qué significa "extractor" acá, con honestidad:** el extractor de este repo es un parser determinístico con expresiones regulares. En este proyecto no se llama a ningún LLM. El arnés está hecho para que las salidas de otra versión o de un modelo se guarden como archivo en `evals/recordings/` y se comparen lado a lado, pero por ahora la única corrida grabada es la del propio parser (`heuristic-v1`). Todavía no se evaluó ningún modelo con esto.

Resultado real: 89,2 % (66 de 74 campos), umbral 85 %. La tabla completa está en [README.md](README.md).

**Qué encontró el eval en el parser actual** (sin arreglar todavía, a propósito: el eval está para mostrarlo): completa valores por defecto cuando falta un campo, así que un texto que no es una factura igual vuelve como factura aprobada; solo lee montos con `$` y siempre informa USD; solo lee fechas `AAAA-MM-DD`.

Cómo se usa:

- `npm run eval`: puntúa el código del repo; código 1 si queda bajo el umbral.
- `npm run eval -- --verbose`: además lista cada campo errado.
- `npm run eval -- --record mi-etiqueta`: guarda las salidas actuales en `evals/recordings/mi-etiqueta.json`.
- `npm run eval -- --gate mi-etiqueta`: aplica el umbral a una corrida grabada.
- `EVAL_THRESHOLD=0.95 npm run eval`: cambia el umbral (por defecto 0.85).

Para comparar otra versión o un modelo: generar un objeto de salida por cada id del conjunto dorado (o `null` si no devuelve factura), guardarlos como `evals/recordings/<etiqueta>.json` con la misma forma que `heuristic-v1.json`, y correr `npm run eval`. La tabla suma una columna.

Límites: 10 casos es un conjunto chico; detecta regresiones en estos patrones, no calidad general. Los campos de texto deben coincidir exacto (sin espacios de borde). Los ítems se comparan solo por cantidad. Un campo que acierta de casualidad igual cuenta como acierto (en `euro-currency` el parser no lee el ítem real y agrega uno por defecto, así que `item_count` coincide).
