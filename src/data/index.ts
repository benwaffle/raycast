import avps from "./avps.json";
import diameter from "./diameter.json";
import gtp from "./gtp.json";
import interfaces from "./interfaces.json";
import nfs from "./nfs.json";

export const CATEGORIES = ["Diameter Command", "GTP Command", "Interface", "Network Function", "AVP"] as const;

export type Category = (typeof CATEGORIES)[number];

export interface EnumValue {
  code: string;
  name: string;
}

export interface Entry {
  category: Category;
  abbrev: string;
  name: string;
  code?: string;
  protocol?: string;
  vendor?: string;
  type?: string;
  family?: string;
  interfaces?: string[];
  spec?: string;
  related?: string[];
  summary?: string;
  enums?: EnumValue[];
  keywords?: string[];
}

// Diameter/GTP/AVP are generated from Wireshark dictionaries (see
// scripts/generate-data.py); interfaces and network functions are curated.
export const ENTRIES: Entry[] = [
  ...(diameter as unknown as Entry[]),
  ...(gtp as unknown as Entry[]),
  ...(interfaces as unknown as Entry[]),
  ...(nfs as unknown as Entry[]),
  ...(avps as unknown as Entry[]),
];

/** Search tokens for an entry, fed to Raycast's list filtering as keywords. */
export function searchKeywords(e: Entry): string[] {
  const parts: string[] = [];
  parts.push(...e.abbrev.split(/[\s/]+/));
  parts.push(e.abbrev.replace(/\s*\/\s*/g, "")); // joined form, e.g. "ULRULA"
  parts.push(...e.name.split(/\s+/));
  if (e.code) parts.push(...e.code.split(/[\s/]+/));
  if (e.interfaces) parts.push(...e.interfaces);
  if (e.related) parts.push(...e.related);
  if (e.vendor) parts.push(e.vendor);
  if (e.family) parts.push(e.family);
  if (e.protocol) parts.push(e.protocol);
  if (e.keywords) parts.push(...e.keywords);
  return Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean)));
}
