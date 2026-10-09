// Mapa da rota: geocodificação com cache e trajeto de carro (serviços SIMULADOS, sem rede).
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createManualVisit } from "@/server/visits";
import { drivingRoute, ensurePropertyCoords } from "@/server/geo";
import { dayRoute } from "@/server/route";
import { toLocalInput } from "@/lib/time";
import { makeUsers, resetDb } from "../helpers/db";

let u: Awaited<ReturnType<typeof makeUsers>>;
const NOW = new Date("2026-10-09T17:00:00Z");

function fakeFetch(handler: (url: URL) => unknown) {
  const calls: URL[] = [];
  const f = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url);
    const body = handler(url);
    return new Response(JSON.stringify(body ?? []), { status: body === "500" ? 500 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

beforeEach(async () => {
  await resetDb();
  u = await makeUsers();
});

describe("geocodificação", () => {
  it("geocodifica uma vez, reaproveita o cache e refaz quando o endereço muda", async () => {
    await db.property.create({ data: { code: "1", address: "Rua Um, 10", city: "Canoas" } });
    const { f, calls } = fakeFetch(() => [{ lat: "-29.91", lon: "-51.18" }]);
    await ensurePropertyCoords(["1"], { fetchImpl: f, now: NOW });
    await ensurePropertyCoords(["1"], { fetchImpl: f, now: NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0].hostname).toBe("nominatim.openstreetmap.org");
    expect(calls[0].searchParams.get("q")).toBe("Rua Um, 10, Canoas - RS");
    expect(await db.property.findUniqueOrThrow({ where: { code: "1" } })).toMatchObject({ lat: -29.91, lng: -51.18, geoPrecision: "ADDRESS" });
    await db.property.update({ where: { code: "1" }, data: { address: "Rua Dois, 20" } });
    await ensurePropertyCoords(["1"], { fetchImpl: f, now: NOW });
    expect(calls).toHaveLength(2);
  });

  it("endereço não encontrado cai para o bairro (aproximado); falha do serviço não grava nada", async () => {
    await db.property.create({ data: { code: "2", address: "Rua Inexistente, 1", neighborhood: "Igara", city: "Canoas" } });
    const { f } = fakeFetch((url) => (url.searchParams.get("q")!.startsWith("Igara") ? [{ lat: "-29.90", lon: "-51.16" }] : []));
    await ensurePropertyCoords(["2"], { fetchImpl: f, now: NOW });
    expect(await db.property.findUniqueOrThrow({ where: { code: "2" } })).toMatchObject({ lat: -29.9, geoPrecision: "AREA" });

    await db.property.create({ data: { code: "3", address: "Rua Três, 3" } });
    const down = fakeFetch(() => "500");
    await ensurePropertyCoords(["3"], { fetchImpl: down.f, now: NOW });
    expect(await db.property.findUniqueOrThrow({ where: { code: "3" } })).toMatchObject({ lat: null, geocodedAt: null });
  });
});

describe("trajeto", () => {
  it("lê tempos e linha; intervalo menor que o trajeto + 5 min fica apertado", async () => {
    const osrm = (url: URL) =>
      url.hostname === "router.project-osrm.org"
        ? { code: "Ok", routes: [{ legs: [{ duration: 18 * 60, distance: 9400 }], geometry: { coordinates: [[-51.18, -29.91], [-51.16, -29.9]] } }] }
        : [];
    const { f, calls } = fakeFetch(osrm);
    const r = await drivingRoute([{ lat: -29.91, lng: -51.18 }, { lat: -29.9, lng: -51.16 }], f);
    expect(r).toEqual({ legs: [{ minutes: 18, km: 9.4 }], line: [[-29.91, -51.18], [-29.9, -51.16]] });
    expect(calls[0].pathname).toBe("/route/v1/driving/-51.18000,-29.91000;-51.16000,-29.90000");

    // mesmo bairro, 20 min de intervalo, mas 18 min de carro → apertado
    for (const [code, lat] of [["10", -29.91], ["11", -29.9]] as const) await db.property.create({ data: { code, neighborhood: "Centro", lat, lng: code === "10" ? -51.18 : -51.16 } });
    const at = (min: number, code: string, req: string) =>
      createManualVisit(u.admin, { requestId: req, scheduledStart: toLocalInput(new Date(NOW.getTime() + min * 60_000)), clientName: "Cliente Mapa", phoneRaw: "", propertyCode: code, consultantId: u.a.id });
    await at(60, "10", "geo-req-a1");
    await at(140, "11", "geo-req-a2");
    const route = await dayRoute(u.a, { fetchImpl: f }, NOW);
    expect(route.stops[1]).toMatchObject({ gapMin: 20, sameArea: true, drive: { minutes: 18 }, tight: true });
    expect(route.totalDriveMin).toBe(18);
    expect(route.line).toHaveLength(2);
  });
});
