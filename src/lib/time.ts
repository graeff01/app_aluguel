import { TZDate } from "@date-fns/tz";

export const TZ = "America/Sao_Paulo";

/** "YYYY-MM-DD" do dia operacional (America/Sao_Paulo). */
export function dayKey(d: Date, tz = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA → YYYY-MM-DD
}

/** Início (00:00) do dia operacional informado, como instante UTC. */
export function startOfDayInTz(key: string, tz = TZ): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, tz).getTime());
}

/** Fim exclusivo do dia operacional (00:00 do dia seguinte). */
export function endOfDayInTz(key: string, tz = TZ): Date {
  return startOfDayInTz(addDays(key, 1), tz);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Data (coluna @db.Date) → "YYYY-MM-DD". Prisma retorna Date em UTC 00:00. */
export function dateOnlyKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dateOnlyFromKey(key: string): Date {
  return new Date(key + "T00:00:00.000Z");
}

export function isDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const longDateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmt = {
  time: (d: Date) => timeFmt.format(d),
  date: (d: Date) => dateFmt.format(d),
  shortDate: (d: Date) => shortDateFmt.format(d),
  /** "Terça-feira, 6 de outubro" — só a primeira letra maiúscula */
  longDate: (d: Date) => {
    const t = longDateFmt.format(d);
    return t.charAt(0).toUpperCase() + t.slice(1);
  },
  dateTime: (d: Date) => dateTimeFmt.format(d),
  dayKey: (key: string) => {
    const [y, m, d] = key.split("-");
    return `${d}/${m}/${y}`;
  },
};

/** Valor para <input type="datetime-local"> no fuso operacional. */
export function toLocalInput(d: Date, tz = TZ): string {
  const z = new TZDate(d.getTime(), tz);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}T${p(z.getHours())}:${p(z.getMinutes())}`;
}

/** Interpreta "YYYY-MM-DDTHH:mm" no fuso operacional. */
export function fromLocalInput(v: string, tz = TZ): Date | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  return new Date(new TZDate(y, mo - 1, d, h, mi, 0, tz).getTime());
}
