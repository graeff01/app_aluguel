/**
 * Endereço do imóvel e links de navegação (rota do dia).
 * Só endereço de imóvel — nunca dados do cliente — vai para o Google Maps/Waze, e só quando a pessoa toca.
 */

/** Normaliza texto de endereço; descarta links (ex.: Meet/Zoom no campo "local") e textos sem cara de endereço. */
export function cleanAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length < 5 || /https?:\/\/|meet\.google|zoom\.us|teams\.microsoft/i.test(t)) return null;
  if (!/[a-zà-ú]/i.test(t)) return null;
  return t.slice(0, 200);
}

export type Stop = { query: string };

/** Google Maps com várias paradas, saindo da localização atual. O Maps aceita até 9 paradas intermediárias. */
export function mapsRouteUrl(stops: Stop[]) {
  if (stops.length === 0) return null;
  const list = stops.slice(0, 10);
  const dest = list[list.length - 1];
  const params = new URLSearchParams({ api: "1", destination: dest.query, travelmode: "driving" });
  const way = list.slice(0, -1).map((s) => s.query);
  if (way.length) params.set("waypoints", way.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function mapsPlaceUrl(query: string) {
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query }).toString()}`;
}

export function wazeUrl(query: string) {
  return `https://waze.com/ul?${new URLSearchParams({ q: query, navigate: "yes" }).toString()}`;
}

/** Texto usado na busca: endereço (com cidade quando faltar) ou, sem endereço, o bairro (aproximado). */
export function routeQuery(p: { address: string | null; neighborhood: string | null; city: string | null } | null | undefined, defaultCity = "Canoas"): { query: string; approximate: boolean } | null {
  if (!p) return null;
  const city = p.city || defaultCity;
  if (p.address) {
    const hasCity = p.address.toLowerCase().includes(city.toLowerCase());
    return { query: hasCity ? p.address : `${p.address}, ${city} - RS`, approximate: false };
  }
  if (p.neighborhood) return { query: `${p.neighborhood}, ${city} - RS`, approximate: true };
  return null;
}
