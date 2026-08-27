"""Rutas compartidas por los scripts del pipeline de horarios.

Todo relativo a la carpeta tools/ (no al directorio desde el que se lance
el script), y con auto-deteccion del PDF/JSON "actual" para no tener que
escribir nombres de fichero: se trabaja con un PDF a la vez en pdfs/.
"""
import sys
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
PDFS_DIR = TOOLS_DIR / "pdfs"
OUT_DIR = TOOLS_DIR / "out"
MAESTRO = TOOLS_DIR.parent / "horarios.json"
DATA_JS = TOOLS_DIR.parent / "data.js"
ACTUAL_JSON = OUT_DIR / "actual.json"


def encontrar_pdf():
    """Devuelve la ruta del unico PDF en pdfs/, o aborta con un mensaje claro."""
    PDFS_DIR.mkdir(parents=True, exist_ok=True)
    pdfs = sorted(PDFS_DIR.glob("*.pdf"))
    if not pdfs:
        sys.exit(f"No hay ningun PDF en {PDFS_DIR}. Copia ahi el documento y vuelve a lanzar el script.")
    if len(pdfs) > 1:
        nombres = "\n".join(f"  - {p.name}" for p in pdfs)
        sys.exit(
            f"Hay {len(pdfs)} PDF en {PDFS_DIR}, solo se procesa uno a la vez:\n{nombres}\n"
            f"Deja solo el que quieras procesar (mueve o borra los demas)."
        )
    return pdfs[0]
