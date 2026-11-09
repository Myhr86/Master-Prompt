import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Laster ned et produktbilde fra nettbutikken (eller dens bilde-CDN, f.eks.
 * cdn.shopify.com). Beskyttet mot SSRF: kun https, ingen interne/private
 * adresser – kontrollert for hver omdirigering – og størrelsesgrense.
 * Innholdet valideres og kodes om etterpå (sanitizeUpload).
 */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/") as [string, string];
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_V4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"];

/** Sant hvis adressen er intern, privat, loopback, link-local eller reservert. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.some((r) => inRange(ip, r));
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || v6.startsWith("ff");
}

export async function assertPublicHttpsUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Ugyldig bildeadresse");
  }
  if (u.protocol !== "https:") throw new Error("Kun https-bildeadresser er tillatt");
  if (u.username || u.password) throw new Error("Ugyldig bildeadresse");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host);
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("Bildeadressen peker til en intern adresse og er blokkert");
  }
  return u;
}

export async function fetchImage(url: string, opts: { fetchImpl?: typeof fetch; lookup?: Lookup } = {}): Promise<Buffer> {
  const f = opts.fetchImpl ?? fetch;
  let current = (await assertPublicHttpsUrl(url, opts.lookup)).toString();
  for (let hop = 0; hop < 4; hop++) {
    const res = await f(current, {
      headers: { Accept: "image/jpeg,image/png,image/webp;q=0.9", "User-Agent": "MyhrSocialManager/1.0 (+produktbilder)" },
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Ugyldig omdirigering");
      current = (await assertPublicHttpsUrl(new URL(loc, current).toString(), opts.lookup)).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Bildet svarte med HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new Error("Bildet er større enn 15 MB");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Tomt svar");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Bildet er større enn 15 MB");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("For mange omdirigeringer");
}
