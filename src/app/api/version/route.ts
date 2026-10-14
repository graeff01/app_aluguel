export const dynamic = "force-dynamic";

/** Versão publicada (para o aviso de "nova versão disponível"). Sem dados sensíveis. */
export async function GET() {
  return Response.json({ version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" }, { headers: { "Cache-Control": "no-store" } });
}
