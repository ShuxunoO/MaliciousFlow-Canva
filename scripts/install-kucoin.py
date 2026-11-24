"""Install the data embedded in a KuCoin offline export as a workspace asset."""

import argparse
import json
import re
from pathlib import Path


def install(archive: Path, destination: Path) -> None:
    page = archive.read_text(encoding="utf-8")
    embedded = re.search(r'<script type="application/json" id="embedded-case">(.+?)</script>', page, re.DOTALL)
    if not embedded:
        raise ValueError("The offline archive has no embedded case.")
    data = json.loads(embedded[1])
    if not data["graph"]["nodes"] or not data["graph"]["events"] or not data["report"]["chapters"]:
        raise ValueError("The archive is missing KuCoin transactions or report chapters.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(embedded[1], encoding="utf-8")
    temporary.replace(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public/cases/kucoin-2020.json")
    args = parser.parse_args()
    install(args.archive, args.output)
