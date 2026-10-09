import Link from "next/link";
import { getSettingsSafe } from "@/lib/settings-safe";
import { getSettings } from "@/lib/settings";
import { BrandLogo } from "@/components/brand";

export const metadata = { title: "Aviso de privacidade" };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const brand = await getSettingsSafe();
  let months = 24;
  let contact = "";
  try {
    const s = await getSettings();
    months = s.retentionMonths;
    contact = s.privacyContact;
  } catch {}
  const h2 = "mt-8 mb-2 text-[18px] font-bold tracking-[-0.02em]";
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed text-ink-2">
      <BrandLogo tone="auto" className="mb-8 h-9 w-auto" />
      <p className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-accent-strong uppercase">{brand.productName}</p>
      <h1 className="text-[30px] leading-tight font-bold tracking-[-0.03em] text-ink">Aviso de privacidade</h1>
      <p className="mt-3">
        Este aplicativo é uma ferramenta interna da imobiliária para registrar visitas de locação e acompanhar indicadores da equipe. Ele trata dados pessoais conforme a
        Lei Geral de Proteção de Dados (Lei 13.709/2018).
      </p>

      <h2 className={h2}>Quais dados são tratados</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong className="text-ink">Clientes que visitam imóveis:</strong> nome, telefone, imóvel visitado, data e resultado da visita e observações da consultora.
        </li>
        <li>
          <strong className="text-ink">Equipe:</strong> nome, e-mail de login e registros de uso (quem registrou ou alterou cada informação).
        </li>
        <li>Não são coletados documentos (CPF, RG), dados financeiros nem dados sensíveis. As observações não devem conter esse tipo de informação.</li>
      </ul>

      <h2 className={h2}>Para que são usados</h2>
      <p>
        Organizar o atendimento após a visita, dar retorno ao cliente e medir a qualidade do atendimento (taxas de interesse, não comparecimento e locações). Base legal:
        legítimo interesse da imobiliária e procedimentos preliminares à contratação solicitados pelo cliente.
      </p>

      <h2 className={h2}>Com quem são compartilhados</h2>
      <p>
        Não há venda nem compartilhamento com terceiros para outros fins. Os dados ficam em provedores contratados para operar o sistema: hospedagem (Railway) e a agenda
        Google da imobiliária, de onde as visitas são lidas (somente leitura).
      </p>

      <h2 className={h2}>Por quanto tempo</h2>
      <p>
        {months > 0 ? (
          <>
            Clientes sem nenhuma visita ou movimentação há <strong className="text-ink">{months} meses</strong> têm nome, telefone e observações removidos
            automaticamente (anonimização). Os números agregados dos indicadores são preservados, sem identificar a pessoa.
          </>
        ) : (
          <>Os dados são mantidos enquanto necessários ao atendimento e excluídos a pedido do titular.</>
        )}
      </p>

      <h2 className={h2}>Direitos do titular</h2>
      <p>
        Qualquer cliente pode pedir acesso, correção ou exclusão dos seus dados. A gestão atende o pedido diretamente no aplicativo (exclusão com anonimização imediata,
        registrada na auditoria).
        {contact ? (
          <>
            {" "}
            Contato para pedidos: <strong className="text-ink">{contact}</strong>.
          </>
        ) : (
          <> Pedidos devem ser encaminhados à gestão da imobiliária.</>
        )}
      </p>

      <h2 className={h2}>Segurança</h2>
      <p>
        Acesso individual com senha, permissões por papel (cada consultora vê só as próprias visitas), conexão criptografada, credenciais da agenda criptografadas e
        registro de auditoria das alterações.
      </p>

      <h2 className={h2}>Responsabilidade de quem usa</h2>
      <p>Registre apenas o necessário sobre a visita. Não anote documentos, dados de saúde, religião, política ou informações financeiras do cliente.</p>

      <p className="mt-10">
        <Link href="/" className="font-semibold text-ink underline underline-offset-4">
          Voltar ao aplicativo
        </Link>
      </p>
    </main>
  );
}
