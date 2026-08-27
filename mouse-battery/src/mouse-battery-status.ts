import { LaunchType, environment, showHUD, updateCommandMetadata } from "@raycast/api";
import { Reading, hasReading, queryDevices } from "./logi";

function label(r: Reading): string {
  const level = r.percent !== undefined ? `${r.percent}%` : `${r.millivolts} mV`;
  return `${level}${r.state === "charging" ? "⚡" : ""} ${r.name}`;
}

export default async function Command() {
  let subtitle: string;
  try {
    const devices = (await queryDevices()).filter(hasReading);
    subtitle = devices.length ? devices.map(label).join(" · ") : "no reading (mouse asleep?)";
  } catch {
    subtitle = "query failed";
  }
  await updateCommandMetadata({ subtitle });
  if (environment.launchType === LaunchType.UserInitiated) {
    await showHUD(subtitle);
  }
}
