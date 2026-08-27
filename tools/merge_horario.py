#!/usr/bin/env python3
"""
Fusiona el JSON de un documento (salida de extract_horario.py, ya pasado
por verify_horario.py) dentro del Libro de Horarios maestro (horarios.json
en la raiz de rv-export).

Prioridad: por defecto, un servicio (numero+origen+destino) que YA existe en
el maestro NO se sobrescribe -- se descarta con un aviso. Eso es lo que
quieres para documentos HISTORICOS (mas viejos que lo que ya tienes
cargado). Para documentos de ACTUALIZACION (mas nuevos, deben sustituir lo
que ya hay) usa --force.

Rechaza fusionar un fichero que aun tenga campos '_revisar'/'_revisar_hDestino'
sin resolver -- pasa antes por review_avisos.py.

Uso:
    python merge_horario.py                                       # tools/out/actual.json, historico
    python merge_horario.py --force                                # actualizacion, sustituye
    python merge_horario.py tools/out/NOMBRE.json --maestro ..\\horarios.json
"""
import argparse
import json
import sys
from pathlib import Path

import _paths


def leg_key(s):
    return (s["servicio"], s["origen"], s["destino"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json_entrada", nargs="?", help="por defecto: tools/out/actual.json")
    ap.add_argument("--maestro", default=str(_paths.MAESTRO), help="ruta al horarios.json maestro")
    ap.add_argument("--force", action="store_true", help="sobrescribe servicios ya existentes en vez de descartarlos")
    args = ap.parse_args()
    args.json_entrada = args.json_entrada or str(_paths.ACTUAL_JSON)

    entrada = json.load(open(args.json_entrada, encoding="utf-8"))
    nuevos = entrada["servicios"]

    sin_revisar = [
        s["servicio"] for s in nuevos
        if "_revisar_hDestino" in s or any("_revisar" in p for p in s.get("paradas", []))
    ]
    if sin_revisar:
        print(
            f"ABORTADO: {len(sin_revisar)} servicio(s) con campos '_revisar' sin resolver "
            f"({', '.join(sorted(set(sin_revisar)))}). Ejecuta review_avisos.py sobre "
            f"{args.json_entrada} primero.",
            file=sys.stderr,
        )
        sys.exit(1)

    maestro_path = Path(args.maestro)
    if maestro_path.exists():
        maestro = json.load(open(maestro_path, encoding="utf-8"))
    else:
        maestro = []

    indice = {leg_key(s): i for i, s in enumerate(maestro)}

    anadidos, sobrescritos, descartados = [], [], []
    for s in nuevos:
        key = leg_key(s)
        if key in indice:
            if args.force:
                maestro[indice[key]] = s
                sobrescritos.append(key)
            else:
                descartados.append(key)
            continue
        indice[key] = len(maestro)
        maestro.append(s)
        anadidos.append(key)

    maestro.sort(key=lambda s: (s["servicio"], s["origen"]))

    with open(maestro_path, "w", encoding="utf-8") as f:
        json.dump(maestro, f, ensure_ascii=False, indent=2)

    print(f"Anadidos: {len(anadidos)}", file=sys.stderr)
    for k in anadidos:
        print("  +", k, file=sys.stderr)
    if sobrescritos:
        print(f"Sobrescritos (--force): {len(sobrescritos)}", file=sys.stderr)
        for k in sobrescritos:
            print("  ~", k, file=sys.stderr)
    if descartados:
        print(f"Descartados (ya existian, usa --force para sobrescribir): {len(descartados)}", file=sys.stderr)
        for k in descartados:
            print("  -", k, file=sys.stderr)
    print(f"\n{maestro_path} ahora tiene {len(maestro)} servicios.", file=sys.stderr)


if __name__ == "__main__":
    main()
