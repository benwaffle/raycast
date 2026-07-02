import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useMemo, useState } from "react";
import { CATEGORIES, Category, Entry, ENTRIES, EnumValue, searchKeywords } from "./data";

const CATEGORY_META: Record<Category, { icon: Icon; color: Color; short: string }> = {
  "Diameter Command": { icon: Icon.Bolt, color: Color.Purple, short: "Diameter" },
  "GTP Command": { icon: Icon.Plug, color: Color.Blue, short: "GTP" },
  Interface: { icon: Icon.Link, color: Color.Green, short: "Interface" },
  "Network Function": { icon: Icon.Box, color: Color.Magenta, short: "NF" },
  AVP: { icon: Icon.Tag, color: Color.Orange, short: "AVP" },
};

function detailMarkdown(e: Entry): string {
  let md = `# ${e.abbrev}\n`;
  if (e.name && e.name !== e.abbrev) md += `\n**${e.name}**\n`;
  if (e.summary) md += `\n${e.summary}\n`;
  if (e.enums && e.enums.length > 0) {
    md += `\n## Values\n\n| Code | Name |\n| ---: | :--- |\n`;
    for (const v of e.enums) md += `| ${v.code} | ${v.name} |\n`;
  }
  return md;
}

function EntryDetail({ entry }: { entry: Entry }) {
  const M = List.Item.Detail.Metadata;
  const ifaces = entry.interfaces ?? [];
  const related = entry.related ?? [];
  return (
    <List.Item.Detail
      markdown={detailMarkdown(entry)}
      metadata={
        <M>
          <M.Label title="Category" text={entry.category} icon={CATEGORY_META[entry.category].icon} />
          {entry.code ? <M.Label title="Code" text={entry.code} /> : null}
          {entry.protocol ? (
            <M.TagList title="Protocol">
              <M.TagList.Item text={entry.protocol} color={Color.SecondaryText} />
            </M.TagList>
          ) : null}
          {entry.type ? <M.Label title="Type" text={entry.type} /> : null}
          {entry.vendor ? <M.Label title="Vendor" text={entry.vendor} /> : null}
          {entry.family ? <M.Label title="Family" text={entry.family} /> : null}
          {ifaces.length > 0 ? (
            <M.TagList title="Interfaces">
              {ifaces.map((i) => (
                <M.TagList.Item key={i} text={i} color={Color.Green} />
              ))}
            </M.TagList>
          ) : null}
          {entry.spec ? <M.Label title="Reference" text={entry.spec} /> : null}
          {related.length > 0 ? (
            <M.TagList title="Related">
              {related.map((r) => (
                <M.TagList.Item key={r} text={r} color={Color.SecondaryText} />
              ))}
            </M.TagList>
          ) : null}
        </M>
      }
    />
  );
}

interface PreparedEntry {
  entry: Entry;
  keywords: string[];
}

/** Numeric code tokens of an entry; GTP codes can be compound ("16 / 17"). */
function codeParts(e: Entry): string[] {
  return e.code ? e.code.split(/[\s/]+/).filter(Boolean) : [];
}

interface CodeMatches {
  exact: PreparedEntry[];
  prefix: PreparedEntry[];
  enums: { prepared: PreparedEntry; value: EnumValue }[];
}

export default function Command() {
  const [category, setCategory] = useState<string>("all");
  const [showingDetail, setShowingDetail] = useState(true);
  const [searchText, setSearchText] = useState("");

  const prepared = useMemo<PreparedEntry[]>(
    () => ENTRIES.map((entry) => ({ entry, keywords: searchKeywords(entry) })),
    [],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { entry } of prepared) c[entry.category] = (c[entry.category] ?? 0) + 1;
    return c;
  }, [prepared]);

  // An all-digits query is a code lookup: exact command/AVP code matches first,
  // then codes the query is a prefix of, then enumerated values (e.g. 5003 ->
  // Result-Code). Any other query falls through to Raycast's native filtering.
  const codeQuery = useMemo(() => {
    const q = searchText.trim();
    return /^\d+$/.test(q) ? q : null;
  }, [searchText]);

  const codeMatches = useMemo<CodeMatches | null>(() => {
    if (!codeQuery) return null;
    const exact: PreparedEntry[] = [];
    const prefix: PreparedEntry[] = [];
    const enums: CodeMatches["enums"] = [];
    for (const p of prepared) {
      if (category !== "all" && p.entry.category !== category) continue;
      const parts = codeParts(p.entry);
      if (parts.includes(codeQuery)) {
        exact.push(p);
      } else if (parts.some((c) => c.startsWith(codeQuery))) {
        prefix.push(p);
      } else {
        const value = p.entry.enums?.find((v) => v.code === codeQuery);
        if (value) enums.push({ prepared: p, value });
      }
    }
    const lowestCode = (e: Entry) => Math.min(...codeParts(e).map(Number));
    prefix.sort((a, b) => lowestCode(a.entry) - lowestCode(b.entry));
    return { exact, prefix, enums };
  }, [codeQuery, prepared, category]);

  const visibleCategories = category === "all" ? CATEGORIES : (CATEGORIES.filter((c) => c === category) as Category[]);

  function renderItem({ entry, keywords }: PreparedEntry, key: string, subtitleOverride?: string) {
    const meta = CATEGORY_META[entry.category];
    const accessories: List.Item.Accessory[] = [];
    if (entry.interfaces && entry.interfaces.length > 0) {
      const first = entry.interfaces[0];
      const extra = entry.interfaces.length - 1;
      accessories.push({ tag: { value: extra > 0 ? `${first} +${extra}` : first, color: Color.Green } });
    }
    if (entry.code) accessories.push({ text: entry.code });
    accessories.push({ tag: { value: meta.short, color: meta.color } });

    return (
      <List.Item
        key={key}
        icon={{ source: meta.icon, tintColor: meta.color }}
        title={entry.abbrev}
        subtitle={subtitleOverride ?? (showingDetail ? undefined : entry.name)}
        keywords={keywords}
        accessories={showingDetail ? undefined : accessories}
        detail={showingDetail ? <EntryDetail entry={entry} /> : undefined}
        actions={
          <ActionPanel>
            <Action.CopyToClipboard title="Copy Abbreviation" content={entry.abbrev} />
            <Action.CopyToClipboard
              title="Copy Name"
              content={entry.name}
              shortcut={{ modifiers: ["cmd"], key: "." }}
            />
            {entry.code ? (
              <Action.CopyToClipboard
                title="Copy Code"
                content={entry.code}
                shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
              />
            ) : null}
            <Action
              title="Toggle Details"
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={() => setShowingDetail((v) => !v)}
            />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isShowingDetail={showingDetail}
      filtering={!codeMatches}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search by abbreviation, name, interface, code… (CSR, ULA, S6a, 280, RAT-Type)"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by category" value={category} onChange={setCategory} storeValue>
          <List.Dropdown.Item title="All categories" value="all" icon={Icon.MagnifyingGlass} />
          {CATEGORIES.map((c) => (
            <List.Dropdown.Item key={c} title={`${c} (${counts[c] ?? 0})`} value={c} icon={CATEGORY_META[c].icon} />
          ))}
        </List.Dropdown>
      }
    >
      {codeMatches ? (
        <>
          {codeMatches.exact.length > 0 ? (
            <List.Section title={`Code ${codeQuery}`} subtitle={`${codeMatches.exact.length}`}>
              {codeMatches.exact.map((p, i) => renderItem(p, `exact-${i}`))}
            </List.Section>
          ) : null}
          {codeMatches.prefix.length > 0 ? (
            <List.Section title={`Code starting with ${codeQuery}`} subtitle={`${codeMatches.prefix.length}`}>
              {codeMatches.prefix.map((p, i) => renderItem(p, `prefix-${i}`))}
            </List.Section>
          ) : null}
          {codeMatches.enums.length > 0 ? (
            <List.Section title={`Enumerated value ${codeQuery}`} subtitle={`${codeMatches.enums.length}`}>
              {codeMatches.enums.map(({ prepared: p, value }, i) =>
                renderItem(p, `enum-${i}`, `${codeQuery} = ${value.name}`),
              )}
            </List.Section>
          ) : null}
        </>
      ) : (
        visibleCategories.map((cat) => {
          const items = prepared.filter((p) => p.entry.category === cat);
          return (
            <List.Section key={cat} title={cat} subtitle={`${items.length}`}>
              {items.map((p, i) => renderItem(p, `${cat}-${i}`))}
            </List.Section>
          );
        })
      )}
    </List>
  );
}
