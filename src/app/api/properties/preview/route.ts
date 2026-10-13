import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { hitRateLimit } from "@/lib/ratelimit";
import { cleanOptional } from "@/lib/text";
import { propertyUrl, refreshPropertyNow } from "@/server/property-preview";

/** Prévia do imóvel pelo código (cache de 7 dias; consulta ao site com limite por pessoa). */
export async function GET(req: NextRequest) {
  return apiHandler(
    req,
    async (actor) => {
      const code = cleanOptional(req.nextUrl.searchParams.get("codigo"))?.slice(0, 40);
      if (!code || !/^[0-9A-Za-z\-\/]+$/.test(code)) return { status: "INVALID" };
      const settings = await getSettings();
      const url = settings.propertyUrlTemplate.includes("{codigo}") ? propertyUrl(settings.propertyUrlTemplate, code) : null;
      const cached = await db.property.findUnique({ where: { code } });
      const pick = (p: { photoUrl: string | null; title: string | null; neighborhood?: string | null; category?: string | null; totalPrice?: number | null; rent?: number | null }) => ({
        photoUrl: p.photoUrl,
        title: p.title,
        neighborhood: p.neighborhood ?? null,
        category: p.category ?? null,
        totalPrice: p.totalPrice ?? null,
        rent: p.rent ?? null,
      });
      // cache só vale se já tiver os dados do anúncio (registros antigos guardavam só foto e título)
      if (cached?.pageCheckedAt && Date.now() - cached.pageCheckedAt.getTime() < 7 * 86400_000 && cached.pageStatus !== "ERROR" && (cached.pageStatus !== "OK" || cached.neighborhood || cached.rent)) {
        return { status: cached.pageStatus, ...pick(cached), url };
      }
      if (!url) return { status: "NO_TEMPLATE" };
      if (!(await hitRateLimit(`preview:${actor.id}`, 20, 600)).allowed) return { status: "RATE_LIMITED" };
      const pv = await refreshPropertyNow(code);
      if (!pv) return { status: "NO_TEMPLATE" };
      return { status: pv.status, ...pick({ photoUrl: pv.photoUrl, title: pv.title, ...(pv.listing ?? {}) }), url };
    },
    { mutation: false },
  );
}
