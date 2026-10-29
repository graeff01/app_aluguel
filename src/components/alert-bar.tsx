import Link from "next/link";
import { openAlertAction } from "@/app/actions/alerts";
import { Icon } from "./icons";
import { cx } from "./ui";

/** Sino no topo com o número de avisos não lidos. */
export function AlertBell({ count }: { count: number }) {
  return (
    <Link href="/avisos" aria-label={count ? `Avisos: ${count} não lido${count > 1 ? "s" : ""}` : "Avisos"} className="press relative grid size-10 place-items-center rounded-full hover:bg-tint">
      <Icon name="bell" className={cx("size-[22px]", count ? "text-accent-strong" : "text-ink-2")} />
      {count > 0 && <span className="num absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-bad px-1 text-[11px] leading-5 font-bold text-white">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}

/** Faixa fixa enquanto houver aviso não lido: o mais recente, para não passar despercebido. */
export function AlertBanner({ count, latest }: { count: number; latest: { id: string; title: string; body: string } | null }) {
  if (!count || !latest) return null;
  return (
    <div role="alert" className="border-b border-accent/30 bg-accent-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-8">
        <Icon name="bell" className="size-5 shrink-0 text-accent-strong" />
        <p className="min-w-0 flex-1 text-[14px]">
          <strong className="text-accent-strong">{latest.title}</strong>
          <span className="block truncate text-[13px] text-ink-2 sm:inline sm:before:content-['_·_']">{latest.body}</span>
        </p>
        <div className="flex items-center gap-2">
          <form action={openAlertAction}>
            <input type="hidden" name="id" value={latest.id} />
            <button className="press inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-white">Abrir</button>
          </form>
          {count > 1 && (
            <Link href="/avisos" className="press inline-flex min-h-10 items-center rounded-full border border-accent/40 px-4 text-[13px] font-semibold text-accent-strong">
              Ver todos ({count})
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
