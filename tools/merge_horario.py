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
import re
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

    # Horario (206/306...) al que pertenece este documento, por su nombre de fichero.
    m = re.search(r"(\d{3})-\d{3}-\d{2}", entrada.get("documento", ""))
    horario = m.group(1) if m else None

    def con_etiqueta(s, previas):
        """Anota en cada servicio de que Horario(s) viene, para poder detectar
        mas tarde marchas que un documento deja de incluir."""
        etiquetas = set(previas) | ({horario} if horario else set())
        if etiquetas:
            s["_horarios"] = sorted(etiquetas)
        return s

    anadidos, sobrescritos, descartados = [], [], []
    for s in nuevos:
        key = leg_key(s)
        if key in indice:
            viejo = maestro[indice[key]]
            if args.force:
                maestro[indice[key]] = con_etiqueta(s, viejo.get("_horarios", []))
                sobrescritos.append(key)
            else:
                con_etiqueta(viejo, viejo.get("_horarios", []))
                descartados.append(key)
            continue
        indice[key] = len(maestro)
        maestro.append(con_etiqueta(s, []))
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

    # Contraste con la Relacion de marchas del documento (no borra nada, solo avisa).
    if horario and entrada.get("relacion"):
        rel = set(entrada["relacion"])
        en_maestro = {s["servicio"] for s in maestro}
        posibles = {}
        for s in maestro:
            et = s.get("_horarios", [])
            if horario in et and s["servicio"] not in rel:
                posibles[s["servicio"]] = et
        faltan = sorted(rel - en_maestro)
        print(f"\nContraste con la Relacion de marchas del Horario {horario} ({len(rel)} marchas):", file=sys.stderr)
        if posibles:
            print(f"  POSIBLES ANULADAS ({len(posibles)}): estan en el maestro como Horario {horario} pero este documento ya no las lista.", file=sys.stderr)
            for n, et in sorted(posibles.items()):
                otras = [x for x in et if x != horario]
                print(f"    ! {n}" + (f"  (tambien en Horario {', '.join(otras)})" if otras else ""), file=sys.stderr)
            print("    No se ha borrado nada: quitalas de horarios.json a mano si confirmas que estan anuladas.", file=sys.stderr)
        else:
            print("  Sin marchas sobrantes en el maestro.", file=sys.stderr)
        if faltan:
            print(f"  FALTAN EN EL MAESTRO ({len(faltan)}): {', '.join(faltan)} (listadas en la relacion pero sin servicio).", file=sys.stderr)
        else:
            print("  Sin marchas de la relacion que falten en el maestro.", file=sys.stderr)


if __name__ == "__main__":
    main()
