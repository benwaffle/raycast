import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useMemo, useState } from "react";
import { CATEGORIES, Category, Entry, ENTRIES, searchKeywords } from "./data";

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

export default function Command() {
  const [category, setCategory] = useState<string>("all");
  const [showingDetail, setShowingDetail] = useState(true);

  const prepared = useMemo<PreparedEntry[]>(
    () => ENTRIES.map((entry) => ({ entry, keywords: searchKeywords(entry) })),
    [],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { entry } of prepared) c[entry.category] = (c[entry.category] ?? 0) + 1;
    return c;
  }, [prepared]);

  const visibleCategories = category === "all" ? CATEGORIES : (CATEGORIES.filter((c) => c === category) as Category[]);

  return (
    <List
      isShowingDetail={showingDetail}
      searchBarPlaceholder="Search by abbreviation, name, interface, code… (CSR, ULA, S6a, N6, RAT-Type)"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter by category" value={category} onChange={setCategory} storeValue>
          <List.Dropdown.Item title="All categories" value="all" icon={Icon.MagnifyingGlass} />
          {CATEGORIES.map((c) => (
            <List.Dropdown.Item key={c} title={`${c} (${counts[c] ?? 0})`} value={c} icon={CATEGORY_META[c].icon} />
          ))}
        </List.Dropdown>
      }
    >
      {visibleCategories.map((cat) => {
        const items = prepared.filter((p) => p.entry.category === cat);
        return (
          <List.Section key={cat} title={cat} subtitle={`${items.length}`}>
            {items.map(({ entry, keywords }, i) => {
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
                  key={`${cat}-${i}`}
                  icon={{ source: meta.icon, tintColor: meta.color }}
                  title={entry.abbrev}
                  subtitle={showingDetail ? undefined : entry.name}
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
            })}
          </List.Section>
        );
      })}
    </List>
  );
}
