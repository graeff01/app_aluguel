import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">Registro não encontrado</h1>
      <p className="mt-1 text-ink-2">Ele não existe ou você não tem permissão para acessá-lo.</p>
      <LinkButton href="/" className="mt-4">
        Voltar ao início
      </LinkButton>
    </div>
  );
}
