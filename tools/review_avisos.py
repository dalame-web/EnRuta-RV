#!/usr/bin/env python3
"""
Revisa uno a uno los campos que extract_horario.py ha marcado como dudosos
(columna Com leida como digitos sueltos concatenados) y deja que confirmes
o corrijas cada uno contra el PDF, en vez de tener que editar el JSON a
mano. Modifica el fichero EN SITIO.

Uso:
    python review_avisos.py                    # tools/out/actual.json
    python review_avisos.py tools/out/NOMBRE.json

Para cada aviso te ensena el servicio, la parada (o la hora de llegada a
Atocha) y el motivo, y te pregunta:
    [Enter]      -> el dato es correcto tal cual, se queda como esta
    <numero>     -> minutos de parada correctos (paradas) -- los sustituye
    <H:MM>       -> hora correcta (llegada a Atocha) -- la sustituye
    s            -> saltar, lo dejas pendiente para otra vez
    q            -> guardar lo revisado hasta ahora y salir
"""
import json
import re
import sys

import _paths

HORA_RE = re.compile(r"^\d{1,2}:\d{2}$")


def preguntar(mensaje):
    try:
        return input(mensaje).strip()
    except EOFError:
        return "q"


def main():
    if len(sys.argv) > 2:
        print("uso: python review_avisos.py [salida.json]  (por defecto: tools/out/actual.json)", file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1] if len(sys.argv) == 2 else str(_paths.ACTUAL_JSON)
    data = json.load(open(path, encoding="utf-8"))
    servicios = data["servicios"] if isinstance(data, dict) else data

    pendientes = []
    for s in servicios:
        if "_revisar_hDestino" in s:
            pendientes.append(("hDestino", s, None))
        for p in s.get("paradas", []):
            if "_revisar" in p:
                pendientes.append(("parada", s, p))

    if not pendientes:
        print("Nada que revisar en este fichero.")
        return

    print(f"{len(pendientes)} campo(s) dudoso(s) para revisar.\n")
    revisados = 0
    for tipo, s, p in pendientes:
        print("-" * 70)
        print(f"Servicio {s['servicio']}  ({s['origen']} -> {s['destino']})")
        if tipo == "hDestino":
            print(f"Llegada a MADRID-P.ATOCHA-ALMUDENA GRANDES (hDestino de este tramo): {s['hDestino']}")
            print("Motivo:", s["_revisar_hDestino"])
            resp = preguntar("¿Correcto? [Enter=si / H:MM=corrige / s=saltar / q=salir]: ")
            if resp.lower() == "q":
                break
            if resp.lower() == "s":
                continue
            if resp == "":
                del s["_revisar_hDestino"]
                revisados += 1
                continue
            if HORA_RE.match(resp):
                s["hDestino"] = resp
                del s["_revisar_hDestino"]
                revisados += 1
            else:
                print("  no reconocido como H:MM, lo dejo pendiente.")
        else:
            print(f"Parada: {p['nombre']} a las {p['hora']}, tParada actual = {p['tParada']} min")
            print("Motivo:", p["_revisar"])
            resp = preguntar("¿Correcto? [Enter=si / numero=corrige minutos / s=saltar / q=salir]: ")
            if resp.lower() == "q":
                break
            if resp.lower() == "s":
                continue
            if resp == "":
                del p["_revisar"]
                revisados += 1
                continue
            if resp.isdigit():
                p["tParada"] = int(resp)
                del p["_revisar"]
                revisados += 1
            else:
                print("  no reconocido como numero, lo dejo pendiente.")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    restantes = sum(
        1 for s in servicios
        if "_revisar_hDestino" in s or any("_revisar" in p for p in s.get("paradas", []))
    )
    print("-" * 70)
    print(f"\n{revisados} revisado(s). {restantes} servicio(s) con algo aun pendiente.")
    if restantes:
        print("Vuelve a lanzar este script cuando quieras seguir revisando los pendientes.")


if __name__ == "__main__":
    main()
