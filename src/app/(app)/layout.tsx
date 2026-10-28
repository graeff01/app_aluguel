import Link from "next/link";
import { countDueRadar } from "@/server/radar";
import { requireActor } from "@/lib/require";
import { isMobileRequest } from "@/lib/session";
import { hasGlobalView, isAdmin, visitScope } from "@/lib/authz";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateOnlyKey, startOfDayInTz } from "@/lib/time";
import { syncHealth } from "@/server/sync-status";
import { googleExpiry } from "@/server/google-expiry";
import { WhatsNew } from "@/components/whats-new";
import { HelpButton } from "@/components/help-button";
import { unseenChanges } from "@/lib/changelog";
import { BottomNav, SideNav, type NavItem } from "@/components/nav";
import { OfflineBanner } from "@/components/online-status";
import { UserMenu } from "@/components/user-menu";
import { ForcePasswordDialog } from "@/components/force-password";
import { PrivacyDialog } from "@/components/privacy-dialog";
import { pushConfig } from "@/lib/push";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { BrandSymbol } from "@/components/brand";
import { UndoToast } from "@/components/undo-toast";
import { Suspense } from "react";
import { cx } from "@/components/ui";
import { AppBadge } from "@/components/app-badge";
import { countOpenFor } from "@/server/pre-analysis";
import { countNewProposalsFor } from "@/server/proposals";
import { Onboarding } from "@/components/onboarding";
import { UpdateBanner } from "@/components/update-banner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor({ preService: true, marketing: true });
  // senha provisória: nada do app é exibido até a troca
  if (actor.mustChangePassword) return <div className="min-h-dvh bg-bg"><ForcePasswordDialog name={actor.name} /></div>;
  // LGPD: ciência do aviso de privacidade no primeiro acesso
  if (!actor.privacyAcceptedAt) return <div className="min-h-dvh"><PrivacyDialog name={actor.name} /></div>;
  // primeiro acesso guiado (instalar, notificações, como usar)
  if (!actor.onboardedAt) return <Onboarding name={actor.name} role={actor.role} pushKey={pushConfig()?.publicKey ?? null} />;
  const now = new Date();
  const global = hasGlobalView(actor);
  const preService = actor.role === "PRE_SERVICE";
  const marketing = actor.role === "MARKETING";
  // leituras do menu em paralelo (aparecem em todas as telas)
  const [settings, preOpen, propNew, toPost, agents, radarDue] = await Promise.all([
    getSettings(),
    countOpenFor(actor),
    marketing ? Promise.resolve(0) : countNewProposalsFor(actor),
    marketing || global ? db.leasePost.count({ where: { postedAt: null } }) : Promise.resolve(0),
    global ? db.reason.count({ where: { kind: "LEASE_AGENT", active: true } }) : Promise.resolve(1),
    countDueRadar(actor, now),
  ]);
  const [pending, health, reviewCount] = await Promise.all([
    db.visit.count({
      // "para registrar": já terminou ou já começou (em andamento)
      where: { ...visitScope(actor), excluded: false, status: "SCHEDULED", scheduledStart: { gte: startOfDayInTz(dateOnlyKey(settings.resultsStartDate)), lte: now } },
    }),
    syncHealth(now),
    global
      ? db.visit.count({ where: { excluded: false, OR: [{ assignmentStatus: "NEEDS_REVIEW" }, { syncConflict: { not: "NONE" } }, { clientMatch: "SUGGESTED" }] } }).then(
          async (n) => n + (await db.sourceEvent.count({ where: { classification: "AMBIGUOUS", reviewDecision: null, googleStatus: { not: "cancelled" } } })),
        )
      : Promise.resolve(0),
  ]);

  const consultantNav: NavItem[] = [
    { href: "/minhas", label: "Visitas", icon: "today", badge: pending },
    { href: "/rota", label: "Rota", icon: "route" },
    { href: "/pendencias", label: "Pendências", icon: "pending" },
    { href: "/historico", label: "Histórico", icon: "history" },
  ];
  const managerBottom: NavItem[] = [
    { href: "/painel", label: "Painel", icon: "dashboard" },
    { href: "/ao-vivo", label: "Ao vivo", icon: "live", badge: pending },
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
            { href: "/ao-vivo", label: "Ao vivo", icon: "live" },
            { href: "/rota", label: "Rotas", icon: "route" },
            { href: "/relatorios", label: "Relatórios", icon: "audit" },
            { href: "/pre-analises", label: "Pré-análises", icon: "clients", badge: preOpen },
            { href: "/propostas", label: "Propostas", icon: "pipeline", badge: propNew },
            { href: "/radar", label: "Radar de clientes", icon: "pulse", badge: radarDue },
            { href: "/demanda", label: "Mapa da demanda", icon: "dashboard" },
            { href: "/hoje", label: "Hoje", icon: "today" },
            { href: "/pendencias", label: "Pendências", icon: "pending", badge: pending },
            { href: "/revisao", label: "Revisão", icon: "review", badge: reviewCount },
            { href: "/historico", label: "Histórico", icon: "history" },
            { href: "/oportunidades", label: "Andamento", icon: "pipeline" },
            { href: "/em-busca", label: "Clientes em busca", icon: "clients" },
            { href: "/imoveis", label: "Imóveis", icon: "home" },
            { href: "/clientes", label: "Clientes", icon: "clients" },
          ] as NavItem[],
        },
        {
          title: "Equipe",
          items: [
            { href: "/config/usuarios", label: "Usuários", icon: "users" },
            { href: "/pre-analises/painel", label: "Pré-atendimento", icon: "audit" },
            { href: "/marketing", label: "Marketing", icon: "home", badge: toPost },
            { href: "/config/motivos", label: "Listas e motivos", icon: "list" },
          ] as NavItem[],
        },
        ...(isAdmin(actor)
          ? [
              {
                title: "Administração",
                items: [
                  { href: "/admin/google", label: "Agenda Google", icon: "sync" },
                  { href: "/admin/padroes", label: "Padrões", icon: "pattern" },
                  { href: "/admin/configuracoes", label: "Regras e app", icon: "settings" },
                  { href: "/admin/sincronizacao", label: "Diagnóstico", icon: "pulse" },
                  { href: "/config/auditoria", label: "Auditoria", icon: "audit" },
                ] as NavItem[],
              },
            ]
          : []),
      ]
    : [
        {
          title: "Meu dia",
          items: [
            { href: "/minhas", label: "Minhas visitas", icon: "today", badge: pending },
            { href: "/rota", label: "Rota do dia", icon: "route" },
            { href: "/em-busca", label: "Clientes em busca", icon: "clients" },
          ] as NavItem[],
        },
        {
          title: "Registros",
          items: [
            { href: "/pre-analises", label: "Pré-análises", icon: "clients", badge: preOpen },
            { href: "/propostas", label: "Propostas", icon: "pipeline", badge: propNew },
            { href: "/pendencias", label: "Pendências", icon: "pending" },
            { href: "/historico", label: "Histórico", icon: "history" },
            { href: "/visitas/nova", label: "Visita manual", icon: "plus" },
          ] as NavItem[],
        },
      ];

  // pré-atendimento: só as telas de pré-análise
  const preNav: NavItem[] = [
    { href: "/pre-analises", label: "Pré-análises", icon: "clients", badge: preOpen },
    { href: "/pre-analises/nova", label: "Nova", icon: "plus" },
    { href: "/propostas", label: "Propostas", icon: "pipeline", badge: propNew },
    { href: "/radar", label: "Radar", icon: "pulse", badge: radarDue },
    { href: "/demanda", label: "Demanda", icon: "dashboard" },
    { href: "/agenda-google", label: "Agenda Google", icon: "today" },
    { href: "/agenda-do-dia", label: "Visitas", icon: "today" },
    { href: "/agenda-do-dia/nova", label: "Agendar", icon: "plus" },
  ];
  // marketing: só as locações para postar
  const marketingNav: NavItem[] = [{ href: "/marketing", label: "Para postar", icon: "home", badge: toPost }];
  const navGroups = preService ? [{ title: "Pré-atendimento", items: preNav }] : marketing ? [{ title: "Marketing", items: marketingNav }] : groups;
  const dot = { ok: "bg-good", stale: "bg-accent", error: "bg-bad", off: "bg-ink-3/50" }[health.level];
  // agenda parada (desconectada ou sem sucesso há mais de 1 h): faixa vermelha para a gestão
  const agendaDown = global && (health.level === "error" || (health.level === "stale" && !!health.lastSuccessAt && now.getTime() - health.lastSuccessAt.getTime() > 3600_000));
  const agendaBanner = agendaDown ? (
    <div role="alert" className="border-b border-bad/20 bg-bad-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-8">
        <p className="text-[14px] font-semibold text-bad">
          Agenda Google parada: {health.message.replace(/ — avise a administração$/, "")}. Visitas novas não estão chegando.
        </p>
        {isAdmin(actor) ? (
          <Link href="/admin/google" className="press inline-flex min-h-10 items-center rounded-full bg-bad px-4 text-[13px] font-semibold text-white">
            Reconectar
          </Link>
        ) : (
          <span className="text-[13px] text-bad/80">A administração foi avisada.</span>
        )}
      </div>
    </div>
  ) : null;
  // sem agenciador cadastrado ninguém consegue marcar locação fechada: avisa a gestão em todas as telas
  const agentsBanner =
    global && agents === 0 ? (
      <div role="alert" className="border-b border-warn/20 bg-warn-soft">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-8">
          <p className="text-[14px] font-semibold text-warn">Nenhum agenciador cadastrado: enquanto isso, não dá para marcar locação como fechada.</p>
          <Link href="/config/motivos#agenciadores" className="press inline-flex min-h-10 items-center rounded-full bg-warn px-4 text-[13px] font-semibold text-bg">
            Cadastrar agenciadores
          </Link>
        </div>
      </div>
    ) : null;
  // app do Google em modo teste: avisa o admin antes de a conexão expirar (reconectar ganha mais 7 dias)
  const expiry = isAdmin(actor) ? await googleExpiry(now) : null;
  const expiryBanner =
    expiry && expiry.level !== "ok" && !agendaDown ? (
      <div role="alert" className={cx("border-b", expiry.level === "soon" ? "border-warn/20 bg-warn-soft" : "border-bad/20 bg-bad-soft")}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-8">
          <p className={cx("text-[14px] font-semibold", expiry.level === "soon" ? "text-warn" : "text-bad")}>
            {expiry.level === "expired"
              ? "A conexão com a agenda Google venceu (modo teste do Google). Reconecte para a agenda voltar."
              : `A conexão com a agenda Google vence ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(expiry.expiresAt)} (em ${Math.max(1, Math.round(expiry.hoursLeft))} h). Reconecte para ganhar mais 7 dias.`}
          </p>
          <Link href="/admin/google" className={cx("press inline-flex min-h-10 items-center rounded-full px-4 text-[13px] font-semibold", expiry.level === "soon" ? "bg-warn text-bg" : "bg-bad text-white")}>
            Reconectar agora
          </Link>
        </div>
      </div>
    ) : null;
  // "O que mudou" desde o último acesso (uma vez por novidade)
  const news = unseenChanges(actor.role, actor.seenChangelog);
  const newsDialog = news.length ? <WhatsNew entries={news} /> : null;
  // consultora só vê o status da agenda quando há problema que a afeta
  const showHealth = global || health.level === "stale" || health.level === "error";

  // Celular: consultora (e gestão que escolheu) usa a tela única, sem menus.
  // Computador: todos usam o sistema web com menu lateral (itens conforme o perfil).
  const simple = (await isMobileRequest()) && (actor.role === "CONSULTANT" || (global && actor.simpleMobile));
  if (simple) {
    return (
      <div className="flex min-h-dvh flex-col">
        <OfflineBanner />
        <RefreshOnFocus />
        <UpdateBanner />
        <AppBadge count={actor.role === "CONSULTANT" ? pending + preOpen + propNew : marketing ? toPost : pending} />
        <header className="sticky top-0 z-10 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-2.5">
            <Link href="/minhas" className="flex items-center gap-2">
              <BrandSymbol className="size-8" />
              <span className="text-[15px] font-bold tracking-[-0.02em]">{settings.productName}</span>
            </Link>
            <div className="flex items-center gap-2">
              {showHealth && (
                <span className="flex items-center gap-1.5 text-[12px] text-ink-2" title={health.message}>
                  <span aria-hidden className={cx("size-2 rounded-full", dot)} />
                  <span className="sr-only">{health.message}</span>
                </span>
              )}
              <UserMenu name={actor.name} email={actor.email} role={actor.role} showProfile={global} simpleMobile={actor.simpleMobile} pushKey={pushConfig()?.publicKey ?? null} />
            </div>
          </div>
        </header>
        {agendaBanner}
        {expiryBanner}
        {agentsBanner}
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-6 pb-16">{children}</main>
        <Suspense>
          <UndoToast />
        </Suspense>
        <HelpButton role={actor.role} low />
        {newsDialog}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <SideNav groups={navGroups} productName={settings.productName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <RefreshOnFocus />
        <UpdateBanner />
        <AppBadge count={actor.role === "CONSULTANT" ? pending + preOpen + propNew : marketing ? toPost : pending} />
        <header className="sticky top-0 z-10 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 md:px-8">
            <Link href="/" className="flex items-center gap-2 md:hidden">
              <BrandSymbol className="size-8" />
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
              <UserMenu name={actor.name} email={actor.email} role={actor.role} showProfile={global} simpleMobile={actor.simpleMobile} pushKey={pushConfig()?.publicKey ?? null} />
            </div>
          </div>
        </header>
        {agendaBanner}
        {expiryBanner}
        {agentsBanner}
        {/* páginas de tela cheia (Agenda Google) usam toda a largura */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-32 has-[[data-full-bleed]]:max-w-none has-[[data-full-bleed]]:px-0 has-[[data-full-bleed]]:pt-0 has-[[data-full-bleed]]:pb-20 md:px-8 md:pt-9 md:pb-12 md:has-[[data-full-bleed]]:px-0 md:has-[[data-full-bleed]]:pt-0 md:has-[[data-full-bleed]]:pb-0">{children}</main>
      </div>
      <BottomNav items={preService ? preNav.filter((i) => i.href !== "/demanda") : marketing ? marketingNav : global ? managerBottom : consultantNav} />
      <Suspense>
        <UndoToast />
      </Suspense>
      <HelpButton role={actor.role} />
      {newsDialog}
    </div>
  );
}
