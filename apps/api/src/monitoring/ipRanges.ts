import { isIPv4, isIPv6 } from 'node:net';

/**
 * Address-space classification used by the SSRF guard.
 *
 * The rule is an allowlist by exclusion: an address is usable only if it is a
 * normal, globally routable unicast address. Everything special-purpose is
 * refused, including ranges that are merely reserved today, because "reserved"
 * has repeatedly turned into "routes somewhere surprising" later.
 */

interface Cidr {
  readonly base: bigint;
  readonly mask: bigint;
  readonly label: string;
}

function parseIPv4ToBigInt(address: string): bigint {
  const parts = address.split('.');
  let value = 0n;
  for (const part of parts) {
    value = (value << 8n) | BigInt(Number(part));
  }
  return value;
}

function expandIPv6(address: string): string[] {
  // Strip a zone id (`fe80::1%eth0`); it never makes an address routable.
  const withoutZone = address.split('%')[0] ?? address;

  let head = withoutZone;
  let tail = '';
  if (withoutZone.includes('::')) {
    const [left = '', right = ''] = withoutZone.split('::', 2) as [string, string];
    head = left;
    tail = right;
  }

  const headGroups = head.length > 0 ? head.split(':') : [];
  const tailGroups = tail.length > 0 ? tail.split(':') : [];

  // An embedded IPv4 tail (::ffff:127.0.0.1) becomes two 16-bit groups.
  const lastTail = tailGroups.at(-1);
  const lastHead = headGroups.at(-1);
  const embedded = lastTail?.includes('.') ? lastTail : lastHead?.includes('.') ? lastHead : undefined;
  if (embedded) {
    const octets = embedded.split('.').map((o) => Number(o));
    const hi = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const lo = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    if (lastTail === embedded) {
      tailGroups.splice(-1, 1, hi, lo);
    } else {
      headGroups.splice(-1, 1, hi, lo);
    }
  }

  const missing = 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...tailGroups];
}

function parseIPv6ToBigInt(address: string): bigint {
  const groups = expandIPv6(address);
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(parseInt(group === '' ? '0' : group, 16));
  }
  return value;
}

function cidr(prefix: string, label: string, bits: 32 | 128): Cidr {
  const [network = '', lengthText = ''] = prefix.split('/', 2) as [string, string];
  const length = Number(lengthText);
  const base = bits === 32 ? parseIPv4ToBigInt(network) : parseIPv6ToBigInt(network);
  const mask = length === 0 ? 0n : ((1n << BigInt(length)) - 1n) << BigInt(bits - length);
  return { base: base & mask, mask, label };
}

const v4 = (prefix: string, label: string) => cidr(prefix, label, 32);
const v6 = (prefix: string, label: string) => cidr(prefix, label, 128);

/** IPv4 special-purpose registry (RFC 6890 and friends), all refused. */
const BLOCKED_IPV4: readonly Cidr[] = [
  v4('0.0.0.0/8', '"this network"'),
  v4('10.0.0.0/8', 'private network'),
  v4('100.64.0.0/10', 'carrier-grade NAT'),
  v4('127.0.0.0/8', 'loopback'),
  v4('169.254.0.0/16', 'link-local / cloud metadata'),
  v4('172.16.0.0/12', 'private network'),
  v4('192.0.0.0/24', 'IETF protocol assignments'),
  v4('192.0.2.0/24', 'documentation (TEST-NET-1)'),
  v4('192.31.196.0/24', 'AS112 anycast'),
  v4('192.52.193.0/24', 'AMT anycast'),
  v4('192.88.99.0/24', 'deprecated 6to4 relay anycast'),
  v4('192.168.0.0/16', 'private network'),
  v4('192.175.48.0/24', 'AS112 direct delegation'),
  v4('198.18.0.0/15', 'benchmarking'),
  v4('198.51.100.0/24', 'documentation (TEST-NET-2)'),
  v4('203.0.113.0/24', 'documentation (TEST-NET-3)'),
  v4('224.0.0.0/4', 'multicast'),
  v4('240.0.0.0/4', 'reserved'),
  v4('255.255.255.255/32', 'broadcast'),
];

/** IPv6 special-purpose registry, all refused. */
const BLOCKED_IPV6: readonly Cidr[] = [
  v6('::/128', 'unspecified address'),
  v6('::1/128', 'loopback'),
  v6('64:ff9b::/96', 'NAT64'),
  v6('64:ff9b:1::/48', 'local-use NAT64'),
  v6('100::/64', 'discard-only'),
  v6('2001::/32', 'Teredo'),
  v6('2001:1::1/128', 'Port Control Protocol anycast'),
  v6('2001:2::/48', 'benchmarking'),
  v6('2001:10::/28', 'deprecated ORCHID'),
  v6('2001:20::/28', 'ORCHIDv2'),
  v6('2001:30::/28', 'DRIP'),
  v6('2001:db8::/32', 'documentation'),
  v6('2002::/16', '6to4'),
  v6('3fff::/20', 'documentation'),
  v6('5f00::/16', 'segment routing'),
  v6('fc00::/7', 'unique local address'),
  v6('fe80::/10', 'link-local'),
  v6('ff00::/8', 'multicast'),
];

/** ::ffff:0:0/96 — an IPv4 address wearing an IPv6 costume. */
const IPV4_MAPPED = v6('::ffff:0:0/96', 'IPv4-mapped IPv6');
/** 2002::/16 embeds an IPv4 address in bits 16-48. */
const SIXTOFOUR = v6('2002::/16', '6to4');
/** 64:ff9b::/96 embeds an IPv4 address in the low 32 bits. */
const NAT64 = v6('64:ff9b::/96', 'NAT64');

export interface AddressClassification {
  /** True when the address is an ordinary globally routable unicast address. */
  publiclyRoutable: boolean;
  /** Why it was refused, safe to show a user. Undefined when routable. */
  reason?: string;
}

function classifyIPv4(address: string): AddressClassification {
  const value = parseIPv4ToBigInt(address);
  for (const range of BLOCKED_IPV4) {
    if ((value & range.mask) === range.base) {
      return { publiclyRoutable: false, reason: `address is in a reserved range (${range.label})` };
    }
  }
  return { publiclyRoutable: true };
}

function ipv4FromLow32(value: bigint): string {
  const low = value & 0xffffffffn;
  return [24n, 16n, 8n, 0n].map((shift) => Number((low >> shift) & 0xffn)).join('.');
}

function classifyIPv6(address: string): AddressClassification {
  const value = parseIPv6ToBigInt(address);

  // Unwrap the three forms that carry an IPv4 address inside an IPv6 one, so a
  // blocked IPv4 destination cannot be smuggled past the IPv6 rules.
  if ((value & IPV4_MAPPED.mask) === IPV4_MAPPED.base) {
    const inner = classifyIPv4(ipv4FromLow32(value));
    return inner.publiclyRoutable
      ? { publiclyRoutable: false, reason: 'address is an IPv4-mapped IPv6 address' }
      : { publiclyRoutable: false, reason: `${inner.reason} (IPv4-mapped)` };
  }
  if ((value & NAT64.mask) === NAT64.base) {
    return { publiclyRoutable: false, reason: 'address is a NAT64 address' };
  }
  if ((value & SIXTOFOUR.mask) === SIXTOFOUR.base) {
    return { publiclyRoutable: false, reason: 'address is a 6to4 address' };
  }

  for (const range of BLOCKED_IPV6) {
    if ((value & range.mask) === range.base) {
      return { publiclyRoutable: false, reason: `address is in a reserved range (${range.label})` };
    }
  }
  return { publiclyRoutable: true };
}

/** Classifies a literal IP address. Non-addresses are refused, never assumed safe. */
export function classifyAddress(address: string): AddressClassification {
  if (isIPv4(address)) return classifyIPv4(address);
  if (isIPv6(address)) return classifyIPv6(address);
  return { publiclyRoutable: false, reason: 'not a valid IP address' };
}

export function isPubliclyRoutable(address: string): boolean {
  return classifyAddress(address).publiclyRoutable;
}

/** Exposed for the unit tests that assert every range is covered. */
export const __testing = { BLOCKED_IPV4, BLOCKED_IPV6, expandIPv6, parseIPv4ToBigInt, parseIPv6ToBigInt };
