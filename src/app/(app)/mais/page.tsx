import Link from "next/link";
import { requireActor } from "@/lib/require";
import { hasGlobalView, isAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Mais" };

export default async function MorePage() {
  const a = await requireActor();
  const items: [string, string, string][] = [
    ["/pendencias", "Pendências", "Resultados e dados a completar"],
    ["/historico", "Histórico", "Busca por nome, telefone e código"],
    ["/visitas/nova", "Visita manual", "Cadastro de contingência"],
    ...(hasGlobalView(a)
      ? ([
          ["/relatorios", "Relatórios", "Relatório mensal em PDF para a direção"],
          ["/imoveis", "Imóveis", "Desempenho e motivos por imóvel"],
          ["/clientes", "Clientes", "Cadastros e identificação"],
          ["/config/usuarios", "Usuários", "Acessos e e-mails da agenda"],
        ] as [string, string, string][])
      : []),
    ...(isAdmin(a)
      ? ([
          ["/admin/google", "Agenda Google", "Conexão e calendário"],
          ["/admin/padroes", "Padrões de eventos", "Como reconhecer visitas"],
          ["/config/motivos", "Motivos", "Motivos de negativa e perda"],
          ["/config/auditoria", "Auditoria", "Quem alterou o quê"],
          ["/admin/configuracoes", "Regras e aplicativo", "Permissões, prazos e aparência"],
          ["/admin/sincronizacao", "Diagnóstico", "Últimas sincronizações"],
        ] as [string, string, string][])
      : []),
    ["/perfil", "Perfil", "Senha, instalação e sair"],
  ];
  return (
    <>
      <PageHeader title="Mais" />
      <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
        {items.map(([href, label, hint]) => (
          <li key={href}>
            <Link href={href} className="flex min-h-14 items-center justify-between px-4 py-3 hover:bg-bg">
              <span>
                <span className="block font-medium">{label}</span>
                <span className="text-sm text-ink-3">{hint}</span>
              </span>
              <span aria-hidden className="text-ink-3">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
