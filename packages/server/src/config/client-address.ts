import { BlockList, isIP } from "node:net";

function family(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

function plain(address: string): string {
  return address.replace(/^::ffff:/, "");
}

export function trustedProxyList(
  entries: readonly string[],
  options: { loopback?: boolean } = {},
): BlockList {
  const list = new BlockList();
  if (options.loopback) {
    list.addSubnet("127.0.0.0", 8, "ipv4");
    list.addAddress("::1", "ipv6");
  }
  for (const entry of entries) {
    const [address = "", prefix] = entry.split("/");
    if (prefix === undefined) list.addAddress(address, family(address));
    else list.addSubnet(address, Number(prefix), family(address));
  }
  return list;
}

export function clientAddress(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  proxies: BlockList,
): string {
  const remote = plain(remoteAddress ?? "");
  if (!remote) return "unknown";
  const chain = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? ""))
    .split(",")
    .map((entry) => plain(entry.trim()))
    .filter((entry) => isIP(entry) !== 0);
  let address = remote;
  while (isIP(address) !== 0 && proxies.check(address, family(address)) && chain.length > 0) {
    address = chain.pop() as string;
  }
  return address;
}
