/**
 * Log estruturado. Regras: nunca registrar títulos de eventos, telefones, observações, e-mails de clientes ou tokens.
 * Passe apenas identificadores internos, contagens e códigos de erro.
 */
type Meta = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE = /token|secret|password|senha|phone|telefone|title|titulo|note|observ|summary|description/i;

function scrub(meta: Meta = {}): Meta {
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE.test(k) ? "[omitido]" : v;
  return out;
}

function write(level: "info" | "warn" | "error", event: string, meta?: Meta) {
  if (process.env.LOG_SILENT === "1") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...scrub(meta) });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, meta?: Meta) => write("info", event, meta),
  warn: (event: string, meta?: Meta) => write("warn", event, meta),
  error: (event: string, meta?: Meta) => write("error", event, meta),
};

/** Mensagem de erro segura (sem dados do Google/cliente). */
export function errorCode(e: unknown): string {
  if (e && typeof e === "object") {
    const anyE = e as { code?: unknown; status?: unknown; name?: unknown };
    if (typeof anyE.code === "string") return anyE.code;
    if (typeof anyE.status === "number") return `HTTP_${anyE.status}`;
    if (typeof anyE.name === "string") return anyE.name;
  }
  return "UNKNOWN";
}
