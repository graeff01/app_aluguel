import { Badge } from "./ui";
import { EVALUATION_LABEL, STATUS_LABEL } from "@/lib/labels";
import { situationLabel } from "@/lib/deal-stages";

type V = { status: string; evaluation: string | null; scheduledEnd: Date; syncConflict?: string; excluded?: boolean; autoCanceled?: boolean; opportunity?: { status: string; stage?: string | null } | null };

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
  // o negócio da visita já andou: mostra a situação dele (não "ainda decidindo")
  const o = v.opportunity;
  if (v.status === "DONE" && v.evaluation !== "NEGATIVE" && o && (o.status === "LOST" || o.status === "CLOSED_WON" || o.stage))
    return (
      <Badge tone={o.status === "LOST" ? "bad" : o.status === "CLOSED_WON" ? "good" : "info"} dot>
        {o.status === "CLOSED_WON" ? "Alugou" : situationLabel({ stage: o.stage ?? null, status: o.status })}
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
