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
    // An IPv4 address written as IPv6: ::ffff:127.0.0.1.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) {
      return isPrivateAddress(mapped[1]!);
    }
    return (
      lower === '::' ||
      lower === '::1' ||
      /^fe[89ab]/.test(lower) ||
      /^f[cd]/.test(lower) ||
      lower.startsWith('ff')
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
