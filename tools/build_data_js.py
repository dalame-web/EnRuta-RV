#!/usr/bin/env python3
"""
Regenera data.js a partir del horarios.json maestro.

Uso:
    python build_data_js.py
    python build_data_js.py --maestro ..\\horarios.json --out ..\\data.js
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DEFAULT_MAESTRO = HERE / "horarios.json"
DEFAULT_OUT = HERE / "data.js"

CABECERA = """/* EnRuta-RV — data.js (GENERADO, no editar a mano)
 * Libro de Horarios: expone window.RV_HORARIOS directamente, extraido de
 * las fichas de circulacion Adif. Este fichero se genera con
 * tools/build_data_js.py a partir de horarios.json — para cambiar datos,
 * edita horarios.json (via tools/merge_horario.py) y vuelve a generar.
 */
(function () {
  'use strict';

  window.RV_HORARIOS = """


def js_string(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def servicio_a_js(s, indent="    "):
    lines = [indent + "{"]
    lines.append(f"{indent}  servicio: {js_string(s['servicio'])},")
    lines.append(f"{indent}  origen: {js_string(s['origen'])},")
    lines.append(f"{indent}  destino: {js_string(s['destino'])},")
    lines.append(f"{indent}  hSalida: {js_string(s['hSalida'])},")
    lines.append(f"{indent}  hDestino: {js_string(s['hDestino'])},")
    if s["paradas"]:
        lines.append(f"{indent}  paradas: [")
        for p in s["paradas"]:
            lines.append(
                f"{indent}    {{ nombre: {js_string(p['nombre'])}, hora: {js_string(p['hora'])}, tParada: {p['tParada']} }},"
            )
        lines.append(f"{indent}  ]")
    else:
        lines.append(f"{indent}  paradas: []")
    lines.append(indent + "}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--maestro", default=str(DEFAULT_MAESTRO))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()

    maestro = json.load(open(args.maestro, encoding="utf-8"))

    cuerpo = ",\n".join(servicio_a_js(s) for s in maestro)
    js = CABECERA + "[\n" + cuerpo + "\n  ];\n})();\n"

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)

    print(f"{len(maestro)} servicios -> {args.out}")


if __name__ == "__main__":
    main()
