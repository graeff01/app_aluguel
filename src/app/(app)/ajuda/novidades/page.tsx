import Link from "next/link";
import { requireActor } from "@/lib/require";
import { CHANGELOG, changeDate, entryFor } from "@/lib/changelog";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "O que mudou" };

/** Todas as novidades do app que valem para o perfil, da mais nova para a mais antiga. */
export default async function ChangelogPage() {
  const actor = await requireActor({ preService: true, marketing: true });
  const entries = CHANGELOG.map((e) => entryFor(actor.role, e)).filter((e) => !!e);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/ajuda" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
        ← Central de ajuda
      </Link>
      <PageHeader title="O que mudou" subtitle="As novidades de cada atualização do app." />
      <ol className="relative space-y-6 border-l-2 border-line pl-6">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span aria-hidden className="absolute top-1.5 -left-[31px] size-3 rounded-full bg-accent ring-4 ring-bg" />
            <p className="text-[13px] font-semibold text-ink-3">{changeDate(e.id)}</p>
            <h2 className="text-[18px] font-bold tracking-[-0.01em]">{e.title}</h2>
            <ul className="mt-2 space-y-2">
              {e.changes.map((c, i) => (
                <li key={i} className="rounded-2xl border border-line bg-surface p-4 text-[15px] leading-snug shadow-card">
                  {c.text}
                  {c.href && (
                    <>
                      {" "}
                      <Link href={c.href} className="font-semibold text-accent-strong underline-offset-4 hover:underline">
                        Ver →
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
