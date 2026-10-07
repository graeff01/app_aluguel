"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; badge?: number };

function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + "/");
}

/** Barra inferior flutuante (celular). */
export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  // telas de tarefa (registro/correção/cadastro) usam a barra de ação própria
  if (/^\/visitas\/(nova|[^/]+\/(registrar|corrigir))/.test(path)) return null;
  return (
    <nav aria-label="Principal" className="pb-safe fixed inset-x-0 bottom-0 z-20 px-3 md:hidden">
      <ul
        className="mx-auto mb-1 grid max-w-md rounded-[26px] border border-white/60 bg-white/85 p-1.5 shadow-float backdrop-blur-xl"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((it) => {
          const active = isActive(path, it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-[20px] text-[11px] font-semibold transition-colors",
                  active ? "bg-primary text-white" : "text-ink-3 hover:text-ink",
                )}
              >
                <Icon name={it.icon} className="size-[22px]" />
                {it.label}
                {!!it.badge && (
                  <span className="absolute top-1.5 right-[calc(50%-1.55rem)] min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] leading-[18px] font-bold text-white ring-2 ring-white">
                    {it.badge > 99 ? "99+" : it.badge}
                    <span className="sr-only"> pendentes</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Menu lateral grafite (desktop). */
export function SideNav({ groups, productName }: { groups: { title?: string; items: NavItem[] }[]; productName: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto bg-[#1f2124] px-4 py-6 text-white md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-3">
        <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-accent text-sm font-extrabold">
          V
        </span>
        <span className="text-[15px] font-bold tracking-[-0.02em]">{productName}</span>
      </Link>
      {groups.map((g, i) => (
        <div key={i} className="mb-6">
          {g.title && <p className="mb-2 px-3 text-[11px] font-semibold tracking-[0.14em] text-white/40 uppercase">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isActive(path, it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
                      active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04] hover:text-white",
                    )}
                  >
                    {active && <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent" />}
                    <Icon name={it.icon} className="size-[18px]" />
                    <span className="flex-1">{it.label}</span>
                    {!!it.badge && <span className="rounded-full bg-accent px-2 text-[11px] leading-5 font-bold text-white">{it.badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
