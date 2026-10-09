"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { setPropertyAddress } from "@/server/route";
import { ensurePropertyCoords } from "@/server/geo";

export async function setPropertyAddressAction(_: ActionState, fd: FormData) {
  const s = await runAction((a) => setPropertyAddress(a, str(fd, "code"), str(fd, "address")));
  if (s.ok) {
    // já marca no mapa (uma ou duas consultas; se falhar, o worker tenta de novo)
    await ensurePropertyCoords([str(fd, "code")], { maxCalls: 2 }).catch(() => undefined);
    revalidatePath("/rota");
    revalidatePath(`/imoveis/${encodeURIComponent(str(fd, "code"))}`);
  }
  return s;
}
