import { Cache, Color, Icon, MenuBarExtra, open, openCommandPreferences } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const STATUSLINE_CACHE_DIR = "/tmp/claude";

type Window = { key: string; label: string; percent: number; resetsAt?: string };
// Usage credits (pay-as-you-go spend past the plan limits). Amounts are in minor
// units (cents for USD); `exponent` is the number of minor digits.
type Credits = { usedMinor: number; limitMinor?: number; currency: string; exponent: number };
type Parsed = { windows: Window[]; credits?: Credits };
type Usage = Parsed & { stale: boolean };

type ApiLimit = {
  kind: string;
  percent: number;
  resets_at?: string;
  scope?: { model?: { display_name?: string } } | null;
};

function limitLabel(l: ApiLimit): string {
  if (l.kind === "session") return "Session (5h)";
  if (l.kind === "weekly_all") return "Weekly (all models)";
  const model = l.scope?.model?.display_name;
  if (model) return `Weekly (${model})`;
  return l.kind.replace(/_/g, " ");
}

function parseUsage(data: Record<string, unknown>): Window[] {
  // Modern shape: a `limits` array with per-scope entries (session, weekly_all,
  // weekly_scoped per model).
  const limits = data.limits as ApiLimit[] | undefined;
  if (Array.isArray(limits) && limits.length > 0) {
    return limits.map((l) => ({
      key: `${l.kind}:${l.scope?.model?.display_name ?? ""}`,
      label: limitLabel(l),
      percent: l.percent,
      resetsAt: l.resets_at,
    }));
  }
  // Legacy shape (also what the statusline cache holds): top-level window objects.
  const windows: Window[] = [];
  const legacyLabels: Record<string, string> = { five_hour: "Session (5h)", seven_day: "Weekly (all models)" };
  for (const key of Object.keys(legacyLabels)) {
    const w = data[key] as { utilization?: number; resets_at?: string } | null;
    if (w && typeof w.utilization === "number") {
      windows.push({ key, label: legacyLabels[key], percent: w.utilization, resetsAt: w.resets_at });
    }
  }
  return windows;
}

type ApiMoney = { amount_minor: number; currency?: string; exponent?: number };
type ApiSpend = { enabled?: boolean; used?: ApiMoney | null; limit?: ApiMoney | null };
type ApiExtraUsage = {
  is_enabled?: boolean;
  used_credits?: number | null;
  monthly_limit?: number | null;
  currency?: string;
  decimal_places?: number;
};

function parseCredits(data: Record<string, unknown>): Credits | undefined {
  // Modern shape: a `spend` object with structured money amounts.
  const spend = data.spend as ApiSpend | undefined;
  if (spend && spend.enabled && spend.used) {
    return {
      usedMinor: spend.used.amount_minor,
      limitMinor: spend.limit?.amount_minor,
      currency: spend.used.currency ?? "USD",
      exponent: spend.used.exponent ?? 2,
    };
  }
  // Legacy shape: `extra_usage` with flat minor-unit numbers.
  const extra = data.extra_usage as ApiExtraUsage | undefined;
  if (extra && extra.is_enabled && typeof extra.used_credits === "number") {
    return {
      usedMinor: extra.used_credits,
      limitMinor: extra.monthly_limit ?? undefined,
      currency: extra.currency ?? "USD",
      exponent: extra.decimal_places ?? 2,
    };
  }
  return undefined;
}

function parseAll(data: Record<string, unknown>): Parsed {
  return { windows: parseUsage(data), credits: parseCredits(data) };
}

// Several accounts can hold a "Claude Code-credentials" item (stale provisioner/root
// entries); the current user's is the live one.
async function keychainToken(): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-s",
    "Claude Code-credentials",
    "-a",
    userInfo().username,
    "-w",
  ]);
  const token = JSON.parse(stdout).claudeAiOauth?.accessToken;
  if (!token) throw new Error("no OAuth token in keychain");
  return token;
}

const ownCache = new Cache();
const OWN_CACHE_KEY = "last-good-usage";
const CACHE_FRESH_SEC = 300;

function readOwnCache(): (Parsed & { ageSec: number }) | undefined {
  try {
    const raw = ownCache.get(OWN_CACHE_KEY);
    if (!raw) return undefined;
    const { at, data } = JSON.parse(raw) as { at: number; data: Record<string, unknown> };
    const parsed = parseAll(data);
    return parsed.windows.length ? { ...parsed, ageSec: (Date.now() - at) / 1000 } : undefined;
  } catch {
    return undefined;
  }
}

// Read-only bootstrap fallback: the usage cache written by the Claude Code
// statusline script. Its mtime is unreliable (the script touches it as a lock),
// so it is only trusted when nothing else is available.
async function statuslineCache(): Promise<Parsed | undefined> {
  try {
    const names = (await readdir(STATUSLINE_CACHE_DIR)).filter((n) =>
      n.startsWith("statusline-usage-cache-"),
    );
    let newest: { path: string; mtime: number } | undefined;
    for (const n of names) {
      const p = `${STATUSLINE_CACHE_DIR}/${n}`;
      const s = await stat(p);
      if (!newest || s.mtimeMs > newest.mtime) newest = { path: p, mtime: s.mtimeMs };
    }
    if (!newest) return undefined;
    const parsed = parseAll(JSON.parse(await readFile(newest.path, "utf8")));
    return parsed.windows.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The usage endpoint rate-limits aggressively, so a last-good local cache is
// served while fresh; the API is only called once the cache ages out, and
// failures fall back to the cache marked stale.
async function fetchUsage(): Promise<Usage> {
  const cached = readOwnCache();
  if (cached && cached.ageSec < CACHE_FRESH_SEC) {
    return { windows: cached.windows, credits: cached.credits, stale: false };
  }
  try {
    const token = await keychainToken();
    const resp = await fetch(USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        // The endpoint only answers clients that identify as Claude Code
        "User-Agent": "claude-code/2.1.34",
      },
    });
    const data = (await resp.json()) as Record<string, unknown>;
    const parsed = parseAll(data);
    if (!resp.ok || data.error || parsed.windows.length === 0) throw new Error("bad response");
    ownCache.set(OWN_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
    return { ...parsed, stale: false };
  } catch {
    if (cached) return { windows: cached.windows, credits: cached.credits, stale: true };
    const bootstrap = await statuslineCache();
    if (bootstrap) return { ...bootstrap, stale: true };
    throw new Error("usage fetch failed and no local cache found");
  }
}

function pctColor(pct: number): Color {
  if (pct >= 90) return Color.Red;
  if (pct >= 70) return Color.Orange;
  return Color.Green;
}

function resetText(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hours = (d.getTime() - Date.now()) / 3_600_000;
  const when = d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return ` — resets ${when} (${hours < 1 ? `${Math.max(0, Math.round(hours * 60))}m` : `${Math.round(hours)}h`})`;
}

function money(minor: number, c: Credits, fractionDigits = c.exponent): string {
  return (minor / 10 ** c.exponent).toLocaleString([], {
    style: "currency",
    currency: c.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function creditsText(c: Credits): string {
  const used = money(c.usedMinor, c);
  if (c.limitMinor === undefined) return `Usage credits: ${used}`;
  const pct = c.limitMinor > 0 ? Math.round((c.usedMinor / c.limitMinor) * 100) : 0;
  return `Usage credits: ${used} of ${money(c.limitMinor, c)} (${pct}%)`;
}

function creditsPctColor(c: Credits): Color {
  if (c.limitMinor === undefined || c.limitMinor <= 0) return Color.SecondaryText;
  return pctColor((c.usedMinor / c.limitMinor) * 100);
}

// Compact one-letter prefixes so the windows are tellable-apart in the menu bar.
function titlePrefix(w: Window): string {
  if (w.key.startsWith("session")) return "";
  if (w.key.startsWith("weekly_all")) return "w";
  return (w.key.split(":")[1]?.[0] ?? "?").toUpperCase();
}

export default function Command() {
  const { data, isLoading, error, revalidate } = useCachedPromise(fetchUsage, [], {
    keepPreviousData: true,
  });

  const windows = data?.windows ?? [];
  const credits = data?.credits;
  const title = windows.length
    ? [
        ...windows.map((w) => `${titlePrefix(w)}${Math.round(w.percent)}%`),
        ...(credits ? [money(credits.usedMinor, credits, 0)] : []),
      ].join(" ") + (data?.stale ? " (cached)" : "")
    : error
      ? "⚠︎"
      : "…";

  return (
    <MenuBarExtra icon="claude-menubar.png" title={title} isLoading={isLoading}>
      {windows.map((w) => (
        <MenuBarExtra.Item
          key={w.key}
          icon={{ source: w.key.startsWith("session") ? Icon.Gauge : Icon.Calendar, tintColor: pctColor(w.percent) }}
          title={`${w.label}: ${w.percent}%${resetText(w.resetsAt)}`}
        />
      ))}
      {credits && (
        <MenuBarExtra.Item
          icon={{ source: Icon.Coins, tintColor: creditsPctColor(credits) }}
          title={creditsText(credits)}
        />
      )}
      {error && windows.length === 0 && <MenuBarExtra.Item icon={Icon.Warning} title={String(error.message)} />}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          icon={Icon.Globe}
          title="Open Usage Settings"
          onAction={() => open("https://claude.ai/settings/usage")}
        />
        <MenuBarExtra.Item icon={Icon.ArrowClockwise} title="Refresh" onAction={() => revalidate()} />
        <MenuBarExtra.Item
          icon={Icon.Gear}
          title="Configure Refresh Interval"
          onAction={() => openCommandPreferences()}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
