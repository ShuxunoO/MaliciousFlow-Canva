"""Create a self-contained KuCoin canvas from the production build and local v4 sources."""

import argparse
import hashlib
import json
import re
from pathlib import Path


def package(build: Path, graph_file: Path, report_file: Path, destination: Path):
    graph = json.loads(graph_file.read_text(encoding="utf-8"))
    report_bytes = report_file.read_bytes()
    report_digest = hashlib.sha256(report_bytes).hexdigest()
    fingerprints = graph["meta"]["sourceFiles"]
    if not any(Path(item["path"]).name == "report.json" and item["sha256"] == report_digest for item in fingerprints):
        raise ValueError("Rebuild the graph with this version of the v4 report before packaging.")
    report = json.loads(report_bytes)
    views = {
        name: {
            "nodes": [{"id": node["id"], "data": {"layoutColumn": node["data"].get("layoutColumn")}}
                      for node in view["nodes"]],
            "edges": [{"data": {"events": edge["data"]["events"]}} for edge in view["edges"]],
        }
        for name, view in graph["views"].items()
    }
    snapshot = {
        "graph": {"nodes": graph["nodes"], "events": graph["events"], "views": views},
        "report": {"chapters": report["chapters"], "refs": report.get("refs", [])},
    }
    serialized = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    template = (build / "index.html").read_text(encoding="utf-8")
    script_tag = re.compile(r'<script type="module" crossorigin src="/([^"]+)"></script>')
    style_tag = re.compile(r'<link rel="stylesheet" crossorigin href="/([^"]+)">')
    script_match = script_tag.search(template)
    style_match = style_tag.search(template)
    if script_match is None or style_match is None:
        raise ValueError("Build the production canvas with npm run build before packaging.")
    script = (build / script_match[1]).read_text(encoding="utf-8").replace("</script", r"<\/script")
    style = (build / style_match[1]).read_text(encoding="utf-8")
    template = style_tag.sub(lambda _: f"<style>{style}</style>", template, count=1)
    template = script_tag.sub(lambda _: f'<script type="module">{script}</script>', template, count=1)
    body_end = template.rindex("</body>")
    page = template[:body_end] + f'<script type="application/json" id="embedded-case">{serialized}</script>\n' + template[body_end:]
    destination.write_text(page, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", type=Path, default=Path("dist"))
    parser.add_argument("graph", type=Path)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package(args.build, args.graph, args.report, args.output)
