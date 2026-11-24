import { Badge } from "./ui";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";

type V = { status: string; evaluation: string | null; scheduledEnd: Date; syncConflict?: string; excluded?: boolean; autoCanceled?: boolean; opportunity?: { status: string } | null };

export function VisitStatusBadge({ v, now = new Date() }: { v: V; now?: Date }) {
  if (v.excluded) return <Badge>Fora dos indicadores</Badge>;
  if (v.status === "SCHEDULED") {
    return v.scheduledEnd <= now ? (
      <Badge tone="accent" dot>
        Aguardando resultado
      </Badge>
    ) : (
      <Badge tone="info">Agendada</Badge>
    );
  }
  // o negócio da visita já terminou: mostra como terminou (não "ainda decidindo")
  if (v.status === "DONE" && v.evaluation !== "NEGATIVE" && v.opportunity?.status === "LOST")
    return (
      <Badge tone="bad" dot>
        Caiu
      </Badge>
    );
  if (v.status === "DONE" && v.opportunity?.status === "CLOSED_WON")
    return (
      <Badge tone="good" dot>
        Alugou
      </Badge>
    );
  if (v.status === "DONE" && v.evaluation) {
    const tone = v.evaluation === "POSITIVE" ? "good" : v.evaluation === "NEGATIVE" ? "bad" : "neutral";
    return (
      <Badge tone={tone} dot>
        {EVALUATION_LABEL[v.evaluation]}
      </Badge>
    );
  }
  return (
    <Badge>
      {STATUS_LABEL[v.status]}
      {v.autoCanceled ? " · agenda" : ""}
    </Badge>
  );
}
