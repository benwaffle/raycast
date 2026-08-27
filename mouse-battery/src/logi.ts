import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const UV = "/opt/homebrew/bin/uv";
export const SCRIPT = `${environment.assetsPath}/logi_battery.py`;

export type Reading = {
  index?: number;
  name?: string;
  percent?: number;
  millivolts?: number;
  state?: string;
  error?: string;
};

export function parse(stdout: string | undefined): Reading[] {
  if (!stdout) return [];
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Reading;
      } catch {
        return { error: line };
      }
    });
}

export function hasReading(r: Reading): boolean {
  return r.percent !== undefined || r.millivolts !== undefined;
}

export async function queryDevices(): Promise<Reading[]> {
  const { stdout } = await execFileAsync(UV, ["run", "--with", "hidapi", "python3", SCRIPT]);
  return parse(stdout);
}
