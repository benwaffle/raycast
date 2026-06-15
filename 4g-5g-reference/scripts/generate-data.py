#!/usr/bin/env python3
"""Generate the reference dataset for the 4G/5G reference Raycast extension.

Numeric codes and official names are pulled from Wireshark's protocol
dictionaries (which encode the IETF/3GPP specs) so nothing is transcribed from
memory:

  * Diameter commands + AVPs  -> resources/protocols/diameter/*.xml
  * GTPv2-C message types      -> epan/dissectors/packet-gtpv2.c
  * GTPv1-C / GTP-U msg types  -> epan/dissectors/packet-gtp.c (+ packet-gtp.h)

Diameter commands need their 3-letter abbreviations (CSR, ULA, ECR ...) which
are irregular and not structured in Wireshark, so those are curated in
scripts/curated/diameter-commands.json. Each curated command carries the
command code; this script looks that code up in the parsed Wireshark
dictionary and fails loudly if it is missing -- so the curated codes are
validated against the spec source rather than trusted blindly.

Interfaces (S6a, N6 ...) and network functions (AMF, UPF ...) have no numeric
codes and are not in Wireshark; they are curated directly as final data files
(src/data/interfaces.json, src/data/nfs.json) and are not touched here.

Output: src/data/diameter.json, src/data/gtp.json, src/data/avps.json
Run:    python3 scripts/generate-data.py [--refresh]
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
CURATED = ROOT / "scripts" / "curated"
OUT = ROOT / "src" / "data"

WS = "https://raw.githubusercontent.com/wireshark/wireshark/master"
DIAM_DIR = f"{WS}/resources/protocols/diameter"
SOURCES = {
    "dictionary.xml": f"{DIAM_DIR}/dictionary.xml",
    "TGPP.xml": f"{DIAM_DIR}/TGPP.xml",
    "nasreq.xml": f"{DIAM_DIR}/nasreq.xml",
    "eap.xml": f"{DIAM_DIR}/eap.xml",
    "chargecontrol.xml": f"{DIAM_DIR}/chargecontrol.xml",
    "sip.xml": f"{DIAM_DIR}/sip.xml",
    "packet-gtpv2.c": f"{WS}/epan/dissectors/packet-gtpv2.c",
    "packet-gtp.c": f"{WS}/epan/dissectors/packet-gtp.c",
    "packet-gtp.h": f"{WS}/epan/dissectors/packet-gtp.h",
}
# Standards-based Diameter dictionaries we parse AVPs from (skip vendor files).
DIAM_AVP_FILES = ["dictionary.xml", "TGPP.xml", "nasreq.xml", "eap.xml", "chargecontrol.xml", "sip.xml"]


def fetch(refresh: bool) -> dict[str, str]:
    CACHE.mkdir(parents=True, exist_ok=True)
    text: dict[str, str] = {}
    for name, url in SOURCES.items():
        path = CACHE / name
        if refresh or not path.exists():
            print(f"  download {name}", file=sys.stderr)
            with urllib.request.urlopen(url) as resp:
                path.write_bytes(resp.read())
        text[name] = path.read_text(encoding="utf-8", errors="replace")
    return text


# --------------------------------------------------------------------------
# Diameter XML parsing
# --------------------------------------------------------------------------

# Drop the external-entity DOCTYPE and any &include; references so stdlib
# ElementTree (which will not resolve external entities) can parse the files.
_DOCTYPE = re.compile(r"<!DOCTYPE.*?\]>", re.DOTALL)
_XMLDECL = re.compile(r"<\?xml.*?\?>", re.DOTALL)
_ENTREF = re.compile(r"&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_][\w.-]*;")


def _clean(xml: str) -> str:
    xml = _DOCTYPE.sub("", xml)
    return _ENTREF.sub("", xml)


def _root(name: str, xml: str) -> ET.Element:
    """Return a parseable root element for a dictionary file.

    dictionary.xml is a well-formed <dictionary> document; the other files are
    XML fragments with several top-level <application> elements, so they get
    wrapped in a synthetic root.
    """
    xml = _clean(xml)
    if name == "dictionary.xml":
        return ET.fromstring(xml)
    return ET.fromstring("<frag>" + _XMLDECL.sub("", xml) + "</frag>")


def parse_vendors(xml: str) -> dict[str, dict]:
    root = _root("dictionary.xml", xml)
    out = {}
    for v in root.iter("vendor"):
        out[v.get("vendor-id")] = {"code": int(v.get("code")), "name": v.get("name") or v.get("vendor-id")}
    return out


def _avp_type(avp: ET.Element) -> str:
    t = avp.find("type")
    if t is not None and t.get("type-name"):
        return t.get("type-name")
    if avp.find("grouped") is not None:
        return "Grouped"
    return "Unknown"


def parse_diameter(text: dict[str, str]):
    """Return (commands_by_code, avps) parsed from the dictionaries."""
    vendors = parse_vendors(text["dictionary.xml"])
    cmds: dict[int, set[str]] = {}
    avps: dict[tuple[int, int], dict] = {}

    for fname in DIAM_AVP_FILES:
        root = _root(fname, text[fname])
        # Walk one level of containers to attach a human "source" label.
        containers = []
        if fname == "dictionary.xml":
            base = root.find("base")
            if base is not None:
                containers.append(("Diameter Base", base))
            for app in root.findall("application"):
                containers.append((app.get("name") or "Diameter", app))
        else:
            for app in root.findall("application"):
                containers.append((app.get("name") or fname, app))

        for source, container in containers:
            for c in container.findall("command"):
                cmds.setdefault(int(c.get("code")), set()).add(c.get("name"))
            for a in container.findall("avp"):
                code = int(a.get("code"))
                vtok = a.get("vendor-id") or "None"
                vinfo = vendors.get(vtok, {"code": 0, "name": "IETF"})
                vnum = 0 if vtok == "None" else vinfo["code"]
                vname = "IETF / Base" if vtok == "None" else vinfo["name"]
                key = (code, vnum)
                if key in avps:
                    continue
                enums = [{"code": e.get("code"), "name": e.get("name")} for e in a.findall("enum")]
                avps[key] = {
                    "category": "AVP",
                    "abbrev": a.get("name"),
                    "name": a.get("name"),
                    "code": str(code),
                    "protocol": "Diameter",
                    "vendor": f"{vname} ({vnum})",
                    "type": _avp_type(a),
                    "spec": source,
                    "summary": a.get("description") or "",
                    "enums": enums,
                }
    return cmds, avps


def build_diameter(cmds_by_code: dict[int, set[str]]):
    curated = json.loads((CURATED / "diameter-commands.json").read_text())
    entries = []
    missing = []
    for c in curated:
        code = c["code"]
        names = cmds_by_code.get(code)
        if not names:
            missing.append(f"{c['req']}/{c['ans']} code {code}")
            continue
        # Prefer the curated display name if given, else Wireshark's, minus the 3GPP- prefix.
        canonical = c.get("name") or sorted(names, key=len)[0]
        display = re.sub(r"^3GPP-", "", canonical)
        entries.append(
            {
                "category": "Diameter Command",
                "abbrev": f"{c['req']} / {c['ans']}",
                "name": display,
                "code": str(code),
                "protocol": "Diameter",
                "interfaces": c.get("interfaces", []),
                "spec": c.get("spec"),
                "summary": c.get("summary", ""),
                # Request/Answer expansions and the bare 3-letter forms, for search.
                "related": [f"{display}-Request", f"{display}-Answer"],
                "keywords": [c["req"], c["ans"], display, display.replace("-", " ")],
            }
        )
    if missing:
        raise SystemExit("Diameter commands not found in Wireshark dictionary: " + ", ".join(missing))
    entries.sort(key=lambda e: e["abbrev"])
    return entries


# --------------------------------------------------------------------------
# GTP message-type parsing
# --------------------------------------------------------------------------

_SKIP = re.compile(r"reserved|for future use|unknown|allocated in earlier", re.IGNORECASE)
# A value_string row: { <code-or-MACRO> , "Name" }  with an optional trailing comment.
_ROW = re.compile(r'\{\s*([A-Za-z0-9_]+)\s*,\s*"([^"]+)"\s*\}\s*(?:,)?\s*(?:/\*(.*?)\*/)?')
_IFACE = re.compile(r"\bS\d+[\w/]*|\bSv\b|\bSm\b|\bSn\b")


def _extract_table(src: str, symbol: str) -> str:
    m = re.search(r"value_string\s+" + re.escape(symbol) + r"\[\]\s*=\s*\{", src)
    if not m:
        raise SystemExit(f"table {symbol} not found")
    start = m.end()
    depth = 1
    i = start
    while i < len(src) and depth:
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
        i += 1
    return src[start : i - 1]


def _gtp_defines(header: str) -> dict[str, int]:
    out = {}
    for name, val in re.findall(r"#define\s+(GTP_MSG_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", header):
        out[name] = int(val, 0)
    return out


def _rows(table: str, defines: dict[str, int]):
    """Yield (code, name, interfaces). Interfaces come from a row's trailing
    comment, falling back to the most recent standalone section comment (the
    Wireshark source brackets message groups with e.g. /* ... (S5/S8, S11) */)."""
    section = ""
    for line in table.splitlines():
        stripped = line.strip()
        only_comment = re.fullmatch(r"/\*(.*?)\*/", stripped, re.DOTALL)
        if only_comment:
            section = only_comment.group(1)
            continue
        m = _ROW.search(line)
        if not m:
            continue
        tok, name, trailing = m.group(1), m.group(2), m.group(3) or ""
        if _SKIP.search(name):
            continue
        if tok.isdigit():
            code = int(tok)
        elif tok in defines:
            code = defines[tok]
        else:
            continue
        ifaces = sorted(set(_IFACE.findall(trailing))) or sorted(set(_IFACE.findall(section)))
        yield code, name.strip(), ifaces


def _initials(name: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name)
    return "".join(w[0].upper() for w in words)


def _pair_name(req: str, resp: str) -> str:
    """'Create Session Request' + 'Create Session Response' -> 'Create Session Request / Response'."""
    rw, sw = req.split(), resp.split()
    i = 0
    while i < len(rw) and i < len(sw) and rw[i] == sw[i]:
        i += 1
    tail = " ".join(sw[i:])
    return f"{req} / {tail}" if tail else f"{req} / {resp}"


def _pair_gtp(rows, protocol_for, spec_for):
    """Pair request/response-style messages into single entries."""
    by_name = {name: (code, ifaces) for code, name, ifaces in rows}
    order = list(by_name)
    lower_to_name = {n.lower(): n for n in order}
    used: set[str] = set()
    entries = []

    # Wireshark mixes "Request"/"request" casing between GTPv2 and GTPv1, so
    # pair case-insensitively and resolve back to the real names.
    def response_of(name: str):
        ln = name.lower()
        cands = []
        if ln.endswith(" request"):
            cands.append(ln[: -len(" request")] + " response")
        if ln.endswith(" command"):
            cands.append(ln[: -len(" command")] + " failure indication")
        if ln.endswith(" notification"):
            base = ln[: -len(" notification")]
            cands += [ln + " acknowledgement", ln + " acknowledge", ln + " ack",
                      base + " acknowledge", base + " acknowledgement"]
        for cand in cands:
            real = lower_to_name.get(cand)
            if real and real not in used:
                return real
        return None

    for name in order:
        if name in used:
            continue
        is_request = name.lower().endswith((" request", " command", " notification"))
        resp = response_of(name) if is_request else None
        code, ifaces = by_name[name]
        if resp:
            rcode, rifaces = by_name[resp]
            ifaces = sorted(set(ifaces) | set(rifaces))
            used.update({name, resp})
            entries.append({
                "abbrev": _initials(name),
                "name": _pair_name(name, resp),
                "code": f"{code} / {rcode}",
                "protocol": protocol_for(code),
                "interfaces": ifaces,
                "spec": spec_for(code),
                "related": [name, resp],
                "keywords": [_initials(name), _initials(resp), name, resp],
            })
        else:
            used.add(name)
            entries.append({
                "abbrev": _initials(name),
                "name": name,
                "code": str(code),
                "protocol": protocol_for(code),
                "interfaces": ifaces,
                "spec": spec_for(code),
                "related": [],
                "keywords": [_initials(name), name],
            })
    return entries


def build_gtp(text: dict[str, str]):
    entries = []

    # GTPv2-C (TS 29.274) -- numeric literals.
    v2 = list(_rows(_extract_table(text["packet-gtpv2.c"], "gtpv2_message_type_vals"), {}))
    for e in _pair_gtp(v2, lambda c: "GTPv2-C", lambda c: "3GPP TS 29.274"):
        e["category"] = "GTP Command"
        entries.append(e)

    # GTPv1-C / GTP-U (TS 29.060 / 29.281) -- macros resolved from the header.
    defines = _gtp_defines(text["packet-gtp.h"])
    v1 = list(_rows(_extract_table(text["packet-gtp.c"], "gtp_message_type"), defines))

    def v1_proto(code):
        return "GTP-U" if code in (254, 255) else "GTPv1-C"

    def v1_spec(code):
        return "3GPP TS 29.281" if code in (254, 255) else "3GPP TS 29.060"

    for e in _pair_gtp(v1, v1_proto, v1_spec):
        e["category"] = "GTP Command"
        entries.append(e)

    entries.sort(key=lambda e: (e["protocol"], e["abbrev"]))
    return entries


def main():
    refresh = "--refresh" in sys.argv
    text = fetch(refresh)
    OUT.mkdir(parents=True, exist_ok=True)

    cmds, avps = parse_diameter(text)
    diameter = build_diameter(cmds)
    gtp = build_gtp(text)
    avp_list = sorted(avps.values(), key=lambda a: (a["vendor"], a["name"]))

    (OUT / "diameter.json").write_text(json.dumps(diameter, indent=2) + "\n")
    (OUT / "gtp.json").write_text(json.dumps(gtp, indent=2) + "\n")
    (OUT / "avps.json").write_text(json.dumps(avp_list, indent=2) + "\n")

    print(f"diameter commands: {len(diameter)}")
    print(f"gtp messages:      {len(gtp)}")
    print(f"avps:              {len(avp_list)}")


if __name__ == "__main__":
    main()
