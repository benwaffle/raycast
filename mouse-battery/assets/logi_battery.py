"""Query battery of devices paired to a Logitech receiver via HID++ 2.0.

Prints one JSON object per paired device:
  {"index": 1, "name": "G502 X LIGHTSPEED", "percent": 87, "state": "discharging"}
or a single {"error": "..."} object if nothing responded.
"""
import json
import os

os.environ.setdefault("DYLD_LIBRARY_PATH", "/opt/homebrew/lib")
import hid

VID_LOGITECH = 0x046D

LONG_REPORT = 0x11
LONG_LEN = 20
SW_ID = 0x0A

FEAT_NAME = 0x0005
FEAT_BATTERY_STATUS = 0x1000
FEAT_BATTERY_VOLTAGE = 0x1001
FEAT_UNIFIED_BATTERY = 0x1004


def open_receiver():
    for info in hid.enumerate(VID_LOGITECH):
        # HID++ messages go over the vendor-specific usage page
        if info["usage_page"] == 0xFF00:
            dev = hid.device()
            dev.open_path(info["path"])
            return dev
    raise SystemExit(json.dumps({"error": "no Logitech receiver found"}))


def request(dev, dev_idx, feat_idx, func, params=b""):
    msg = bytes([LONG_REPORT, dev_idx, feat_idx, (func << 4) | SW_ID]) + params
    msg += bytes(LONG_LEN - len(msg))
    dev.write(msg)
    for _ in range(30):
        resp = bytes(dev.read(LONG_LEN, timeout_ms=2000))
        if not resp:
            raise TimeoutError("no response")
        if resp[1] != dev_idx:
            continue
        # HID++ 1.0 error report
        if resp[0] == 0x10 and resp[2] == 0x8F:
            raise OSError(f"hid++1 error code {resp[6]:#x}")
        # HID++ 2.0 error
        if resp[2] == 0xFF and resp[3] == (func << 4) | SW_ID:
            raise OSError(f"hid++2 error code {resp[5]:#x}")
        if resp[2] == feat_idx and resp[3] == (func << 4) | SW_ID:
            return resp[4:]
    raise TimeoutError("no matching response")


def get_feature_index(dev, dev_idx, feat_id):
    p = request(dev, dev_idx, 0x00, 0, bytes([feat_id >> 8, feat_id & 0xFF]))
    return p[0]  # 0 = feature not present


def device_name(dev, dev_idx):
    idx = get_feature_index(dev, dev_idx, FEAT_NAME)
    if not idx:
        return "?"
    length = request(dev, dev_idx, idx, 0)[0]
    name = b""
    while len(name) < length:
        name += request(dev, dev_idx, idx, 1, bytes([len(name)]))
    return name[:length].decode(errors="replace")


def battery(dev, dev_idx):
    idx = get_feature_index(dev, dev_idx, FEAT_UNIFIED_BATTERY)
    if idx:
        p = request(dev, dev_idx, idx, 1)  # get_status
        states = {0: "discharging", 1: "charging", 2: "charging", 3: "full"}
        return {"percent": p[0], "state": states.get(p[2], f"state {p[2]}")}
    idx = get_feature_index(dev, dev_idx, FEAT_BATTERY_STATUS)
    if idx:
        p = request(dev, dev_idx, idx, 0)  # getBatteryLevelStatus
        return {"percent": p[0], "state": "unknown"}
    idx = get_feature_index(dev, dev_idx, FEAT_BATTERY_VOLTAGE)
    if idx:
        p = request(dev, dev_idx, idx, 0)
        return {"millivolts": p[0] << 8 | p[1], "state": "unknown"}
    return {"error": "no battery feature"}


def main():
    dev = open_receiver()
    found = False
    for dev_idx in range(1, 7):
        try:
            name = device_name(dev, dev_idx)
        except (OSError, TimeoutError):
            continue
        found = True
        try:
            print(json.dumps({"index": dev_idx, "name": name, **battery(dev, dev_idx)}))
        except (OSError, TimeoutError) as e:
            print(json.dumps({"index": dev_idx, "name": name, "error": str(e)}))
    if not found:
        print(json.dumps({"error": "no paired devices responded (mouse asleep or off?)"}))


if __name__ == "__main__":
    main()
