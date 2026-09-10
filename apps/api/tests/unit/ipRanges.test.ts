import { describe, expect, it } from 'vitest';
import { classifyAddress, isPubliclyRoutable } from '../../src/monitoring/ipRanges.js';

describe('address classification', () => {
  const blockedIpv4 = [
    ['0.0.0.0', 'this network'],
    ['0.1.2.3', 'this network'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['100.64.0.1', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['127.1.1.1', 'loopback'],
    ['169.254.169.254', 'cloud metadata'],
    ['169.254.0.1', 'link-local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.0.0.1', 'protocol assignments'],
    ['192.0.2.5', 'TEST-NET-1'],
    ['192.88.99.1', '6to4 relay'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.7', 'TEST-NET-2'],
    ['203.0.113.9', 'TEST-NET-3'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ] as const;

  it.each(blockedIpv4)('refuses IPv4 %s (%s)', (address) => {
    const result = classifyAddress(address);
    expect(result.publiclyRoutable).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  const allowedIpv4 = ['1.1.1.1', '8.8.8.8', '93.184.215.14', '172.32.0.1', '100.128.0.1', '192.0.1.1', '223.255.255.254'];

  it.each(allowedIpv4)('allows public IPv4 %s', (address) => {
    expect(isPubliclyRoutable(address)).toBe(true);
  });

  const blockedIpv6 = [
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fe80::200:5aee:feaa:20a2', 'link-local'],
    ['fc00::1', 'unique local'],
    ['fd12:3456:789a::1', 'unique local'],
    ['fd00:ec2::254', 'AWS IPv6 metadata is inside fc00::/7'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['2001::abcd', 'Teredo'],
    ['100::1', 'discard-only'],
    ['5f00::1', 'segment routing'],
    ['3fff::1', 'documentation'],
    ['64:ff9b::1.2.3.4', 'NAT64'],
    ['2002:c0a8:0101::1', '6to4'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
    ['::ffff:8.8.8.8', 'IPv4-mapped public address is still refused'],
  ] as const;

  it.each(blockedIpv6)('refuses IPv6 %s (%s)', (address) => {
    const result = classifyAddress(address);
    expect(result.publiclyRoutable).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  const allowedIpv6 = ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4009:81f::200e'];

  it.each(allowedIpv6)('allows public IPv6 %s', (address) => {
    expect(isPubliclyRoutable(address)).toBe(true);
  });

  it('refuses anything that is not an IP address', () => {
    for (const value of ['', 'not-an-ip', '1.2.3', '999.1.1.1', 'example.com', '::gg']) {
      expect(classifyAddress(value).publiclyRoutable).toBe(false);
    }
  });

  it('ignores an IPv6 zone id rather than treating it as unknown', () => {
    expect(classifyAddress('fe80::1%eth0').publiclyRoutable).toBe(false);
  });
});
