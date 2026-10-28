import Link from "next/link";
import { cx } from "@/components/ui";

/** Abas da demonstração + aviso do que é a tela. */
export function DemoNav({ active, open }: { active: "mapa" | "pedidos"; open: number }) {
  const tab = (href: string, label: React.ReactNode, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={cx("press inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold", on ? "bg-ink text-surface" : "text-ink-2 hover:bg-tint")}>
      {label}
    </Link>
  );
  return (
    <div className="mb-6">
      <div className="mb-4 rounded-3xl border border-accent/30 bg-accent-soft/50 p-4 text-[14px] leading-relaxed">
        <p className="font-bold">Perfil Captação · como vai funcionar no app Visitas Locação</p>
        <p className="mt-1 text-ink-2">
          Quando o cliente procura um imóvel que não temos, o pré-atendimento registra o pedido e ele chega aqui. A captação vê <strong>o que os clientes procuram</strong> e <strong>onde falta imóvel no site</strong>, e indica o imóvel que achar. Os pedidos desta tela são inventados; os números “no site hoje” são reais, do site da Auxiliadora. Navegue à vontade: nada aqui é gravado, e no fim da página dá para deixar sugestões.
        </p>
      </div>
      <nav aria-label="Telas da captação" className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1 shadow-card">
        {tab("/demo/captacao", "Mapa da demanda", active === "mapa")}
        {tab(
          "/demo/captacao/pedidos",
          <>
            Pedidos <span className={cx("rounded-full px-1.5 text-[11px] font-bold", active === "pedidos" ? "bg-accent text-white" : "bg-accent text-white")}>{open}</span>
          </>,
          active === "pedidos",
        )}
      </nav>
    </div>
  );
}
