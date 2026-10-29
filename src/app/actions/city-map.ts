"use server";
import { getActor } from "@/lib/session";
import { areaDetail, type AreaDetail } from "@/server/city-map";

/** Detalhe do bairro tocado no Mapa de Canoas (procura + nossos imóveis no site). */
export async function areaDetailAction(key: string): Promise<AreaDetail | null> {
  const actor = await getActor();
  if (!actor) return null;
  return areaDetail(actor, key).catch(() => null);
}
