import type { NextRequest } from "next/server";
import { clientApi } from "@/lib/client-api";
import { AppError } from "@/lib/errors";
import { uploadClientDocument } from "@/server/doc-requests";

export const dynamic = "force-dynamic";

/** Cliente envia um arquivo para um item da lista. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return clientApi(req, "upload", 200, async (cookie) => {
    // recusa antes de ler: um arquivo por envio, até 8 MB (+ margem do formulário)
    if (Number(req.headers.get("content-length") ?? 0) > 9 * 1024 * 1024) throw new AppError("VALIDATION", "Arquivo grande demais (até 8 MB). Tire a foto de novo ou envie um PDF menor.");
    const fd = await req.formData().catch(() => null);
    const file = fd?.get("file");
    const itemKey = String(fd?.get("itemKey") ?? "");
    if (!file || typeof file === "string") throw new AppError("VALIDATION", "Escolha um arquivo.");
    return { ok: true, file: await uploadClientDocument(token, cookie, itemKey, file) };
  });
}
