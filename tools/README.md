
1. Copia el PDF nuevo a tools/pdfs/ (solo ese, sin dejar el anterior dentro).

2. Desde PowerShell, en rv-export\tools:

cd "C:\Users\david\Downloads\Proyectos claude\Iryo Studio\rv-export\tools"

python extract_horario.py
python verify_horario.py

3. Si salen "PENDIENTES DE REVISAR" (paradas en Atocha con dígitos raros), revísalos:

python review_avisos.py
python verify_horario.py    # comprobar que ahora sale "Sin errores ni pendientes"


4. Fusionar — aquí está el único cambio, con --force porque es una actualización:

python merge_horario.py --force
Fíjate en el resumen que imprime: ahora dirá "Sobrescritos" en vez de "Descartados" para los servicios que ya existían — es la señal de que está sustituyendo datos viejos por los nuevos, que es lo que quieres.

5. Regenerar data.js:

python build_data_js.py


6. Subir a GitHub (desde rv-export, un nivel arriba de tools):

cd "C:\Users\david\Downloads\Proyectos claude\Iryo Studio\rv-export"
node -e "new Function(require('fs').readFileSync('data.js','utf8'))"
git add horarios.json data.js
git commit -m "feat: actualiza servicios desde NOMBRE-DEL-DOCUMENTO"
git push



# Herramientas del Libro de Horarios

Pipeline para pasar una ficha de circulación de Adif (PDF) a `RV_HORARIOS`
sin usar visión de Claude (mucho más barato en tokens). Un PDF a la vez:
lo pones en `tools/pdfs/` y ningún script pide nombres de fichero, todos
usan por defecto el único PDF de esa carpeta y `tools/out/actual.json`.
Puedes lanzarlos desde `rv-export/` o desde `rv-export/tools/`, da igual.

## 1. Pon el PDF en `tools/pdfs/`

Solo uno. Si hay más de uno, los scripts se paran y te dicen que dejes
solo el que toca procesar. No se sube a GitHub (está en `.gitignore`).

## 2. Extraer

```
python tools/extract_horario.py
```

Opcional: `--marchas 6020,6021` para probar solo algunas antes de lanzarlo
sobre el documento entero. `--list` para ver qué marchas hay en el PDF sin
extraer nada.

## 3. Verificar

```
python tools/verify_horario.py
```

Tres bloques de salida:
- **ERRORES**: datos rotos (horas fuera de orden, campos vacíos...). No
  sigas, hay que mirar esa marcha a mano en el PDF.
- **PENDIENTES DE REVISAR**: campos que el extractor no está seguro de
  haber leído bien (normalmente los minutos de parada en Atocha, que a
  veces salen como dos dígitos sueltos). El script termina con error
  mientras haya alguno — pasa al paso 4 para resolverlos.
- **AVISOS**: cosas para mirar de un vistazo (servicios con horario
  idéntico, nombres de estación parecidos...) pero que no bloquean.

## 4. Resolver los pendientes

```
python tools/review_avisos.py
```

Te enseña, uno a uno, cada campo dudoso con el motivo y el valor que ha
calculado el extractor. Miras esa fila en el PDF y respondes:
- `Enter` → el valor calculado es correcto, se queda como está.
- un número (para minutos de parada) o `H:MM` (para una hora de llegada) →
  lo corrige con ese valor.
- `s` → lo saltas, queda pendiente para otra vez.
- `q` → guarda lo revisado hasta ahora y sale.

Vuelve a lanzar `verify_horario.py` — cuando salga "Sin errores ni
pendientes" ya puedes fusionar.

## 5. Fusionar en el maestro

```
python tools/merge_horario.py
```

Actualiza `horarios.json` (en la raíz de `rv-export`). Rechaza el fichero
si aún tiene pendientes sin resolver (repite el paso 4).

**Importante — dos modos, según si el documento es más nuevo o más viejo
que lo que ya tienes cargado:**
- **Documento histórico** (más viejo que lo ya cargado): comando normal,
  sin flags. Un servicio que YA existe en el maestro NO se sobrescribe, se
  descarta con aviso — así lo viejo nunca pisa lo nuevo.
- **Documento de actualización** (más nuevo, sustituye lo que ya hay):
  añade `--force`. **A partir del documento que falta por procesar ahora
  mismo, el resto de PDF que vayan llegando son actualizaciones** — usa
  `python tools/merge_horario.py --force` con ellos.

## 6. Regenerar data.js

```
python tools/build_data_js.py
```

Reescribe `data.js` entero a partir de `horarios.json`. **No edites
`data.js` a mano** — los cambios se perderían en la siguiente regeneración.
Si necesitas corregir un dato, edita `horarios.json` directamente o vuelve
a fusionar con `--force`.

## 7. Comprobar y subir

```
node -e "new Function(require('fs').readFileSync('data.js','utf8'))"   # sintaxis, desde rv-export/
git add horarios.json data.js
git commit -m "feat: añade servicios del ultimo PDF procesado"
git push
```

Después de subir, puedes borrar el PDF de `tools/pdfs/` (o dejarlo, no se
sube a git) y poner el siguiente cuando llegue.

## Notas de lo que ya sabemos que pasa en estos PDF

- Cada página del PDF trae DOS fichas lado a lado; el extractor ya lo tiene
  en cuenta.
- Adif repite la última fila de una página como primera fila de la
  siguiente — el extractor lo detecta y no la duplica.
- Cuando `MADRID-P.ATOCHA-ALMUDENA GRANDES` es parada intermedia, el
  extractor parte el servicio en dos (cambio de turno de maquinista ahí).
- A veces los minutos de parada en Atocha salen como dos dígitos sueltos
  (ej. "2" y "3" para 23 min) — el extractor los marca como pendientes de
  revisar en vez de darlos por buenos a ciegas (ver paso 4).
- Documentos "refundidos" más antiguos pueden tener horas ligeramente
  distintas (unos minutos) para servicios que ya se hayan actualizado en un
  anejo más reciente — es una diferencia real de horario, no un fallo de
  lectura. Por eso importa el orden en que se fusionan los documentos y el
  modo (histórico vs `--force`) que se use en cada uno.
