import { isIP } from "node:net";

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** The eight 16-bit groups of an IPv6 address in any textual form, or null. */
function ipv6Groups(address: string): number[] | null {
  let x = address.toLowerCase().replace(/%.*$/, "");
  // A trailing dotted IPv4 (`::ffff:10.0.0.1`) becomes two hex groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    x = `${x.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = x.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** Private, loopback, link-local, and metadata ranges the checker must never call. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) return isPrivateIPv4(address);
  if (v === 6) {
    const g = ipv6Groups(address);
    if (!g) return true;
    const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    // `::`, `::1`, and IPv4-compatible `::a.b.c.d`.
    if (g.slice(0, 6).every((x) => x === 0)) return g[6] === 0 || isPrivateIPv4(embeddedV4());
    // IPv4-mapped `::ffff:a.b.c.d`, dotted or hex (`new URL` prints `[::ffff:7f00:1]`).
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateIPv4(embeddedV4());
    // NAT64 `64:ff9b::/96` reaches the embedded IPv4 address.
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIPv4(embeddedV4());
    const first = g[0];
    return (
      (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
      (first & 0xff00) === 0xff00 // ff00::/8 multicast
    );
  }
  return true;
}
