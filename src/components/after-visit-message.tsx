import { db } from "@/lib/db";
import { canViewVisit, type AuthzActor } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { afterVisitLink } from "@/lib/after-visit";
import { cx } from "./ui";

/** Botão do WhatsApp com a mensagem pronta do resultado (pedir documentos, retorno, outras opções, remarcar). */
export async function AfterVisitMessage({ actor, visitId, className, compact }: { actor: AuthzActor; visitId: string; className?: string; compact?: boolean }) {
  const v = await db.visit.findUnique({
    where: { id: visitId },
    select: { status: true, evaluation: true, phoneNormalized: true, clientName: true, propertyCode: true, scheduledStart: true, consultantId: true, consultant: { select: { name: true } }, property: { select: { neighborhood: true } } },
  });
  if (!v || !canViewVisit(actor, v)) return null;
  const link = afterVisitLink(await getSettings(), v);
  if (!link) return null;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("press inline-flex min-h-10 items-center gap-2 rounded-full bg-[#1f9e4f] px-4 text-[13px] font-semibold text-white", className)}
      title={compact ? link.text : undefined}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
      </svg>
      {link.label} no WhatsApp
    </a>
  );
}
