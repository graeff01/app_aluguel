import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { SetupForm } from "./form";

export const metadata = { title: "Configuração inicial" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await db.user.count()) > 0) redirect("/login");
  return (
    <>
      <h1 className="mb-2 text-[28px] leading-tight font-bold tracking-[-0.03em]">Configuração inicial</h1>
      <p className="mb-6 text-ink-2">
        Crie o primeiro administrador. É necessário o código definido na variável SETUP_TOKEN do servidor. Esta tela some após o primeiro cadastro.
      </p>
      <SetupForm />
    </>
  );
}
