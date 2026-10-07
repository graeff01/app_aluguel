import type { NextRequest } from "next/server";
import { apiHandler } from "@/lib/api";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { hitRateLimit } from "@/lib/ratelimit";
import { cleanOptional } from "@/lib/text";
import { fetchPreview, propertyUrl } from "@/server/property-preview";

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
      if (cached?.pageCheckedAt && Date.now() - cached.pageCheckedAt.getTime() < 7 * 86400_000 && cached.pageStatus !== "ERROR") {
        return { status: cached.pageStatus, photoUrl: cached.photoUrl, title: cached.title, url };
      }
      if (!url) return { status: "NO_TEMPLATE" };
      if (!(await hitRateLimit(`preview:${actor.id}`, 20, 600)).allowed) return { status: "RATE_LIMITED" };
      const pv = await fetchPreview(url);
      if (pv.status !== "ERROR") {
        await db.property.upsert({
          where: { code },
          update: { photoUrl: pv.photoUrl, title: pv.title, pageStatus: pv.status, pageCheckedAt: new Date() },
          create: { code, photoUrl: pv.photoUrl, title: pv.title, pageStatus: pv.status, pageCheckedAt: new Date() },
        });
      }
      return { ...pv, url };
    },
    { mutation: false },
  );
}
