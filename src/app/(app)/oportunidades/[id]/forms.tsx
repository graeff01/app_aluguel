"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { opportunityAction, transferOpportunityAction } from "@/app/actions/visits";
import { OPP_STATUS_LABEL } from "@/lib/labels";

type Opp = { id: string; version: number; status: string; responsibleId: string | null };

export function OppForm({ opp, lostReasons, users, today }: { opp: Opp; lostReasons: { id: string; label: string }[]; users: { id: string; name: string }[]; today: string }) {
  const options = ["FOLLOW_UP", "DOCS_REVIEW", "CLOSED_WON", "LOST"].filter((s) => s !== opp.status);
  const [to, setTo] = useState(options[0]);
  const closed = opp.status === "CLOSED_WON" || opp.status === "LOST";
  return (
    <ActionForm action={opportunityAction} className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card" key={opp.version}>
      {(s) => (
        <>
          <input type="hidden" name="oppId" value={opp.id} />
          <input type="hidden" name="version" value={opp.version} />
          <Field label={closed ? "Reabrir ou alterar para" : "Nova situação"} htmlFor="toStatus">
            <Select id="toStatus" name="toStatus" value={to} onChange={(e) => setTo(e.target.value)}>
              {options.map((o) => (
                <option key={o} value={o}>
                  {OPP_STATUS_LABEL[o]}
                </option>
              ))}
            </Select>
          </Field>
          {to === "CLOSED_WON" && (
            <>
              <Field label="Data do fechamento" htmlFor="closedAt">
                <Input id="closedAt" name="closedAt" type="date" max={today} defaultValue={today} required />
                <FieldError state={s} name="closedAt" />
              </Field>
              {users.length > 0 && (
                <Field label="Responsável pelo fechamento" htmlFor="closedResponsibleId">
                  <Select id="closedResponsibleId" name="closedResponsibleId" defaultValue={opp.responsibleId ?? ""}>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          )}
          {to === "LOST" && (
            <Field label="Motivo da perda" htmlFor="lostReasonId">
              <Select id="lostReasonId" name="lostReasonId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {lostReasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <FieldError state={s} name="lostReasonId" />
            </Field>
          )}
          <Field label={to === "LOST" || closed ? "Observação (obrigatória)" : "Observação (opcional)"} htmlFor="opp-note">
            <Textarea id="opp-note" name="note" maxLength={2000} required={to === "LOST" || closed} />
            <FieldError state={s} name="note" />
          </Field>
          <SubmitButton>Salvar andamento</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function TransferForm({ oppId, users, current }: { oppId: string; users: { id: string; name: string }[]; current: string | null }) {
  return (
    <ActionForm action={transferOpportunityAction} className="max-w-xl rounded-3xl border border-line bg-surface p-5 shadow-card">
      <input type="hidden" name="oppId" value={oppId} />
      <Field label="Nova responsável" htmlFor="responsibleId" hint="O histórico e fechamentos anteriores são preservados.">
        <Select id="responsibleId" name="responsibleId" defaultValue={current ?? ""} required>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Observação" htmlFor="tr-note">
        <Input id="tr-note" name="note" maxLength={300} />
      </Field>
      <SubmitButton variant="secondary">Transferir</SubmitButton>
    </ActionForm>
  );
}
