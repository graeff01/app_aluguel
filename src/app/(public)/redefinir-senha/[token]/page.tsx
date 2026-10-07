import { ResetForm } from "./form";

export const metadata = { title: "Definir senha" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="mb-2 text-[28px] leading-tight font-bold tracking-[-0.03em]">Definir nova senha</h1>
      <p className="mb-6 text-ink-2">O link vale uma única vez e expira em 24 horas.</p>
      <ResetForm token={token} />
    </>
  );
}
