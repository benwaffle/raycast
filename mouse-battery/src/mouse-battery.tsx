import { Icon, MenuBarExtra, openCommandPreferences } from "@raycast/api";
import { useExec } from "@raycast/utils";
import { Reading, SCRIPT, UV, hasReading, parse } from "./logi";

function batteryIcon(r: Reading): Icon {
  if (r.state === "charging") return Icon.BatteryCharging;
  if (r.percent === undefined) return Icon.BatteryDisabled;
  return Icon.Battery;
}

export default function Command() {
  const { data, isLoading, revalidate } = useExec(
    UV,
    ["run", "--with", "hidapi", "python3", SCRIPT],
    { keepPreviousData: true },
  );

  const readings = parse(data);
  const devices = readings.filter(hasReading);
  const primary = devices[0];

  const title = primary?.percent !== undefined
    ? `${primary.percent}%${primary.state === "charging" ? "⚡" : ""}`
    : "–";

  return (
    <MenuBarExtra icon={primary ? batteryIcon(primary) : Icon.BatteryDisabled} title={title} isLoading={isLoading}>
      {devices.map((r) => (
        <MenuBarExtra.Item
          key={r.index}
          icon={batteryIcon(r)}
          title={`${r.name}: ${r.percent !== undefined ? `${r.percent}%` : `${r.millivolts} mV`} (${r.state})`}
        />
      ))}
      {devices.length === 0 && (
        <MenuBarExtra.Item
          icon={Icon.QuestionMark}
          title={readings[0]?.error ?? "No reading yet"}
        />
      )}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          icon={Icon.ArrowClockwise}
          title="Refresh"
          onAction={() => revalidate()}
        />
        <MenuBarExtra.Item
          icon={Icon.Gear}
          title="Configure Refresh Interval"
          onAction={() => openCommandPreferences()}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
