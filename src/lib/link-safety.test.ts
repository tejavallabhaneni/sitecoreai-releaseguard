import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./link-safety";

describe("isPrivateAddress", () => {
  it.each([
    // IPv4
    ["0.0.0.0", "this network"],
    ["10.1.2.3", "RFC 1918"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["100.64.0.1", "CGNAT low"],
    ["100.127.255.255", "CGNAT high"],
    ["169.254.169.254", "link-local / cloud metadata"],
    ["172.16.0.1", "RFC 1918 low"],
    ["172.31.255.255", "RFC 1918 high"],
    ["192.168.0.1", "RFC 1918"],
    ["198.18.0.1", "benchmark"],
    ["198.19.255.255", "benchmark"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["255.255.255.255", "broadcast"],
    // IPv6
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback, expanded"],
    ["fc00::1", "unique local"],
    ["fd12:3456::1", "unique local"],
    ["fe80::1", "link-local"],
    ["FEBF::1", "link-local, upper case"],
    ["fe80::1%eth0", "link-local with zone"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["::ffff:10.0.0.1", "IPv4-mapped, dotted"],
    ["::ffff:7f00:1", "IPv4-mapped, hex (what new URL() prints)"],
    ["0:0:0:0:0:ffff:a9fe:a9fe", "IPv4-mapped metadata, expanded"],
    ["::127.0.0.1", "IPv4-compatible"],
    ["64:ff9b::a00:1", "NAT64 of 10.0.0.1"],
    // Not an IP: fail closed.
    ["example.com", "hostname"],
    ["", "empty"],
    ["999.1.1.1", "invalid IPv4"],
  ])("%s is private (%s)", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ["93.184.216.34"],
    ["8.8.8.8"],
    ["100.63.255.255"],
    ["100.128.0.0"],
    ["172.15.255.255"],
    ["172.32.0.0"],
    ["192.169.0.1"],
    ["198.17.0.1"],
    ["198.20.0.1"],
    ["169.253.0.1"],
    ["223.255.255.255"],
    ["2606:2800:220:1::"],
    ["2001:4860:4860::8888"],
    ["fb00::1"],
    ["fe00::1"],
    ["::ffff:93.184.216.34"],
    ["::ffff:5db8:d822"],
    ["64:ff9b::808:808"],
  ])("%s is public", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
