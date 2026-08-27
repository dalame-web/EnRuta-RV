#!/usr/bin/env python3
"""
Audita el JSON producido por extract_horario.py antes de confiar en el.
No corrige nada — solo senala problemas para que un humano decida.

Uso:
    python verify_horario.py salida.json

Salida: tres bloques.
  ERRORES  - datos con muchas papeletas de estar mal (parada fuera de
             orden cronologico, campos vacios, minutos absurdos...).
             Sale con exit code 1 si hay alguno.
  AVISOS   - cosas raras pero posiblemente legitimas (parada de 1 o mas de
             15 minutos, dos servicios con horario identico...) revisar a
             ojo antes de dar por bueno.
  INFO     - resumen (numero de servicios, estaciones distintas...).
"""
import json
import sys
from difflib import SequenceMatcher

import _paths


def hhmm_to_min(hora):
    h, m = hora.split(":")
    return int(h) * 60 + int(m)


def similar(a, b):
    return SequenceMatcher(None, a, b).ratio()


def main():
    if len(sys.argv) > 2:
        print("uso: python verify_horario.py [salida.json]  (por defecto: tools/out/actual.json)", file=sys.stderr)
        sys.exit(2)

    ruta = sys.argv[1] if len(sys.argv) == 2 else str(_paths.ACTUAL_JSON)
    data = json.load(open(ruta, encoding="utf-8"))
    servicios = data["servicios"]
    errores, avisos, info, pendientes = [], [], [], []

    estaciones = set()
    firmas = {}  # (hSalida,hDestino,tuple(paradas)) -> [servicio,...]

    for s in servicios:
        tag = f"{s['servicio']} ({s['origen']} -> {s['destino']})"

        if "_revisar_hDestino" in s:
            pendientes.append(f"{tag}: hDestino sin confirmar -> {s['_revisar_hDestino']}")
        for p in s.get("paradas", []):
            if "_revisar" in p:
                pendientes.append(f"{tag}: parada '{p.get('nombre')}' sin confirmar -> {p['_revisar']}")

        for campo in ("servicio", "origen", "destino", "hSalida", "hDestino"):
            if not s.get(campo):
                errores.append(f"{tag}: campo '{campo}' vacio")

        if s.get("origen") == s.get("destino"):
            errores.append(f"{tag}: origen y destino son la misma estacion")

        estaciones.add(s.get("origen", ""))
        estaciones.add(s.get("destino", ""))

        try:
            t_prev = hhmm_to_min(s["hSalida"])
        except Exception:
            errores.append(f"{tag}: hSalida '{s.get('hSalida')}' no tiene formato H:MM")
            continue

        secuencia = [("origen " + s["origen"], t_prev)]
        for p in s.get("paradas", []):
            estaciones.add(p.get("nombre", ""))
            if not p.get("nombre") or p.get("hora") is None or p.get("tParada") is None:
                errores.append(f"{tag}: parada con campo vacio -> {p}")
                continue
            try:
                t = hhmm_to_min(p["hora"])
            except Exception:
                errores.append(f"{tag}: hora de parada '{p['hora']}' en {p['nombre']} no tiene formato H:MM")
                continue
            if t < t_prev:
                # puede ser paso de medianoche legitimo, solo si es la ultima marcha del dia
                errores.append(
                    f"{tag}: '{p['nombre']}' a las {p['hora']} es ANTERIOR a la parada previa "
                    f"({secuencia[-1][0]} a las {secuencia[-1][1]//60}:{secuencia[-1][1]%60:02d}) "
                    f"-> orden cronologico roto, revisar."
                )
            if p["tParada"] <= 0:
                errores.append(f"{tag}: '{p['nombre']}' tiene tParada={p['tParada']} (deberia ser > 0)")
            elif p["tParada"] > 15:
                avisos.append(f"{tag}: '{p['nombre']}' tiene una parada larga ({p['tParada']} min) - confirmar que no es un artefacto de extraccion")
            secuencia.append((p["nombre"], t))
            t_prev = t

        try:
            t_dest = hhmm_to_min(s["hDestino"])
            if t_dest < t_prev:
                avisos.append(
                    f"{tag}: hDestino ({s['hDestino']}) es anterior a la ultima parada "
                    f"-> revisar si el trayecto cruza medianoche o si hay un error de lectura."
                )
        except Exception:
            errores.append(f"{tag}: hDestino '{s.get('hDestino')}' no tiene formato H:MM")

        nombres_parada = [p.get("nombre") for p in s.get("paradas", [])]
        if len(nombres_parada) != len(set(nombres_parada)):
            errores.append(f"{tag}: hay una estacion repetida dentro de paradas[]")

        firma = (s.get("hSalida"), s.get("hDestino"), tuple(p.get("hora") for p in s.get("paradas", [])))
        firmas.setdefault(firma, []).append(s["servicio"])

    # servicios distintos con horario identico -> aviso, no error (puede ser legitimo,
    # ya lo vimos con 6013/6015 en el Horario 306)
    for firma, nums in firmas.items():
        distintos = sorted(set(nums))
        if len(distintos) > 1:
            avisos.append(f"Servicios {', '.join(distintos)} comparten horario identico -> confirmar que no es un copia-pega del extractor.")

    # nombres de estacion parecidos pero no iguales -> posible typo de lectura
    lista_estaciones = sorted(e for e in estaciones if e)
    for i, a in enumerate(lista_estaciones):
        for b in lista_estaciones[i + 1:]:
            r = similar(a, b)
            if 0.85 <= r < 1.0:
                avisos.append(f"Nombres de estacion parecidos pero no identicos: '{a}' vs '{b}' (similitud {r:.2f}) -> comprobar que no es un typo de OCR/lectura.")

    for a in data.get("avisos", []):
        avisos.append("[extractor] " + a)

    info.append(f"{len(servicios)} servicios, {len(lista_estaciones)} estaciones distintas")

    def bloque(titulo, items):
        print(f"\n=== {titulo} ({len(items)}) ===")
        for it in items:
            print("-", it)

    bloque("ERRORES", errores)
    bloque("PENDIENTES DE REVISAR (usa review_avisos.py)", pendientes)
    bloque("AVISOS", avisos)
    bloque("INFO", info)

    if errores:
        print(f"\n{len(errores)} ERROR(ES) — no uses este JSON tal cual, hay que revisarlos antes.", file=sys.stderr)
        sys.exit(1)
    if pendientes:
        print(
            f"\n{len(pendientes)} campo(s) pendiente(s) de confirmar. Ejecuta "
            f"'python review_avisos.py' antes de fusionar — merge_horario.py "
            f"rechazara este fichero mientras queden pendientes.",
            file=sys.stderr,
        )
        sys.exit(1)
    print("\nSin errores ni pendientes. Revisa igualmente los AVISOS antes de dar el JSON por bueno.", file=sys.stderr)


if __name__ == "__main__":
    main()
