#!/usr/bin/env python3
"""
Extrae el Libro de Horarios de una ficha de circulacion Adif (PDF) a JSON,
en el formato que espera window.RV_HORARIOS (registro.js).

Como funciona
-------------
Cada pagina del PDF esta rotada 90 grados e imprime DOS fichas lado a lado:
una tabla en la mitad "alta" del espacio de coordenadas original (Y grande,
la ficha con el numero de pagina menor), otra en la mitad "baja" (Y
pequenio, pagina siguiente). Cada tabla tiene columnas Bloqueo / VMax /
SitKm / Dependencia / Com / Hora / Tecn / Conc / Radio impresas como texto
girado: la "fila" de cada punto kilometrico corresponde a una franja
estrecha de X, y la "columna" (Com/Hora/etc) a una franja de Y — pero esa
franja de Y esta DESPLAZADA entre la mitad alta y la baja (~435 unidades),
asi que las bandas de columna se localizan por documento buscando las
cabeceras reales de cada mitad, no a base de constantes fijas.

Reglas de negocio (validadas a mano sobre varios anejos de Horario 306/206):
- La "Hora" impresa es la hora de SALIDA en paradas intermedias.
- Una parada es COMERCIAL solo si tiene valor numerico en la columna Com.
  Sin valor en Com = punto tecnico (PCA, BIF., P.T., TUNEL, KM., TASF,
  VIAS...) -> se ignora.
- A veces el valor de Com sale partido en dos tokens de texto (ej. "2" y
  "3" para 23 minutos) por como pymupdf separa palabras. Se concatenan en
  orden Y descendente.
- Si MADRID-P.ATOCHA-ALMUDENA GRANDES aparece como parada intermedia, la
  marcha se parte en dos servicios comerciales (origen->Atocha,
  Atocha->destino), porque ahi cambia el turno de maquinista. La llegada a
  Atocha (hDestino del primer tramo) no viene impresa: se calcula restando
  los minutos de Com a la hora de salida impresa en Atocha.

Uso
---
    python extract_horario.py "ruta\\al\\horario.pdf" -o salida.json
    python extract_horario.py "ruta\\al\\horario.pdf" --marchas 6020,6021
    python extract_horario.py "ruta\\al\\horario.pdf" --list   # solo indice

Requiere: pip install pymupdf
"""
import argparse
import json
import re
import sys

import fitz  # PyMuPDF

import _paths

ATOCHA = "MADRID-P.ATOCHA-ALMUDENA GRANDES"

DOTS_RE = re.compile(r"^\.+$")
NUM_RE = re.compile(r"^\d+$")
HORA_RE = re.compile(r"^\d{1,2}\.\d{2}$")
MARCHA_HDR_RE = re.compile(r"^(\d{4})\.-$")
HEADER_WORDS = {"Bloqueo", "Sit", "Km", "Dependencia", "Com", "Hora", "Conc", "Radio"}


def locate_bands(words):
    """Busca las cabeceras de columna dentro de una mitad de tabla y
    devuelve las bandas Y de Com/Hora/Dependencia para ESA mitad concreta.
    Devuelve None si no encuentra cabeceras (mitad vacia / no es tabla)."""
    pos = {}
    for w in words:
        if w[4] in HEADER_WORDS and w[4] not in pos:
            pos[w[4]] = (w[1], w[3])
    if "Com" not in pos or "Hora" not in pos or "Dependencia" not in pos:
        return None
    com_lo, com_hi = pos["Com"]
    hora_lo, hora_hi = pos["Hora"]
    dep_lo, dep_hi = pos["Dependencia"]
    sitkm_lo = pos["Km"][0] if "Km" in pos else pos["Sit"][0]
    margin = 6
    return {
        "com": (com_lo - margin, com_hi + margin),
        "hora": (hora_lo - margin, hora_hi + margin),
        # la Dependencia real (nombre + puntos de relleno) ocupa desde justo
        # encima de Com hasta justo debajo de Sit/Km
        "dep": (com_hi + margin, sitkm_lo - margin),
    }


def marcha_num_in(words):
    for w in words:
        m = MARCHA_HDR_RE.match(w[4])
        if m:
            return m.group(1)
    return None


def rows_from_half(words, bands):
    """Agrupa palabras de una mitad de tabla en filas (eje X) y clasifica
    cada palabra en Com / Hora / Dependencia segun su banda Y."""
    com_band, hora_band, dep_band = bands["com"], bands["hora"], bands["dep"]
    # Agrupa por proximidad en X (barrido), no por redondeo a rejilla fija:
    # un token puede caer justo al otro lado de un limite de rejilla y
    # separarse de su fila (ej. el digito de "Com") aunque este a <1 unidad
    # del resto de la fila.
    ordered = sorted(((w[0], w[1], w[4]) for w in words), key=lambda t: t[0])
    row_groups = []
    GAP = 4.0
    for x0, y0, txt in ordered:
        if row_groups and x0 - row_groups[-1][-1][0] <= GAP:
            row_groups[-1].append((x0, y0, txt))
        else:
            row_groups.append([(x0, y0, txt)])

    out = []
    for group in row_groups:
        com_tokens, dep_tokens, hora = [], [], None
        for _, y0, txt in group:
            if com_band[0] <= y0 <= com_band[1] and NUM_RE.match(txt):
                com_tokens.append((y0, txt))
            elif hora_band[0] <= y0 <= hora_band[1] and HORA_RE.match(txt):
                hora = txt
            elif dep_band[0] <= y0 <= dep_band[1] and not DOTS_RE.match(txt):
                dep_tokens.append((y0, txt))
        if hora is None:
            continue  # fila sin hora = anotacion (VIAS/TASF/TRANSICION...) o vacia
        dep_tokens.sort(key=lambda t: -t[0])
        com_tokens.sort(key=lambda t: -t[0])
        nombre = " ".join(t for _, t in dep_tokens).strip()
        com = "".join(t for _, t in com_tokens) if com_tokens else None
        h, m = hora.split(".")
        out.append({
            "nombre": nombre,
            "hora": f"{int(h)}:{m}",
            "com": int(com) if com else None,
            "_multi_digit_com": len(com_tokens) > 1,
        })
    return out


def index_halves(doc):
    """Recorre el documento a nivel de MITAD de pagina (no de pagina fitz
    entera) y agrupa en {numero_marcha: [(page_idx, 'a'|'b'), ...]}."""
    halves = []
    for pi in range(doc.page_count):
        pg = doc[pi]
        H = pg.mediabox.height
        words = pg.get_text("words")
        wa = [w for w in words if w[1] > H / 2]
        wb = [w for w in words if w[1] <= H / 2]
        for tag, w in (("a", wa), ("b", wb)):
            num = marcha_num_in(w)
            if num:
                halves.append((num, pi, tag, w))

    marchas = {}
    order = []
    for num, pi, tag, w in halves:
        if num not in marchas:
            marchas[num] = []
            order.append(num)
        marchas[num].append((pi, tag, w))
    return marchas, order


def build_servicios(numero, puntos, warnings):
    if len(puntos) < 2:
        warnings.append(f"{numero}: menos de 2 puntos con hora, no se puede construir servicio")
        return []

    for p in puntos:
        if p["_multi_digit_com"]:
            warnings.append(
                f"{numero}: '{p['nombre']}' a las {p['hora']} tiene Com de varios digitos "
                f"concatenados -> {p['com']} min. Verificar visualmente."
            )

    atocha_idx = None
    for i in range(1, len(puntos) - 1):
        if ATOCHA in puntos[i]["nombre"]:
            atocha_idx = i
            break

    def hora_menos(hora, minutos):
        h, m = (int(p) for p in hora.split(":"))
        total = (h * 60 + m - minutos) % (24 * 60)
        return f"{total // 60}:{total % 60:02d}"

    def tramo(pts):
        origen, destino = pts[0], pts[-1]
        paradas = []
        for p in pts[1:-1]:
            if not p["com"]:
                continue
            parada = {"nombre": p["nombre"], "hora": p["hora"], "tParada": p["com"]}
            if p["_multi_digit_com"]:
                parada["_revisar"] = (
                    f"Com leido como digitos sueltos concatenados ({p['com']} min) - "
                    f"confirmar contra el PDF."
                )
            paradas.append(parada)
        return {
            "servicio": numero,
            "origen": origen["nombre"],
            "destino": destino["nombre"],
            "hSalida": origen["hora"],
            "hDestino": destino["hora"],
            "paradas": paradas,
        }

    if atocha_idx is None:
        return [tramo(puntos)]

    atocha = puntos[atocha_idx]
    if not atocha["com"]:
        warnings.append(
            f"{numero}: MADRID-P.ATOCHA-ALMUDENA GRANDES aparece intermedia pero sin "
            f"minutos de parada (Com) legibles -> no se puede calcular la hora de llegada."
        )
        return [tramo(puntos)]

    s1 = tramo(puntos[: atocha_idx + 1])
    s1["hDestino"] = hora_menos(atocha["hora"], atocha["com"])
    if atocha["_multi_digit_com"]:
        s1["_revisar_hDestino"] = (
            f"Calculado como {atocha['hora']} (salida de Atocha, leida ok) menos "
            f"{atocha['com']} min de parada (Com leido como digitos sueltos concatenados) "
            f"= {s1['hDestino']}. Confirmar los minutos de parada contra el PDF."
        )
    s2 = tramo(puntos[atocha_idx:])
    return [s1, s2]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf", nargs="?", help="por defecto: el unico PDF que haya en tools/pdfs/")
    ap.add_argument("-o", "--out", help="fichero JSON de salida (por defecto tools/out/actual.json)")
    ap.add_argument("--marchas", help="lista de numeros de marcha separados por coma (por defecto: todas)")
    ap.add_argument("--list", action="store_true", help="solo listar las marchas encontradas y salir")
    args = ap.parse_args()

    pdf_path = args.pdf or str(_paths.encontrar_pdf())
    if not args.out and not args.list:
        _paths.OUT_DIR.mkdir(parents=True, exist_ok=True)
        args.out = str(_paths.ACTUAL_JSON)

    doc = fitz.open(pdf_path)
    marchas, order = index_halves(doc)

    if args.list:
        for num in order:
            print(num, "->", len(marchas[num]), "mitad(es)", [(pi, tag) for pi, tag, _ in marchas[num]])
        return

    wanted = set(args.marchas.split(",")) if args.marchas else None
    warnings = []
    servicios = []
    for num in order:
        if wanted and num not in wanted:
            continue
        puntos = []
        for pi, tag, words in marchas[num]:
            bands = locate_bands(words)
            if bands is None:
                warnings.append(f"{num}: no se localizaron cabeceras de columna en pagina {pi+1}{tag}, se ignora esa mitad")
                continue
            puntos.extend(rows_from_half(words, bands))
        # Adif repite la ultima fila de cada pagina como primera fila de la
        # siguiente (para que cada hoja sea autocontenida) -> deduplicar.
        dedup = []
        for p in puntos:
            if dedup and dedup[-1]["nombre"] == p["nombre"] and dedup[-1]["hora"] == p["hora"]:
                continue
            dedup.append(p)
        servicios.extend(build_servicios(num, dedup, warnings))

    resultado = {"servicios": servicios, "avisos": warnings}
    texto = json.dumps(resultado, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(texto)
        print(f"{len(servicios)} servicios, {len(warnings)} avisos -> {args.out}", file=sys.stderr)
    else:
        print(texto)


if __name__ == "__main__":
    main()
