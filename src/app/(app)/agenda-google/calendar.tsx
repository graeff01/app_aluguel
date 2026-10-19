"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createEventAction, deleteEventAction, editEventAction, moveEventAction } from "@/app/actions/calendar";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import type { Mirror, MirrorEvent } from "@/server/calendar-mirror";
import { CancelVisit } from "../agenda-do-dia/cancel";

export type View = "dia" | "semana" | "mes";
type Item = { id: string; label: string };
type Props = {
  view: View;
  refDay: string;
  today: string;
  days: string[];
  now: string;
  mirror: Mirror;
  consultants: { id: string; name: string }[];
  reasons: Item[];
  back: string;
  banner: ReactNode;
  created: boolean;
};

// ─────────────── horário de Brasília (sem horário de verão) ───────────────
const OFF = 3 * 3600_000;
const DAY = 86400_000;
const HOUR_PX = 48;
const SNAP = 15;
const dayStart = (k: string) => Date.parse(`${k}T00:00:00-03:00`);
const keyOf = (ms: number) => new Date(ms - OFF).toISOString().slice(0, 10);
const minOfDay = (ms: number) => {
  const d = new Date(ms - OFF);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const addKey = (k: string, n: number) => keyOf(dayStart(k) + n * DAY + 12 * 3600_000);
const hm = (ms: number) => {
  const d = new Date(ms - OFF);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const WEEKDAY = ["DOM.", "SEG.", "TER.", "QUA.", "QUI.", "SEX.", "SÁB."];
const WEEKDAY_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTH = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dowOf = (k: string) => new Date(`${k}T12:00:00Z`).getUTCDay();
const dd = (k: string) => Number(k.slice(8, 10));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = (k: string) => `${WEEKDAY_LONG[dowOf(k)]}, ${dd(k)} de ${MONTH[Number(k.slice(5, 7)) - 1]}`;
const CONSULTANT_COLORS = ["#8e24aa", "#0b8043", "#f4511e", "#3f51b5", "#e67c73", "#039be5", "#616161", "#f6bf26"];
const TODAY_BLUE = "#1a73e8";

/** Texto escuro em cores claras (amarelo), branco no resto. */
function textOn(hex: string) {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#202124" : "#fff";
}

function visitBadge(e: MirrorEvent) {
  const v = e.visit;
  if (!v) return null;
  if (v.status === "CANCELED") return "Cancelada";
  if (v.status === "DONE") return v.evaluation ? `Realizada · ${EVALUATION_LABEL[v.evaluation] ?? ""}` : "Realizada";
  if (v.status !== "SCHEDULED") return STATUS_LABEL[v.status] ?? v.status;
  if (v.confirmStatus === "CONFIRMED") return "✓ Confirmada";
  if (v.confirmStatus === "NO_REPLY") return "Sem resposta";
  return "Agendada";
}

const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: só não lembra */
  }
};

type Override = { start: string; end: string };
type Drag = { key: string; mode: "move" | "resize"; x: number; y: number; col: number; start: number; end: number; moved: boolean; preview: { start: number; end: number } | null };
type Creating = { start: number; end: number; allDay: boolean; x: number; y: number };
type Selected = { key: string; x: number; y: number };
type Toast = { text: string; undo?: () => void; error?: boolean } | null;

export function CalendarMirror(p: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // null = padrão da tela (aberta no computador, fechada no celular)
  const [sidebar, setSidebar] = useState<boolean | null>(null);
  const [hiddenCals, setHiddenCals] = useState<Set<string>>(new Set());
  const [hiddenCons, setHiddenCons] = useState<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<"agenda" | "consultora">("agenda");
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [creating, setCreating] = useState<Creating | null>(null);
  const [toast, setToast] = useState<Toast>(p.created ? { text: "✓ Visita criada e enviada para a agenda Google." } : null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.parse(p.now));
  const [updatedAt, setUpdatedAt] = useState(() => Date.parse(p.now));
  const [miniMonth, setMiniMonth] = useState(p.refDay.slice(0, 7));
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const colsRef = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // preferências salvas neste aparelho
  useEffect(() => {
    try {
      const saved = safeGet("agenda.hiddenCals");
      setHiddenCals(new Set(saved ? JSON.parse(saved) : p.mirror.status === "ok" ? p.mirror.calendars.filter((c) => !c.visible).map((c) => c.id) : []));
      setHiddenCons(new Set(JSON.parse(safeGet("agenda.hiddenCons") ?? "[]")));
    } catch {
      /* ignora preferência corrompida */
    }
    if (safeGet("agenda.color") === "consultora") setColorMode("consultora");
    // celular: abre no dia (a semana não cabe)
    if (window.innerWidth < 768 && p.view === "semana" && !new URLSearchParams(window.location.search).get("vista")) router.replace(`/agenda-google?vista=dia&ref=${p.refDay}`);
  }, [p.view, p.refDay, router]);
  useEffect(() => setUpdatedAt(Date.parse(p.now)), [p.now]);
  // os dados novos do Google substituem as mudanças otimistas
  useEffect(() => {
    setOverrides(new Map());
    setRemoved(new Set());
  }, [p.mirror]);

  // relógio (linha vermelha) e atualização a cada minuto com a tela aberta
  useEffect(() => {
    const t = setInterval(() => {
      setNowMs(Date.now());
      if (document.visibilityState === "visible" && !dragRef.current && !creating && !selected) startTransition(() => router.refresh());
    }, 60_000);
    return () => clearInterval(t);
  }, [router, creating, selected]);

  useEffect(() => {
    if (p.view !== "mes" && scrollRef.current) scrollRef.current.scrollTop = 6.5 * HOUR_PX;
  }, [p.view]);

  useEffect(() => {
    if (!toast || toast.undo) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = useCallback((view: View, ref: string) => router.push(`/agenda-google?vista=${view}&ref=${ref}`), [router]);
  const step = useCallback(
    (dir: 1 | -1) => {
      if (p.view === "dia") go("dia", addKey(p.refDay, dir));
      else if (p.view === "semana") go("semana", addKey(p.refDay, 7 * dir));
      else {
        const [y, m] = p.refDay.split("-").map(Number);
        const nm = m + dir;
        const k = nm === 0 ? `${y - 1}-12-01` : nm === 13 ? `${y + 1}-01-01` : `${y}-${String(nm).padStart(2, "0")}-01`;
        go("mes", k);
      }
    },
    [p.view, p.refDay, go],
  );

  const writable = useMemo(() => (p.mirror.status === "ok" ? p.mirror.calendars.filter((c) => c.canWrite) : []), [p.mirror]);
  const consColor = useMemo(() => new Map(p.consultants.map((c, i) => [c.id, CONSULTANT_COLORS[i % CONSULTANT_COLORS.length]])), [p.consultants]);
  const calendars = p.mirror.status === "ok" ? p.mirror.calendars : [];
  const calName = useMemo(() => new Map(calendars.map((c) => [c.id, c.name])), [calendars]);

  // eventos visíveis (com as mudanças que ainda estão indo para o Google)
  const events = useMemo(() => {
    const list = p.mirror.status === "ok" ? p.mirror.events : [];
    return list
      .filter((e) => !removed.has(e.key) && !hiddenCals.has(e.calendarId) && !(e.visit?.consultantId && hiddenCons.has(e.visit.consultantId)))
      .map((e) => {
        const o = overrides.get(e.key);
        return o ? { ...e, start: o.start, end: o.end } : e;
      });
  }, [p.mirror, removed, hiddenCals, hiddenCons, overrides]);
  const q = query.trim().toLowerCase();
  const matches = (e: MirrorEvent) => !q || e.title.toLowerCase().includes(q) || (e.visit?.codes ?? []).some((c) => c.includes(q)) || (e.location ?? "").toLowerCase().includes(q);
  const colorOf = (e: MirrorEvent) => (colorMode === "consultora" && e.visit?.consultantId ? (consColor.get(e.visit.consultantId) ?? e.color) : e.color);

  // ─────────────── teclado (atalhos do Google Agenda) ───────────────
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (ev.key === "Escape") {
        setSelected(null);
        setCreating(null);
        setSearchOpen(false);
        return;
      }
      if (t.closest("input, textarea, select, [contenteditable]") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === "t") go(p.view, p.today);
      else if (k === "d" || k === "1") go("dia", p.refDay);
      else if (k === "w" || k === "s" || k === "2") go("semana", p.refDay);
      else if (k === "m" || k === "3") go("mes", p.refDay);
      else if (k === "j" || k === "n" || ev.key === "ArrowRight") step(1);
      else if (k === "k" || k === "p" || ev.key === "ArrowLeft") step(-1);
      else if (k === "c") openCreateDefault();
      else if (k === "/") {
        ev.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      } else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function openCreateDefault() {
    const base = p.refDay === p.today ? nowMs : dayStart(p.refDay) + 9 * 3600_000;
    const start = Math.ceil(base / 3600_000) * 3600_000;
    setSelected(null);
    setCreating({ start, end: start + 3600_000, allDay: false, x: window.innerWidth / 2 - 200, y: 120 });
  }

  // ─────────────── mover / esticar (vai para o Google) ───────────────
  async function commitMove(e: MirrorEvent, start: number, end: number, opts: { undo?: boolean } = {}) {
    const prev = { start: e.start, end: e.end };
    setOverrides((m) => new Map(m).set(e.key, { start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
    const r = await moveEventAction({ calendarId: e.calendarId, eventId: e.id, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    if (!r.ok) {
      setOverrides((m) => new Map(m).set(e.key, prev));
      setToast({ text: r.message ?? "Não consegui mover.", error: true });
      return;
    }
    setToast(opts.undo ? { text: "Desfeito." } : { text: `${e.visit ? "Visita movida" : "Evento movido"} para ${longDate(keyOf(start))}, ${hm(start)}.`, undo: () => void commitMove({ ...e, start: new Date(start).toISOString(), end: new Date(end).toISOString() }, Date.parse(prev.start), Date.parse(prev.end), { undo: true }) });
    startTransition(() => router.refresh());
  }

  /** Avisos antes de mover uma visita: consultora ocupada, de folga, ou depois das 21h (cancela). */
  function confirmMove(e: MirrorEvent, start: number, end: number) {
    const v = e.visit;
    if (!v) return true;
    const warnings: string[] = [];
    if (minOfDay(start) >= 21 * 60) warnings.push("Depois das 21h a visita é considerada cancelada (regra da agenda). Para cancelar com o motivo, use “Cancelar visita”.");
    if (v.consultantId) {
      const busy = events.find((o) => o.key !== e.key && o.visit?.consultantId === v.consultantId && o.visit.status !== "CANCELED" && !o.allDay && Date.parse(o.start) < end && Date.parse(o.end) > start);
      if (busy) warnings.push(`${v.consultant?.split(" ")[0]} já tem visita nesse horário (${hm(Date.parse(busy.start))} · ${busy.title}).`);
      const first = (v.consultant ?? "").split(" ")[0].toLowerCase();
      const k = keyOf(start);
      const off = first && events.find((o) => o.allDay && o.startDay! <= k && o.endDay! > k && /day ?off|folga|f[ée]rias/i.test(o.title) && o.title.toLowerCase().includes(first));
      if (off) warnings.push(`${v.consultant?.split(" ")[0]} está de folga nesse dia (${off.title}).`);
    }
    return warnings.length === 0 || window.confirm(`${warnings.join("\n\n")}\n\nMover mesmo assim?`);
  }

  function colAt(clientX: number) {
    const cols = colsRef.current;
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i]?.getBoundingClientRect();
      if (r && clientX >= r.left && clientX < r.right) return i;
    }
    return clientX < (cols[0]?.getBoundingClientRect().left ?? 0) ? 0 : cols.length - 1;
  }

  function onEventPointerDown(ev: React.PointerEvent, e: MirrorEvent, col: number, mode: "move" | "resize") {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const d: Drag = { key: e.key, mode, x: ev.clientX, y: ev.clientY, col, start: Date.parse(e.start), end: Date.parse(e.end), moved: false, preview: null };
    dragRef.current = d;
    setDrag(d);
  }
  function onPointerMove(ev: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dy = ev.clientY - d.y;
    const col = d.mode === "move" ? colAt(ev.clientX) : d.col;
    if (!d.moved && Math.abs(dy) < 5 && col === d.col && Math.abs(ev.clientX - d.x) < 5) return;
    const e = events.find((x) => x.key === d.key);
    if (!e?.canEdit) {
      d.moved = true; // não move eventos de outras pessoas (só abre os detalhes no clique)
      return;
    }
    const delta = Math.round(((dy / HOUR_PX) * 60) / SNAP) * SNAP * 60_000;
    const next = d.mode === "move" ? { start: d.start + delta + (col - d.col) * DAY, end: d.end + delta + (col - d.col) * DAY } : { start: d.start, end: Math.max(d.start + SNAP * 60_000, d.end + delta) };
    const nd = { ...d, moved: true, preview: next };
    dragRef.current = nd;
    setDrag(nd);
  }
  function onPointerUp(ev: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const e = events.find((x) => x.key === d.key);
    if (!e) return;
    if (!d.moved) {
      setCreating(null);
      setSelected({ key: e.key, x: ev.clientX, y: ev.clientY });
      return;
    }
    if (!e.canEdit) {
      setToast({ text: e.visit ? "Este evento é de outra pessoa (a consultora): só quem criou pode mudar o horário." : "Este evento é de outra pessoa: só quem criou pode mudar.", error: true });
      return;
    }
    if (!d.preview || (d.preview.start === d.start && d.preview.end === d.end)) return;
    if (!confirmMove(e, d.preview.start, d.preview.end)) return;
    void commitMove(e, d.preview.start, d.preview.end);
  }

  // criar arrastando num horário vazio (como no Google)
  const createDrag = useRef<{ col: number; anchor: number; cur: number } | null>(null);
  const [createPreview, setCreatePreview] = useState<{ col: number; a: number; b: number } | null>(null);
  const minuteAt = (col: number, clientY: number) => {
    const r = colsRef.current[col]?.getBoundingClientRect();
    if (!r) return 0;
    return Math.max(0, Math.min(24 * 60 - SNAP, Math.floor((((clientY - r.top) / HOUR_PX) * 60) / SNAP) * SNAP));
  };
  function onColPointerDown(ev: React.PointerEvent, col: number) {
    if (ev.button !== 0 || !writable.length) return;
    if (selected || creating) {
      setSelected(null);
      setCreating(null);
      return;
    }
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const m = Math.floor(minuteAt(col, ev.clientY) / 30) * 30;
    createDrag.current = { col, anchor: m, cur: m };
    setCreatePreview({ col, a: m, b: m + 60 });
  }
  function onColPointerMove(ev: React.PointerEvent) {
    const c = createDrag.current;
    if (!c) return;
    const m = minuteAt(c.col, ev.clientY);
    c.cur = m;
    setCreatePreview({ col: c.col, a: Math.min(c.anchor, m), b: Math.max(c.anchor + (m > c.anchor ? 0 : 30), m + SNAP) });
  }
  function onColPointerUp(ev: React.PointerEvent) {
    const c = createDrag.current;
    createDrag.current = null;
    if (!c || !createPreview) return;
    const day = p.days[p.view === "dia" ? 0 : c.col] ?? p.refDay;
    const dragged = Math.abs(c.cur - c.anchor) >= SNAP;
    const a = dragged ? createPreview.a : c.anchor;
    const b = dragged ? createPreview.b : c.anchor + 60;
    setCreating({ start: dayStart(day) + a * 60_000, end: dayStart(day) + b * 60_000, allDay: false, x: ev.clientX, y: ev.clientY });
  }
  useEffect(() => {
    if (!creating) setCreatePreview(null);
  }, [creating]);

  const sel = selected ? (events.find((e) => e.key === selected.key) ?? null) : null;
  const weekDays = p.view === "mes" ? [] : p.days;
  const title = p.view === "mes" ? cap(`${MONTH[Number(p.refDay.slice(5, 7)) - 1]} de ${p.refDay.slice(0, 4)}`) : (() => {
    const a = p.days[0];
    const b = p.days[p.days.length - 1];
    const ma = Number(a.slice(5, 7)) - 1;
    const mb = Number(b.slice(5, 7)) - 1;
    if (p.view === "dia") return `${dd(a)} de ${MONTH[ma]} de ${a.slice(0, 4)}`;
    return ma === mb ? cap(`${MONTH[ma]} de ${a.slice(0, 4)}`) : cap(`${MONTH[ma].slice(0, 3)} – ${MONTH[mb].slice(0, 3)} de ${b.slice(0, 4)}`);
  })();

  return (
    <div className="flex h-[calc(100dvh-57px-76px)] flex-col bg-surface text-ink md:h-[calc(100dvh-57px)]" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {/* barra do topo */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2 sm:gap-3 sm:px-4">
        <button type="button" onClick={() => setSidebar((s) => (s === null ? window.innerWidth < 1024 : !s))} aria-label="Menu principal" className="grid size-10 place-items-center rounded-full hover:bg-tint">
          <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
            <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />
          </svg>
        </button>
        <span className="hidden items-center gap-2 sm:flex">
          <span aria-hidden className="relative grid size-9 place-items-center rounded-lg text-[13px] font-bold text-white" style={{ background: TODAY_BLUE }}>
            {dd(p.today)}
          </span>
          <span className="text-[20px] tracking-[-0.01em] text-ink-2">Agenda</span>
        </span>
        <button type="button" onClick={() => go(p.view, p.today)} className="ml-1 min-h-9 shrink-0 rounded-full border border-line-strong px-3 text-[14px] font-semibold hover:bg-tint sm:ml-6 sm:px-4">
          Hoje
        </button>
        <span className="flex">
          <button type="button" onClick={() => step(-1)} aria-label="Anterior" className="grid size-9 place-items-center rounded-full text-[20px] hover:bg-tint">
            ‹
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Próximo" className="grid size-9 place-items-center rounded-full text-[20px] hover:bg-tint">
            ›
          </button>
        </span>
        <h1 className="hidden min-w-0 truncate text-[22px] sm:block">{title}</h1>
        <h1 className="shrink-0 text-[16px] font-semibold sm:hidden">{p.view === "dia" ? `${dd(p.refDay)} ${MONTH[Number(p.refDay.slice(5, 7)) - 1].slice(0, 3)}` : cap(MONTH[Number(p.refDay.slice(5, 7)) - 1].slice(0, 3))}</h1>
        <span className="ml-auto flex items-center gap-1 sm:gap-2">
          {searchOpen ? (
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => !query && setSearchOpen(false)} placeholder="Buscar cliente, código…" aria-label="Buscar na agenda" className="h-9 w-40 rounded-full border border-line-strong bg-surface px-3 text-[14px] sm:w-64" />
          ) : (
            <button type="button" onClick={() => (setSearchOpen(true), setTimeout(() => searchRef.current?.focus(), 0))} aria-label="Pesquisar" className="grid size-10 place-items-center rounded-full hover:bg-tint">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
          )}
          <span className="hidden text-[12px] text-ink-3 lg:inline" title="A agenda atualiza sozinha a cada minuto">
            Atualizado às {hm(updatedAt)}
          </span>
          <select value={p.view} onChange={(e) => go(e.target.value as View, p.refDay)} aria-label="Visualização" className="h-9 shrink-0 rounded-full border border-line-strong bg-surface px-2 text-[14px] font-semibold sm:px-3">
            <option value="dia">Dia</option>
            <option value="semana">Semana</option>
            <option value="mes">Mês</option>
          </select>
        </span>
      </header>

      {p.banner && <div className="px-4 pt-3">{p.banner}</div>}
      {p.mirror.status !== "ok" && (
        <p role="alert" className="mx-4 mt-3 rounded-2xl bg-bad-soft px-4 py-3 text-[14px] font-semibold text-bad">
          {p.mirror.status === "no_connection" ? "A agenda Google não está conectada. Peça à gestão para conectar em Integração Google." : p.mirror.status === "auth" ? "A conexão com a agenda Google expirou. Peça à gestão para reconectar em Integração Google." : "Não consegui ler a agenda Google agora. Ela tenta de novo em 1 minuto."}
        </p>
      )}
      {p.mirror.status === "ok" && !p.mirror.canWrite && <p className="mx-4 mt-3 rounded-2xl bg-accent-soft px-4 py-2.5 text-[13px] text-accent-strong">Só leitura: o app ainda não tem permissão para editar a agenda Google.</p>}

      <div className="flex min-h-0 flex-1">
        {/* lateral */}
        {sidebar !== false && (
          <aside className={`${sidebar === null ? "max-lg:hidden" : ""} w-64 shrink-0 overflow-y-auto border-r border-line px-3 py-3 max-lg:absolute max-lg:z-30 max-lg:h-[calc(100dvh-110px)] max-lg:bg-surface max-lg:shadow-float`}>
            <button type="button" onClick={openCreateDefault} disabled={!writable.length} className="mb-5 flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-5 text-[15px] font-semibold shadow-[0_1px_3px_rgb(0_0_0/0.3),0_4px_8px_3px_rgb(0_0_0/0.15)] hover:bg-tint disabled:opacity-50">
              <svg viewBox="0 0 36 36" className="size-7" aria-hidden>
                <path fill="#34A853" d="M16 16v14h4V20z" />
                <path fill="#4285F4" d="M30 16H20l-4 4h14z" />
                <path fill="#FBBC05" d="M6 16v4h10l4-4z" />
                <path fill="#EA4335" d="M20 16V6h-4v14z" />
              </svg>
              Criar
            </button>
            <MiniMonth month={miniMonth} setMonth={setMiniMonth} today={p.today} days={p.view === "mes" ? [] : p.days} onPick={(k) => go(p.view, k)} />
            <p className="mt-5 mb-1 px-2 text-[14px] font-semibold">Minhas agendas</p>
            <ul>
              {calendars.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-2 text-[14px] hover:bg-tint">
                    <input
                      type="checkbox"
                      checked={!hiddenCals.has(c.id)}
                      onChange={() => {
                        const s = new Set(hiddenCals);
                        if (s.has(c.id)) s.delete(c.id);
                        else s.add(c.id);
                        setHiddenCals(s);
                        safeSet("agenda.hiddenCals", JSON.stringify([...s]));
                      }}
                      className="size-4.5 rounded"
                      style={{ accentColor: c.color }}
                    />
                    <span className="min-w-0 truncate" title={c.name}>
                      {c.name}
                    </span>
                    {!c.canWrite && <span className="ml-auto shrink-0 text-[11px] text-ink-3">só ver</span>}
                  </label>
                </li>
              ))}
            </ul>
            {p.consultants.length > 0 && (
              <>
                <p className="mt-5 mb-1 px-2 text-[14px] font-semibold">Consultoras</p>
                <ul>
                  {p.consultants.map((c) => {
                    const n = events.filter((e) => e.visit?.consultantId === c.id && e.visit.status !== "CANCELED").length;
                    return (
                      <li key={c.id}>
                        <label className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-2 text-[14px] hover:bg-tint">
                          <input
                            type="checkbox"
                            checked={!hiddenCons.has(c.id)}
                            onChange={() => {
                              const s = new Set(hiddenCons);
                              if (s.has(c.id)) s.delete(c.id);
                              else s.add(c.id);
                              setHiddenCons(s);
                              safeSet("agenda.hiddenCons", JSON.stringify([...s]));
                            }}
                            className="size-4.5"
                            style={{ accentColor: consColor.get(c.id) }}
                          />
                          <span className="min-w-0 truncate">{c.name}</span>
                          <span className="num ml-auto text-[12px] text-ink-3" title="Visitas no período visível">
                            {n}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 mb-1.5 px-2 text-[13px] font-semibold text-ink-2">Cor das visitas</p>
                <div className="mx-2 flex rounded-full border border-line p-0.5 text-[13px]">
                  {(["agenda", "consultora"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setColorMode(m);
                        safeSet("agenda.color", m);
                      }}
                      className={`flex-1 rounded-full py-1.5 font-semibold ${colorMode === m ? "bg-ink text-bg" : "text-ink-2"}`}
                    >
                      {m === "agenda" ? "Da agenda" : "Por consultora"}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="mt-5 px-2 text-[12px] leading-relaxed text-ink-3">
              Tudo o que você muda aqui vai na hora para a agenda Google. A tela atualiza sozinha a cada minuto.
              <br />
              Atalhos: <b>T</b> hoje · <b>D</b>/<b>W</b>/<b>M</b> dia, semana, mês · <b>J</b>/<b>K</b> avançar, voltar · <b>C</b> criar · <b>/</b> buscar
            </p>
          </aside>
        )}

        {/* grade */}
        <section className="flex min-w-0 flex-1 flex-col select-none" aria-label="Agenda">
          {p.view === "mes" ? (
            <MonthGrid days={p.days} refDay={p.refDay} today={p.today} events={events} colorOf={colorOf} matches={matches} onOpen={(e, x, y) => (setCreating(null), setSelected({ key: e.key, x, y }))} onDay={(k) => go("dia", k)} onCreate={(k, x, y) => writable.length && (setSelected(null), setCreating({ start: dayStart(k), end: dayStart(k) + DAY, allDay: true, x, y }))} />
          ) : (
            <>
              {/* cabeçalho dos dias + eventos de dia inteiro */}
              <div className="grid shrink-0 border-b border-line pr-[10px]" style={{ gridTemplateColumns: `56px repeat(${weekDays.length}, minmax(0,1fr))` }}>
                <div className="flex items-end justify-end pr-2 pb-1 text-[10px] text-ink-3">GMT-03</div>
                {weekDays.map((k) => {
                  const isToday = k === p.today;
                  const visits = events.filter((e) => e.visit && e.visit.status !== "CANCELED" && keyOf(Date.parse(e.start)) === k).length;
                  return (
                    <div key={k} className="flex flex-col items-center border-l border-line pt-2 pb-1">
                      <span className="text-[11px] font-semibold tracking-wide" style={{ color: isToday ? TODAY_BLUE : undefined }}>
                        {WEEKDAY[dowOf(k)]}
                      </span>
                      <button type="button" onClick={() => go("dia", k)} className="grid size-11 place-items-center rounded-full text-[24px] hover:bg-tint" style={isToday ? { background: TODAY_BLUE, color: "#fff" } : undefined} aria-label={longDate(k)}>
                        {dd(k)}
                      </button>
                      {visits > 0 && <span className="text-[11px] text-ink-3">{visits} visita{visits > 1 ? "s" : ""}</span>}
                    </div>
                  );
                })}
                <AllDayRow days={weekDays} events={events} colorOf={colorOf} matches={matches} onOpen={(e, x, y) => (setCreating(null), setSelected({ key: e.key, x, y }))} onCreate={(k, x, y) => writable.length && (setSelected(null), setCreating({ start: dayStart(k), end: dayStart(k) + DAY, allDay: true, x, y }))} />
              </div>
              <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
                <div className="grid" style={{ gridTemplateColumns: `56px repeat(${weekDays.length}, minmax(0,1fr))`, height: 24 * HOUR_PX }}>
                  <div className="relative">
                    {Array.from({ length: 23 }, (_, i) => (
                      <span key={i} className="absolute right-2 -translate-y-1/2 text-[10px] text-ink-3" style={{ top: (i + 1) * HOUR_PX }}>
                        {String(i + 1).padStart(2, "0")}:00
                      </span>
                    ))}
                  </div>
                  {weekDays.map((k, col) => (
                    <DayColumn
                      key={k}
                      colRef={(el) => (colsRef.current[col] = el)}
                      day={k}
                      col={col}
                      isToday={k === p.today}
                      nowMs={nowMs}
                      events={events.filter((e) => !e.allDay && Date.parse(e.start) < dayStart(k) + DAY && Date.parse(e.end) > dayStart(k))}
                      drag={drag}
                      allEvents={events}
                      colorOf={colorOf}
                      matches={matches}
                      createPreview={createPreview?.col === col ? createPreview : null}
                      onEventDown={onEventPointerDown}
                      onOpen={(e, x, y) => (setCreating(null), setSelected({ key: e.key, x, y }))}
                      onColDown={onColPointerDown}
                      onColMove={onColPointerMove}
                      onColUp={onColPointerUp}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {sel && selected && (
        <Popover x={selected.x} y={selected.y} onClose={() => setSelected(null)}>
          <EventDetails
            e={sel}
            color={colorOf(sel)}
            calendar={calName.get(sel.calendarId) ?? sel.calendarId}
            reasons={p.reasons}
            back={p.back}
            nowMs={nowMs}
            onClose={() => setSelected(null)}
            onDone={(text, removedKey) => {
              setSelected(null);
              if (removedKey) setRemoved((s) => new Set(s).add(removedKey));
              setToast({ text });
              startTransition(() => router.refresh());
            }}
            onError={(text) => setToast({ text, error: true })}
          />
        </Popover>
      )}
      {creating && (
        <Popover x={creating.x} y={creating.y} onClose={() => setCreating(null)}>
          <CreateForm
            c={creating}
            calendars={writable}
            onClose={() => setCreating(null)}
            onVisit={(day, time, dur) => router.push(`/agenda-do-dia/nova?data=${day}&hora=${time}&duracao=${dur}&volta=google`)}
            onDone={(text) => {
              setCreating(null);
              setToast({ text });
              startTransition(() => router.refresh());
            }}
          />
        </Popover>
      )}
      {toast && (
        <div role="status" className={`fixed bottom-24 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-4 rounded-lg px-4 py-3 text-[14px] shadow-float md:bottom-6 ${toast.error ? "bg-bad text-white" : "bg-[#323232] text-white"}`}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const u = toast.undo!;
                setToast(null);
                u();
              }}
              className="font-bold text-[#8ab4f8]"
            >
              Desfazer
            </button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar" className="text-white/70">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────── coluna de um dia (eventos com horário) ───────────────
function layoutColumns(list: { key: string; s: number; e: number }[]) {
  // eventos que se sobrepõem ficam lado a lado (como no Google)
  const sorted = [...list].sort((a, b) => a.s - b.s || b.e - a.e);
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: { key: string; s: number; e: number; col: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) out.set(c.key, { col: c.col, cols: n });
    cluster = [];
  };
  for (const it of sorted) {
    if (it.s >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.e > it.s).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...it, col });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

function DayColumn(props: {
  colRef: (el: HTMLDivElement | null) => void;
  day: string;
  col: number;
  isToday: boolean;
  nowMs: number;
  events: MirrorEvent[];
  allEvents: MirrorEvent[];
  drag: Drag | null;
  colorOf: (e: MirrorEvent) => string;
  matches: (e: MirrorEvent) => boolean;
  createPreview: { a: number; b: number } | null;
  onEventDown: (ev: React.PointerEvent, e: MirrorEvent, col: number, mode: "move" | "resize") => void;
  onOpen: (e: MirrorEvent, x: number, y: number) => void;
  onColDown: (ev: React.PointerEvent, col: number) => void;
  onColMove: (ev: React.PointerEvent) => void;
  onColUp: (ev: React.PointerEvent) => void;
}) {
  const ds = dayStart(props.day);
  const de = ds + DAY;
  const d = props.drag;
  // o evento sendo arrastado aparece na nova posição (pode ter vindo de outro dia)
  const dragged = d?.preview ? props.allEvents.find((e) => e.key === d.key) : null;
  const list = props.events.filter((e) => !(dragged && e.key === dragged.key));
  const items = list.map((e) => ({ e, s: Math.max(Date.parse(e.start), ds), en: Math.min(Date.parse(e.end), de) }));
  const lay = layoutColumns(items.map((i) => ({ key: i.e.key, s: i.s, e: Math.max(i.en, i.s + 20 * 60_000) })));
  const ghost = dragged && d?.preview && d.preview.start < de && d.preview.end > ds ? { e: dragged, s: Math.max(d.preview.start, ds), en: Math.min(d.preview.end, de) } : null;
  const block = (it: { e: MirrorEvent; s: number; en: number }, pos: { col: number; cols: number }, isGhost = false) => {
    const { e } = it;
    const top = ((it.s - ds) / 3600_000) * HOUR_PX;
    const h = Math.max(((it.en - it.s) / 3600_000) * HOUR_PX - 2, 18);
    const bg = props.colorOf(e);
    const fg = textOn(bg);
    const canceled = e.visit?.status === "CANCELED";
    const short = h < 36;
    const badge = visitBadge(e);
    return (
      <div
        key={e.key + (isGhost ? "-g" : "")}
        role="button"
        tabIndex={0}
        aria-label={`${e.title}, ${hm(Date.parse(e.start))} a ${hm(Date.parse(e.end))}`}
        onPointerDown={(ev) => props.onEventDown(ev, e, props.col, "move")}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
            props.onOpen(e, r.right, r.top + 20);
          }
        }}
        className={`absolute overflow-hidden rounded-md px-1.5 text-left text-[12px] leading-tight shadow-sm ${e.canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${isGhost ? "z-20 opacity-90 ring-2 ring-white" : "z-10"} ${props.matches(e) ? "" : "opacity-25"}`}
        style={{
          top,
          height: h,
          left: `calc(${(pos.col / pos.cols) * 100}% + 1px)`,
          width: `calc(${100 / pos.cols}% - ${pos.cols > 1 ? 3 : 8}px)`,
          background: e.declined ? "transparent" : canceled ? `color-mix(in srgb, ${bg} 35%, var(--surface))` : bg,
          color: e.declined ? bg : canceled ? "var(--ink-2)" : fg,
          border: e.declined ? `1px solid ${bg}` : "1px solid var(--surface)",
        }}
      >
        <p className={`truncate font-semibold ${canceled ? "line-through" : ""} ${short ? "py-0.5" : "pt-0.5"}`}>
          {e.title}
          {short && <span className="font-normal">, {hm(Date.parse(e.start))}</span>}
        </p>
        {!short && (
          <p className="truncate opacity-90">
            {hm(Date.parse(isGhost ? new Date(it.s).toISOString() : e.start))} – {hm(isGhost && d?.preview ? d.preview.end : Date.parse(e.end))}
          </p>
        )}
        {!short && h > 52 && badge && <p className="truncate text-[11px] opacity-90">{e.visit?.consultant ? `${e.visit.consultant.split(" ")[0]} · ` : ""}{badge}</p>}
        {e.canEdit && !short && <span onPointerDown={(ev) => props.onEventDown(ev, e, props.col, "resize")} aria-hidden className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize" />}
      </div>
    );
  };
  const nowTop = props.isToday ? ((props.nowMs - ds) / 3600_000) * HOUR_PX : null;
  return (
    <div
      ref={props.colRef}
      className="relative border-l border-line"
      style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--line) ${HOUR_PX - 1}px, var(--line) ${HOUR_PX}px)` }}
      onPointerDown={(ev) => props.onColDown(ev, props.col)}
      onPointerMove={props.onColMove}
      onPointerUp={props.onColUp}
    >
      {items.map((it) => block(it, lay.get(it.e.key) ?? { col: 0, cols: 1 }))}
      {ghost && block(ghost, { col: 0, cols: 1 }, true)}
      {props.createPreview && (
        <div className="pointer-events-none absolute right-2 left-0.5 z-20 rounded-md px-1.5 pt-0.5 text-[12px] font-semibold text-white shadow-float" style={{ top: (props.createPreview.a / 60) * HOUR_PX, height: Math.max(((props.createPreview.b - props.createPreview.a) / 60) * HOUR_PX - 2, 18), background: TODAY_BLUE }}>
          (Sem título)
          <span className="block font-normal opacity-90">
            {hm(ds + props.createPreview.a * 60_000)} – {hm(ds + props.createPreview.b * 60_000)}
          </span>
        </div>
      )}
      {nowTop !== null && nowTop >= 0 && nowTop <= 24 * HOUR_PX && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-30" style={{ top: nowTop }}>
          <span className="absolute -top-[6px] -left-[6px] size-3 rounded-full bg-[#ea4335]" />
          <span className="block h-[2px] bg-[#ea4335]" />
        </div>
      )}
    </div>
  );
}

// ─────────────── dia inteiro (faixa do topo) ───────────────
function AllDayRow({ days, events, colorOf, matches, onOpen, onCreate }: { days: string[]; events: MirrorEvent[]; colorOf: (e: MirrorEvent) => string; matches: (e: MirrorEvent) => boolean; onOpen: (e: MirrorEvent, x: number, y: number) => void; onCreate: (k: string, x: number, y: number) => void }) {
  const first = days[0];
  const last = days[days.length - 1];
  // eventos de dia inteiro (ou de vários dias) atravessam as colunas, em faixas
  const list = events
    .filter((e) => e.allDay && e.startDay! <= last && e.endDay! > first)
    .map((e) => ({ e, a: Math.max(0, days.indexOf(e.startDay!) === -1 ? 0 : days.indexOf(e.startDay!)), b: days.indexOf(addKey(e.endDay!, -1)) === -1 ? days.length - 1 : days.indexOf(addKey(e.endDay!, -1)) }))
    .sort((x, y) => x.a - y.a || y.b - y.a - (x.b - x.a));
  const lanes: number[][] = [];
  const placed = list.map((it) => {
    let lane = 0;
    while ((lanes[lane] ?? []).some((c) => c >= it.a && c <= it.b)) lane++;
    lanes[lane] = [...(lanes[lane] ?? []), ...Array.from({ length: it.b - it.a + 1 }, (_, i) => it.a + i)];
    return { ...it, lane };
  });
  return (
    <div className="relative col-span-full grid min-h-6 pb-1" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))`, gridAutoRows: "24px" }}>
      {days.map((k, i) => (
        <button key={k} type="button" aria-label={`Criar evento de dia inteiro em ${longDate(k)}`} onClick={(ev) => onCreate(k, ev.clientX, ev.clientY)} className="border-l border-line" style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(1, lanes.length)}` }} />
      ))}
      {placed.map(({ e, a, b, lane }) => {
        const bg = colorOf(e);
        return (
          <button
            key={e.key}
            type="button"
            onClick={(ev) => onOpen(e, ev.clientX, ev.clientY)}
            className={`z-10 mx-0.5 mt-0.5 truncate rounded px-2 text-left text-[12px] font-semibold ${matches(e) ? "" : "opacity-25"}`}
            style={{ gridColumn: `${a + 2} / ${b + 3}`, gridRow: lane + 1, background: e.declined ? "transparent" : bg, color: e.declined ? bg : textOn(bg), border: `1px solid ${e.declined ? bg : "transparent"}` }}
          >
            {e.title}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────── mês ───────────────
function MonthGrid({ days, refDay, today, events, colorOf, matches, onOpen, onDay, onCreate }: { days: string[]; refDay: string; today: string; events: MirrorEvent[]; colorOf: (e: MirrorEvent) => string; matches: (e: MirrorEvent) => boolean; onOpen: (e: MirrorEvent, x: number, y: number) => void; onDay: (k: string) => void; onCreate: (k: string, x: number, y: number) => void }) {
  const month = refDay.slice(0, 7);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAY.map((w) => (
          <span key={w} className="border-l border-line py-1.5 text-center text-[11px] font-semibold text-ink-2 first:border-l-0">
            {w}
          </span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((k) => {
          const list = events
            .filter((e) => (e.allDay ? e.startDay! <= k && e.endDay! > k : keyOf(Date.parse(e.start)) === k))
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start));
          const shown = list.slice(0, 3);
          return (
            <div key={k} onClick={(ev) => ev.target === ev.currentTarget && onCreate(k, ev.clientX, ev.clientY)} className={`min-h-0 overflow-hidden border-b border-l border-line px-1 pt-1 ${k.slice(0, 7) !== month ? "bg-surface-2" : ""}`}>
              <div className="pointer-events-none flex justify-center">
                <button type="button" onClick={() => onDay(k)} className="pointer-events-auto grid size-7 place-items-center rounded-full text-[12px] font-semibold hover:bg-tint" style={k === today ? { background: TODAY_BLUE, color: "#fff" } : k.slice(0, 7) !== month ? { color: "var(--ink-3)" } : undefined}>
                  {dd(k) === 1 ? `${dd(k)} ${MONTH[Number(k.slice(5, 7)) - 1].slice(0, 3)}` : dd(k)}
                </button>
              </div>
              {shown.map((e) => {
                const bg = colorOf(e);
                return (
                  <button key={e.key} type="button" onClick={(ev) => onOpen(e, ev.clientX, ev.clientY)} className={`mb-0.5 flex w-full items-center gap-1 truncate rounded px-1 text-left text-[12px] ${matches(e) ? "" : "opacity-25"} ${e.allDay ? "font-semibold" : "hover:bg-tint"}`} style={e.allDay ? { background: bg, color: textOn(bg) } : undefined}>
                    {!e.allDay && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: bg }} />}
                    {!e.allDay && <span className="shrink-0 text-ink-2">{hm(Date.parse(e.start))}</span>}
                    <span className={`truncate ${e.visit?.status === "CANCELED" ? "line-through opacity-70" : ""}`}>{e.title}</span>
                  </button>
                );
              })}
              {list.length > 3 && (
                <button type="button" onClick={() => onDay(k)} className="px-1 text-[12px] font-semibold text-ink-2 hover:underline">
                  Mais {list.length - 3}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────── mini calendário ───────────────
function MiniMonth({ month, setMonth, today, days, onPick }: { month: string; setMonth: (m: string) => void; today: string; days: string[]; onPick: (k: string) => void }) {
  const first = `${month}-01`;
  const start = addKey(first, -dowOf(first));
  const cells = Array.from({ length: 42 }, (_, i) => addKey(start, i));
  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => {
    const nm = m + n;
    setMonth(nm === 0 ? `${y - 1}-12` : nm === 13 ? `${y + 1}-01` : `${y}-${String(nm).padStart(2, "0")}`);
  };
  const inView = new Set(days);
  return (
    <div className="px-1">
      <div className="mb-1 flex items-center justify-between pl-2">
        <span className="text-[14px] font-semibold">{cap(`${MONTH[m - 1]} de ${y}`)}</span>
        <span>
          <button type="button" onClick={() => shift(-1)} aria-label="Mês anterior" className="size-7 rounded-full hover:bg-tint">
            ‹
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Próximo mês" className="size-7 rounded-full hover:bg-tint">
            ›
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px]">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
          <span key={i} className="py-1 font-semibold text-ink-3">
            {d}
          </span>
        ))}
        {cells.map((k) => (
          <button key={k} type="button" onClick={() => onPick(k)} className={`mx-auto grid size-7 place-items-center rounded-full ${k.slice(0, 7) !== month ? "text-ink-3" : ""} ${inView.has(k) && k !== today ? "bg-[#d3e3fd] text-[#041e49]" : "hover:bg-tint"}`} style={k === today ? { background: TODAY_BLUE, color: "#fff" } : undefined}>
            {dd(k)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────── janelas (detalhes / criar) ───────────────
function Popover({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + 16 + w < window.innerWidth ? x + 16 : Math.max(8, x - w - 16);
    const top = Math.max(8, Math.min(y - 40, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [x, y]);
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div ref={ref} role="dialog" className="fixed z-50 max-h-[85dvh] w-[min(448px,calc(100vw-16px))] overflow-y-auto rounded-2xl bg-surface p-4 shadow-[0_24px_38px_3px_rgb(0_0_0/0.14),0_9px_46px_8px_rgb(0_0_0/0.12)] max-sm:inset-x-2 max-sm:top-auto! max-sm:bottom-2 max-sm:left-2! max-sm:w-auto" style={pos ?? { left: -9999, top: 0 }}>
        {children}
      </div>
    </>
  );
}

function EventDetails({ e, color, calendar, reasons, back, nowMs, onClose, onDone, onError }: { e: MirrorEvent; color: string; calendar: string; reasons: Item[]; back: string; nowMs: number; onClose: () => void; onDone: (text: string, removedKey?: string) => void; onError: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [titleV, setTitleV] = useState(e.title);
  const [descV, setDescV] = useState(e.description ?? "");
  const [pending, start] = useTransition();
  const s = Date.parse(e.start);
  const en = Date.parse(e.end);
  const when = e.allDay
    ? e.endDay && addKey(e.endDay, -1) !== e.startDay
      ? `${longDate(e.startDay!)} – ${longDate(addKey(e.endDay, -1))}`
      : longDate(e.startDay!)
    : `${longDate(keyOf(s))} · ${hm(s)} – ${hm(en)}`;
  const v = e.visit;
  const canCancel = v && v.status === "SCHEDULED" && en > nowMs;
  const firstCode = v?.openCodes[0] ?? v?.codes[0] ?? null;
  return (
    <div className="text-[14px]">
      <div className="-mt-1 mb-2 flex justify-end gap-1">
        {e.htmlLink && (
          <a href={e.htmlLink} target="_blank" rel="noopener noreferrer" title="Abrir no Google Agenda" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-tint">
            ↗
          </a>
        )}
        {!v && e.canEdit && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)} title="Editar" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-tint">
              ✎
            </button>
            <button
              type="button"
              title="Excluir"
              disabled={pending}
              onClick={() =>
                window.confirm(`Excluir “${e.title}” da agenda Google?`) &&
                start(async () => {
                  const r = await deleteEventAction({ calendarId: e.calendarId, eventId: e.id });
                  if (r.ok) onDone("Evento excluído.", e.key);
                  else onError(r.message ?? "Não consegui excluir.");
                })
              }
              className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-tint"
            >
              🗑
            </button>
          </>
        )}
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-tint">
          ✕
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <input value={titleV} onChange={(x) => setTitleV(x.target.value)} aria-label="Título" className="w-full border-b-2 border-[#1a73e8] bg-transparent py-1.5 text-[20px] outline-none" />
          <textarea value={descV} onChange={(x) => setDescV(x.target.value)} rows={3} aria-label="Descrição" placeholder="Descrição" className="w-full rounded-lg bg-tint p-2 text-[14px]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 rounded-full px-4 font-semibold text-ink-2">
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await editEventAction({ calendarId: e.calendarId, eventId: e.id, title: titleV, description: descV });
                  if (r.ok) onDone("Evento salvo.");
                  else onError(r.message ?? "Não consegui salvar.");
                })
              }
              className="min-h-9 rounded-full px-5 font-semibold text-white"
              style={{ background: TODAY_BLUE }}
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-4">
            <span aria-hidden className="mt-1.5 size-4 shrink-0 rounded" style={{ background: color }} />
            <div className="min-w-0">
              <p className={`text-[20px] leading-snug break-words ${v?.status === "CANCELED" ? "line-through opacity-70" : ""}`}>{e.title}</p>
              <p className="mt-0.5 text-ink-2">{cap(when)}</p>
              {e.recurring && <p className="text-[13px] text-ink-3">Evento recorrente (muda só este)</p>}
            </div>
          </div>
          {v && (
            <div className="mt-3 rounded-xl bg-tint px-3 py-2.5">
              <p className="font-semibold">
                {visitBadge(e)}
                {v.consultant ? ` · ${v.consultant}` : " · sem consultora"}
              </p>
              {v.codes.length > 0 && <p className="text-[13px] text-ink-2">Imóve{v.codes.length > 1 ? "is" : "l"} {v.codes.join(", ")}</p>}
              {v.cancelReason && <p className="text-[13px] text-ink-2">Motivo: {v.cancelReason}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/visitas/${v.id}`} className="inline-flex min-h-9 items-center rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-semibold">
                  Abrir visita
                </Link>
              </div>
              {canCancel && (
                <div className="mt-2">
                  <CancelVisit visitId={v.id} code={firstCode} others={v.openCodes.filter((c) => c !== firstCode)} label={`${hm(s)} · ${e.title}`} reasons={reasons} back={back} />
                </div>
              )}
            </div>
          )}
          {e.location && <p className="mt-3 flex gap-4 text-ink-2"><span aria-hidden>📍</span>{e.location}</p>}
          {e.description && <p className="mt-3 max-h-40 overflow-y-auto text-[13px] whitespace-pre-wrap text-ink-2">{e.description.replace(/<[^>]+>/g, " ")}</p>}
          {e.attendees.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-semibold">{e.attendees.length} convidado{e.attendees.length > 1 ? "s" : ""}</p>
              <ul className="mt-1 space-y-0.5 text-[13px] text-ink-2">
                {e.attendees.map((a) => (
                  <li key={a.email} className="flex items-center gap-2">
                    <span aria-hidden className={a.status === "accepted" ? "text-good" : a.status === "declined" ? "text-bad" : "text-ink-3"}>
                      {a.status === "accepted" ? "✓" : a.status === "declined" ? "✕" : "?"}
                    </span>
                    <span className="truncate">{a.email}</span>
                    {a.email === e.organizer && <span className="text-[11px] text-ink-3">organizador</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-3">
            <span aria-hidden>📅</span>
            {calendar}
            {!e.canEdit && " · só quem criou pode mudar"}
          </p>
        </>
      )}
    </div>
  );
}

function CreateForm({ c, calendars, onClose, onVisit, onDone }: { c: Creating; calendars: { id: string; name: string; primary: boolean; color: string }[]; onClose: () => void; onVisit: (day: string, time: string, dur: number) => void; onDone: (text: string) => void }) {
  const [tab, setTab] = useState<"evento" | "visita">(c.allDay ? "evento" : "visita");
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(keyOf(c.start));
  const [from, setFrom] = useState(hm(c.start));
  const [to, setTo] = useState(c.allDay ? "10:00" : hm(c.end));
  const [allDay, setAllDay] = useState(c.allDay);
  const [cal, setCal] = useState(calendars.find((x) => x.primary)?.id ?? calendars[0]?.id ?? "");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dur = Math.max(30, Math.round((Date.parse(`${day}T${to}:00-03:00`) - Date.parse(`${day}T${from}:00-03:00`)) / 60_000));
  const save = () =>
    start(async () => {
      const r = await createEventAction(
        allDay ? { calendarId: cal, title, description: desc, startDay: day, endDay: addKey(day, 1) } : { calendarId: cal, title, description: desc, start: new Date(`${day}T${from}:00-03:00`).toISOString(), end: new Date(`${day}T${to}:00-03:00`).toISOString() },
      );
      if (r.ok) onDone(`Evento “${title.trim()}” criado na agenda Google.`);
      else setErr(r.message ?? "Não consegui criar.");
    });
  return (
    <div className="text-[14px]">
      <div className="-mt-1 mb-1 flex justify-end">
        <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-tint">
          ✕
        </button>
      </div>
      <div className="mb-3 flex gap-1">
        {(["visita", "evento"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className="min-h-8 rounded-md px-3 text-[13px] font-semibold" style={tab === t ? { background: "#d3e3fd", color: "#041e49" } : undefined}>
            {t === "visita" ? "Visita" : "Evento"}
          </button>
        ))}
      </div>
      {tab === "evento" && <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim() && save()} placeholder="Adicionar título" aria-label="Título" className="mb-3 w-full border-b-2 border-[#1a73e8] bg-transparent py-1.5 text-[20px] outline-none" />}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dia" className="h-9 rounded-lg bg-tint px-2" />
        {!allDay && (
          <>
            <input type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Início" className="h-9 rounded-lg bg-tint px-2" />
            <span>–</span>
            <input type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Fim" className="h-9 rounded-lg bg-tint px-2" />
          </>
        )}
      </div>
      {tab === "evento" ? (
        <>
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4" /> Dia inteiro
          </label>
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Adicionar descrição" aria-label="Descrição" className="mt-3 w-full rounded-lg bg-tint p-2" />
          {calendars.length > 1 && (
            <select value={cal} onChange={(e) => setCal(e.target.value)} aria-label="Agenda" className="mt-2 h-9 w-full rounded-lg bg-tint px-2">
              {calendars.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
          {err && <p className="mt-2 text-[13px] font-semibold text-bad">{err}</p>}
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={pending || !title.trim()} onClick={save} className="min-h-9 rounded-full px-6 font-semibold text-white disabled:opacity-50" style={{ background: TODAY_BLUE }}>
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-[13px] text-ink-2">A visita é criada no padrão (“Visita clt - Nome - cod … - telefone”), com a consultora convidada. Na próxima tela: cliente, telefone, imóveis e consultora (dá para colar a mensagem).</p>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => onVisit(day, from, [30, 45, 60, 90, 120].reduce((a, b) => (Math.abs(b - dur) < Math.abs(a - dur) ? b : a)))} className="min-h-9 rounded-full px-5 font-semibold text-white" style={{ background: TODAY_BLUE }}>
              Continuar para a visita
            </button>
          </div>
        </>
      )}
    </div>
  );
}
