"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { opportunityAction, transferOpportunityAction } from "@/app/actions/visits";
import { OPP_STATUS_LABEL } from "@/lib/labels";

type Opp = { id: string; version: number; status: string; responsibleId: string | null };

type Item = { id: string; label: string };

export function OppForm({ opp, lostReasons, users, today, initialTo, agents = [], highlights = [], suggested = [], canManageLists = false }: { opp: Opp; lostReasons: Item[]; users: { id: string; name: string }[]; today: string; initialTo?: string; agents?: Item[]; highlights?: Item[]; suggested?: string[]; canManageLists?: boolean }) {
  const options = ["FOLLOW_UP", "DOCS_REVIEW", "CLOSED_WON", "LOST"].filter((s) => s !== opp.status);
  const [to, setTo] = useState(initialTo && options.includes(initialTo) ? initialTo : options[0]);
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
              <fieldset className="mb-5 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
                <legend className="px-1 text-[15px] font-bold">Para o marketing postar</legend>
                <p className="mb-3 text-[13px] text-ink-2">O marketing recebe um aviso assim que você salvar.</p>
                {agents.length === 0 ? (
                  <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
                    Nenhum agenciador cadastrado.{" "}
                    {canManageLists ? (
                      <a href="/config/motivos" className="underline underline-offset-4">
                        Cadastre em Listas e motivos
                      </a>
                    ) : (
                      "Peça à gestão para cadastrar em Listas e motivos."
                    )}
                  </p>
                ) : (
                  <Field label="Agenciador" htmlFor="agentId">
                    <Select id="agentId" name="agentId" required defaultValue="">
                      <option value="" disabled>
                        Escolha o agenciador
                      </option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </Select>
                    <FieldError state={s} name="agentId" />
                  </Field>
                )}
                {highlights.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-sm font-semibold">Diferenciais desta locação</p>
                    <div className="flex flex-wrap gap-2">
                      {highlights.map((h) => (
                        <label key={h.id} className="press cursor-pointer">
                          <input type="checkbox" name="highlightIds" value={h.id} defaultChecked={suggested.includes(h.id)} className="peer sr-only" />
                          <span className="inline-flex min-h-10 items-center rounded-full border-2 border-line bg-surface px-3.5 text-[13px] font-semibold transition peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                            {h.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <Field label="Conte o diferencial (obrigatório)" htmlFor="highlightNote" hint="Ex.: cliente fechou no mesmo dia da visita; imóvel estava há 4 meses sem visitas.">
                  <Textarea id="highlightNote" name="highlightNote" maxLength={600} required minLength={5} />
                  <FieldError state={s} name="highlightNote" />
                </Field>
              </fieldset>
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
