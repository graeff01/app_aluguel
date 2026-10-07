/** Erros não tratados no servidor (páginas, rotas e ações) vão para o registro de erros. */
export async function onRequestError(err: unknown, request: { path: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("./lib/error-tracking");
  const e = err as { message?: string; stack?: string; digest?: string };
  if (String(e?.digest ?? "").startsWith("NEXT_")) return; // redirect/notFound não são erros
  await recordError({ source: "server", message: e?.message ?? String(err), path: request.path, stackTop: e?.stack?.split("\n")[1] ?? null });
}
