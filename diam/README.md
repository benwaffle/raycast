# 4G/5G Reference

A Raycast extension for quickly looking up mobile-core protocol terms by abbreviation.

Search across:

- **Diameter commands** — `ULA`, `ASR`, `CCR`, `AIR`, `ECR` … (S6a/S6d, S13, Cx/Dx, Sh, Gx/Gy/Rx, SLg/SLh, Sy, S6t, T6a, SGd/S6c, plus the RFC 6733/4006/4072/7155 base).
- **GTP commands** — `CSR`, `DSR`, `MBR`, `DDN` … (GTPv2-C, GTPv1-C, GTP-U).
- **Interfaces / reference points** — `S6a`, `S11`, `Gx`, `N6`, `N4`, `N26`, the 5G service-based interfaces (`Namf`, `Nsmf`, …), and more.
- **AVPs** — every standards-based Diameter AVP (`RAT-Type`, `Subscription-Id`, `Result-Code`, `AMBR`, …) with code, vendor, type and enumerated values.
- **Network functions / nodes** — 5G NFs (`AMF`, `SMF`, `UPF`, `UDM`, …) and EPC/IMS nodes (`MME`, `HSS`, `PGW`, `P-CSCF`, …).

Each result shows the definition, the protocol, the command/AVP code, the associated interface(s) and the spec reference. Filter by category with the dropdown, and toggle the detail panel with `⌘D`.

Typing a number looks entries up by code: exact command/AVP code matches first (`280` → DWR/DWA and the Proxy-Host AVP), then codes it prefixes, then enumerated values (`5003` → Result-Code / DIAMETER_AUTHORIZATION_REJECTED).

## Where the data comes from

Numeric codes and official names are not hand-typed — they are extracted from
[Wireshark's protocol dictionaries](https://gitlab.com/wireshark/wireshark) (which encode the IETF/3GPP specs):

- Diameter commands + AVPs → `resources/protocols/diameter/*.xml`
- GTPv2-C message types → `epan/dissectors/packet-gtpv2.c`
- GTPv1-C / GTP-U message types → `epan/dissectors/packet-gtp.c` + `packet-gtp.h`

The 3-letter Diameter command abbreviations (`ULR`, `ECR`, …) are irregular and
not structured in Wireshark, so they are curated in
`scripts/curated/diameter-commands.json`; the generator looks each command's
code up in the parsed dictionary and fails if it is missing, so the curated
codes are validated against the spec source. Interfaces and network functions
have no numeric codes and are curated directly in `src/data/interfaces.json`
and `src/data/nfs.json`.

### Regenerating

```sh
python3 scripts/generate-data.py            # uses a local cache if present
python3 scripts/generate-data.py --refresh  # re-download the Wireshark sources
npm run fix-lint                            # format the curated files
```

This rewrites `src/data/diameter.json`, `src/data/gtp.json` and
`src/data/avps.json` (these three are listed in `.prettierignore` so the
generator's output is the source of truth and produces no formatting churn).

## Development

```sh
npm install
npm run dev    # load into Raycast
npm run build
npm run lint
```
