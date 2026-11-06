import * as os from "os";

/** Address a phone should use for the Pocket page: this computer's LAN IP when LAN access is on. */
export function pocketLink(address: string, port: number, allowLan: boolean): string {
  if (!allowLan) return `${address}/pocket`;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return `http://${ni.address}:${port}/pocket`;
    }
  }
  return `${address}/pocket`;
}
