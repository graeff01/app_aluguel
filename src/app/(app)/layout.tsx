import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isAdmin, visitScope } from "@/lib/authz";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateOnlyKey, startOfDayInTz } from "@/lib/time";
import { syncHealth } from "@/server/sync-status";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";
import { OfflineBanner } from "@/components/online-status";
import { UserMenu } from "@/components/user-menu";
import { ForcePasswordDialog } from "@/components/force-password";
import { pushConfig } from "@/lib/push";
import { cx } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  // senha provisória: nada do app é exibido até a troca
  if (actor.mustChangePassword) return <div className="min-h-dvh bg-bg"><ForcePasswordDialog name={actor.name} /></div>;
  const settings = await getSettings();
  const now = new Date();
  const global = hasGlobalView(actor);
  const [pending, health, reviewCount] = await Promise.all([
    db.visit.count({
      where: { ...visitScope(actor), excluded: false, status: "SCHEDULED", scheduledEnd: { lte: now }, scheduledStart: { gte: startOfDayInTz(dateOnlyKey(settings.resultsStartDate)) } },
    }),
    syncHealth(now),
    global
      ? db.visit.count({ where: { excluded: false, OR: [{ assignmentStatus: "NEEDS_REVIEW" }, { syncConflict: { not: "NONE" } }, { clientMatch: "SUGGESTED" }] } }).then(
          async (n) => n + (await db.sourceEvent.count({ where: { classification: "AMBIGUOUS", reviewDecision: null, googleStatus: { not: "cancelled" } } })),
        )
      : Promise.resolve(0),
  ]);

  const consultantNav: NavItem[] = [
    { href: "/hoje", label: "Hoje", icon: "today" },
    { href: "/pendencias", label: "Pendências", icon: "pending", badge: pending },
    { href: "/historico", label: "Histórico", icon: "history" },
  ];
  const managerBottom: NavItem[] = [
    { href: "/painel", label: "Painel", icon: "dashboard" },
    { href: "/hoje", label: "Visitas", icon: "today", badge: pending },
    { href: "/revisao", label: "Revisão", icon: "review", badge: reviewCount },
    { href: "/oportunidades", label: "Andamento", icon: "pipeline" },
    { href: "/mais", label: "Mais", icon: "more" },
  ];
  const groups = global
    ? [
        {
          title: "Operação",
          items: [
            { href: "/painel", label: "Painel", icon: "dashboard" },
            { href: "/hoje", label: "Hoje", icon: "today" },
            { href: "/pendencias", label: "Pendências", icon: "pending", badge: pending },
            { href: "/revisao", label: "Revisão", icon: "review", badge: reviewCount },
            { href: "/historico", label: "Histórico", icon: "history" },
            { href: "/oportunidades", label: "Andamento", icon: "pipeline" },
            { href: "/clientes", label: "Clientes", icon: "clients" },
          ] as NavItem[],
        },
        {
          title: "Equipe",
          items: [{ href: "/config/usuarios", label: "Usuários", icon: "users" }] as NavItem[],
        },
        ...(isAdmin(actor)
          ? [
              {
                title: "Administração",
                items: [
                  { href: "/admin/google", label: "Agenda Google", icon: "sync" },
                  { href: "/admin/padroes", label: "Padrões", icon: "pattern" },
                  { href: "/config/motivos", label: "Motivos", icon: "list" },
                  { href: "/admin/configuracoes", label: "Regras e app", icon: "settings" },
                  { href: "/admin/sincronizacao", label: "Diagnóstico", icon: "pulse" },
                  { href: "/config/auditoria", label: "Auditoria", icon: "audit" },
                ] as NavItem[],
              },
            ]
          : []),
      ]
    : [{ items: [...consultantNav, { href: "/visitas/nova", label: "Visita manual", icon: "plus" } as NavItem] }];

  const dot = { ok: "bg-good", stale: "bg-accent", error: "bg-bad", off: "bg-ink-3/50" }[health.level];
  // consultora só vê o status da agenda quando há problema que a afeta
  const showHealth = global || health.level === "stale" || health.level === "error";

  return (
    <div className="flex min-h-dvh">
      <SideNav groups={groups} productName={settings.productName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <header className="sticky top-0 z-10 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-8">
            <Link href="/" className="flex items-center gap-2 md:hidden">
              <span aria-hidden className="grid size-8 place-items-center rounded-xl bg-primary text-sm font-extrabold text-white">
                V
              </span>
              <span className="text-[15px] font-bold tracking-[-0.02em]">{settings.productName}</span>
            </Link>
            <p className={cx("hidden min-w-0 items-center gap-2 truncate text-[13px] text-ink-3 md:flex", health.level !== "ok" && "text-ink-2")} title={health.message}>
              {showHealth && (
                <>
                  <span aria-hidden className={cx("size-2 shrink-0 rounded-full", dot)} />
                  {health.message}
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {showHealth && (
                <>
                  <span aria-hidden className={cx("size-2 rounded-full md:hidden", dot)} title={health.message} />
                  <span className="sr-only md:hidden">{health.message}</span>
                </>
              )}
              <UserMenu name={actor.name} email={actor.email} role={actor.role} showProfile={global} pushKey={pushConfig()?.publicKey ?? null} />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-32 md:px-8 md:pt-9 md:pb-12">{children}</main>
      </div>
      <BottomNav items={global ? managerBottom : consultantNav} />
    </div>
  );
}
