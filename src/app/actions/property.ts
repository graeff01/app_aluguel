"use server";
import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { setPropertyAddress } from "@/server/route";

export async function setPropertyAddressAction(_: ActionState, fd: FormData) {
  const s = await runAction((a) => setPropertyAddress(a, str(fd, "code"), str(fd, "address")));
  if (s.ok) {
    revalidatePath("/rota");
    revalidatePath(`/imoveis/${encodeURIComponent(str(fd, "code"))}`);
  }
  return s;
}
