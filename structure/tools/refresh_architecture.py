"""Re-make the 3D viewer's architecture and site layers without re-running the analysis (seconds, not minutes):
after a change to the windows, the layouts or the facade rules.

    python3 structure/tools/refresh_architecture.py                  # structure/out/viewer-data.json
    LEX_PRIVATE=1 python3 structure/tools/refresh_architecture.py    # structure/private/out/viewer-data.json

The structure layer and the results stay as the last run.py left them.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lexstruct.building import PRIVATE, ROOT, Building, private_on  # noqa: E402
from lexstruct.export import architecture_layer  # noqa: E402


def main():
    path = ((PRIVATE / "out") if private_on() else (ROOT / "out")) / "viewer-data.json"
    data = json.loads(path.read_text())
    arch = architecture_layer(Building())
    data["layers"]["other"]["site"] = arch.pop("site", None)
    data["layers"]["architecture"] = arch
    path.write_text(json.dumps(data, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    rep = arch.get("facade", {})
    print(f"{path}: {len(arch['walls'])} wall pieces, {len(arch['windows'])} windows, {len(arch['lights'])} downlights")
    for k, v in rep.items():
        print(f"  floor {k}: {v}")


if __name__ == "__main__":
    main()
