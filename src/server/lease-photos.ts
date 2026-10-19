/**
 * Fotos do anúncio guardadas na locação para o marketing baixar (Canva etc.):
 * depois de alugado o imóvel sai do site, então o worker copia as fotos logo que o contrato é assinado.
 * Só fotos públicas do imóvel — nenhum dado de cliente. Só baixa do mesmo domínio do site de anúncios.
 */
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { assert, hasGlobalView, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/log";
import { refreshPropertyNow } from "@/server/property-preview";

const MAX_PHOTOS = 40;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const canSee = (a: AuthzActor) => a.role === "MARKETING" || hasGlobalView(a);

/** Domínio do site de anúncios (ex.: auxiliadorapredial.com.br): as fotos precisam vir dele ou de um subdomínio. */
export function siteDomain(template: string) {
  try {
    const labels = new URL(template.replace(/\{codigo\}/g, "x")).hostname.split(".");
    const n = labels.length >= 3 && labels.at(-1)!.length === 2 && ["com", "net", "org", "gov", "edu"].includes(labels.at(-2)!) ? 3 : 2;
    return labels.slice(-n).join(".");
  } catch {
    return null;
  }
}

export function allowedPhotoUrl(url: string, domain: string | null) {
  if (!domain) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === domain || u.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function download(url: string, domain: string, fetchImpl: typeof fetch) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "VisitasLocacao/1.0 (+fotos para o marketing)", accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    if (res.url && !allowedPhotoUrl(res.url, domain)) return null; // redirecionou para fora do site
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!MIME_EXT[mime]) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0 || data.length > MAX_BYTES) return null;
    return { mime, data };
  } catch {
    return null;
  }
}

/** Copia as fotos do anúncio para a locação (as que ainda não foram guardadas). */
export async function captureLeasePhotos(leasePostId: string, opts: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const post = await db.leasePost.findUnique({ where: { id: leasePostId }, select: { id: true, opportunity: { select: { property: { select: { code: true } } } }, photos: { select: { sourceUrl: true } } } });
  if (!post) throw notFound();
  const code = post.opportunity.property.code;
  const domain = siteDomain((await getSettings()).propertyUrlTemplate);
  // lê o anúncio de novo (pega todas as fotos enquanto ainda está no ar)
  await refreshPropertyNow(code, { fetchImpl }).catch(() => null);
  const prop = await db.property.findUnique({ where: { code }, select: { gallery: true, photos: true, photoUrl: true } });
  const urls = [...new Set([...(prop?.gallery ?? []), ...(prop?.photos ?? []), ...(prop?.photoUrl ? [prop.photoUrl] : [])])].filter((u) => allowedPhotoUrl(u, domain)).slice(0, MAX_PHOTOS);
  const have = new Set(post.photos.map((p) => p.sourceUrl));
  let saved = 0;
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    if (have.has(url)) continue;
    const img = await download(url, domain!, fetchImpl);
    if (!img) {
      failed++;
      continue;
    }
    await db.leasePhoto.upsert({ where: { leasePostId_sourceUrl: { leasePostId, sourceUrl: url } }, update: {}, create: { leasePostId, position: i, sourceUrl: url, mime: img.mime, size: img.data.length, data: img.data } });
    saved++;
  }
  const total = have.size + saved;
  // falhou alguma: o worker tenta de novo mais tarde (até MAX_ATTEMPTS vezes)
  const status = failed > 0 ? "ERROR" : total > 0 ? "OK" : "NONE";
  await db.leasePost.update({ where: { id: leasePostId }, data: { photosStatus: status, photosCheckedAt: opts.now ?? new Date(), photoAttempts: { increment: 1 } } });
  if (saved || failed) log.info("lease_photos.captured", { saved, failed, total });
  return { saved, failed, total, status };
}

/** Worker: locações sem fotos guardadas (ou que falharam há mais de 1 h). */
export async function captureMissingLeasePhotos(opts: { limit?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const posts = await db.leasePost.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - 180 * 86400_000) },
      OR: [{ photosStatus: null }, { photosStatus: { in: ["ERROR", "NONE"] }, photoAttempts: { lt: MAX_ATTEMPTS }, photosCheckedAt: { lt: new Date(now.getTime() - 3600_000) } }],
    },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 2,
    select: { id: true },
  });
  for (const p of posts) await captureLeasePhotos(p.id, { fetchImpl: opts.fetchImpl, now });
  return { checked: posts.length };
}

/** Marketing pede para buscar agora (sem esperar o worker). */
export async function captureLeasePhotosNow(actor: AuthzActor, leasePostId: string, opts: { fetchImpl?: typeof fetch } = {}) {
  assert(canSee(actor));
  return captureLeasePhotos(leasePostId, opts);
}

const fileName = (code: string, position: number, mime: string) => `imovel-${code}-${String(position + 1).padStart(2, "0")}.${MIME_EXT[mime] ?? "jpg"}`;

export async function readLeasePhoto(actor: AuthzActor, photoId: string) {
  assert(canSee(actor));
  const p = await db.leasePhoto.findUnique({ where: { id: photoId }, select: { data: true, mime: true, position: true, leasePost: { select: { opportunity: { select: { property: { select: { code: true } } } } } } } });
  if (!p) throw notFound();
  return { data: p.data, mime: p.mime, name: fileName(p.leasePost.opportunity.property.code, p.position, p.mime) };
}

/** Todas as fotos da locação num .zip (sem compressão: JPEG já é comprimido). */
export async function leasePhotosZip(actor: AuthzActor, leasePostId: string) {
  assert(canSee(actor));
  const post = await db.leasePost.findUnique({ where: { id: leasePostId }, select: { opportunity: { select: { property: { select: { code: true } } } }, photos: { orderBy: { position: "asc" }, select: { data: true, mime: true, position: true } } } });
  if (!post || post.photos.length === 0) throw notFound();
  const code = post.opportunity.property.code;
  return { name: `fotos-imovel-${code}.zip`, data: zipStore(post.photos.map((p) => ({ name: fileName(code, p.position, p.mime), data: Buffer.from(p.data) }))) };
}

// ─────────────── .zip simples (método "store") ───────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Buffer }[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(0, 8); // sem compressão
    local.writeUInt32LE(0, 10); // hora/data
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, f.data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(f.data.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + f.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}
