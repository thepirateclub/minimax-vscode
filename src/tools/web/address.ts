import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// web_fetch goes out from the machine of the user without asking. Without a
// guard the model could read the local network: a dev server on 127.0.0.1,
// the router, the cloud metadata service on 169.254.169.254, through a link
// or a redirect of a public page. The guard lets public addresses only.

// The address of the private, loopback, link-local and reserved networks.
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    const words = ipv6Words(lower);
    if (!words) {
      return true;
    }
    // An IPv4 address carried in IPv6: mapped ::ffff:a.b.c.d (the URL parser
    // writes it as hex, ::ffff:7f00:1), the old compatible ::a.b.c.d and the
    // NAT64 prefix 64:ff9b::/96. The last two words are the IPv4 address.
    const head = words.slice(0, 5).every((w) => w === 0);
    const embedded =
      (head && (words[5] === 0xffff || words[5] === 0)) ||
      (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((w) => w === 0));
    if (embedded && !(words.slice(0, 7).every((w) => w === 0) && words[7]! <= 1)) {
      const a = words[6]!;
      const b = words[7]!;
      return isPrivateAddress([a >> 8, a & 255, b >> 8, b & 255].join('.'));
    }
    return (
      words.every((w) => w === 0) ||
      (words.slice(0, 7).every((w) => w === 0) && words[7] === 1) ||
      (words[0]! & 0xffc0) === 0xfe80 ||
      (words[0]! & 0xfe00) === 0xfc00 ||
      (words[0]! & 0xff00) === 0xff00
    );
  }
  return false;
}

export type Resolve = (host: string) => Promise<string[]>;

export const resolveHost: Resolve = async (host) =>
  (await lookup(host, { all: true })).map((entry) => entry.address);

// The reason the address is refused, or undefined for a public one. The
// name is resolved when a resolver is given: a public name may point to
// 127.0.0.1.
export async function refuseAddress(url: string, resolve?: Resolve): Promise<string | undefined> {
  const target = new URL(url);
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'the address ' + host + ' is on the local network, web_fetch reads public pages only';
  }
  if (isIP(host)) {
    return isPrivateAddress(host) ? 'the address ' + host + ' is on the local network, web_fetch reads public pages only' : undefined;
  }
  if (!resolve) {
    return undefined;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return 'the name ' + host + ' is not found';
  }
  const local = addresses.find(isPrivateAddress);
  return local ? 'the name ' + host + ' points to the local address ' + local + ', web_fetch reads public pages only' : undefined;
}

// The eight 16-bit words of an IPv6 address, or undefined when it does not
// parse. A dotted IPv4 tail becomes the last two words.
function ipv6Words(ip: string): number[] | undefined {
  let text = ip.replace(/%.*$/, '');
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return undefined;
  }
  const part = (h: string | undefined): number[] => (h ? h.split(':').map((w) => parseInt(w, 16)) : []);
  const left = part(halves[0]);
  const right = part(halves[1]);
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const words = [...left, ...new Array<number>(Math.max(fill, 0)).fill(0), ...right];
  return words.length === 8 && words.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffff) ? words : undefined;
}
