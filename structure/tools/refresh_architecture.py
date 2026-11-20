"""Re-make the 3D viewer's architecture, site and below-ground layers without re-running the analysis (seconds, not
minutes): after a change to the windows, the layouts, the facade rules or the basement.

    python3 structure/tools/refresh_architecture.py                  # structure/out/viewer-data.json
    LEX_PRIVATE=1 python3 structure/tools/refresh_architecture.py    # structure/private/out/viewer-data.json

The analysis and its results stay as the last run.py left them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lexstruct.building import PRIVATE, ROOT, Building, private_on  # noqa: E402
from lexstruct.export import architecture_layer, below_ground_layer  # noqa: E402


def main():
    path = ((PRIVATE / "out") if private_on() else (ROOT / "out")) / "viewer-data.json"
    data = json.loads(path.read_text())
    b = Building()
    arch = architecture_layer(b)
    data["layers"]["other"]["site"] = arch.pop("site", None)
    data["layers"]["structure"]["below"] = below_ground_layer(b)
    data["layers"]["architecture"] = arch
    path.write_text(json.dumps(data, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    rep = arch.get("facade", {})
    print(f"{path}: {len(arch['walls'])} wall pieces, {len(arch['windows'])} windows, {len(arch['lights'])} downlights")
    for k, v in rep.items():
        print(f"  floor {k}: {v}")


if __name__ == "__main__":
    main()
