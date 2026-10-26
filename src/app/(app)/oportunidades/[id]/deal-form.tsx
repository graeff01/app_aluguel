"use client";
import { useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { dealStageAction } from "@/app/actions/visits";
import { DEAL_STAGES, FELL_LABEL, STAGE_HINT, STAGE_LABEL, stageIndex, type Stage } from "@/lib/deal-stages";

type Item = { id: string; label: string };
type Props = {
  opp: { id: string; version: number; stage: Stage | null; lost: boolean; intendedGuarantee: string | null; inspectionNeeded: boolean | null };
  lists: { guarantees: Item[]; agents: Item[]; highlights: Item[]; missing: Item[]; lostReasons: Item[] };
  suggested: string[];
  today: string;
  initialTo?: string;
  canManageLists: boolean;
};

const Chips = ({ name, items, defaults = [] }: { name: string; items: Item[]; defaults?: string[] }) => (
  <div className="flex flex-wrap gap-2">
    {items.map((h) => (
      <label key={h.id} className="press cursor-pointer">
        <input type="checkbox" name={name} value={h.id} defaultChecked={defaults.includes(h.id)} className="peer sr-only" />
        <span className="inline-flex min-h-10 items-center rounded-full border-2 border-line bg-surface px-3.5 text-[13px] font-semibold transition peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:ring-2 peer-focus-visible:ring-accent">{h.label}</span>
      </label>
    ))}
  </div>
);

/** Atualizar a situação: pede só o que a etapa registra. */
export function DealForm({ opp, lists, suggested, today, initialTo, canManageLists }: Props) {
  const next = opp.lost ? (opp.stage ?? "NEGOTIATION") : (DEAL_STAGES[stageIndex(opp.stage) + 1] ?? "FELL");
  const options = [...DEAL_STAGES.filter((s) => opp.lost || s !== opp.stage), ...(opp.lost ? [] : (["FELL"] as const))];
  const [to, setTo] = useState<string>(initialTo && (options as string[]).includes(initialTo) ? initialTo : next);
  const back = to !== "FELL" && (opp.lost || stageIndex(to as Stage) < stageIndex(opp.stage));
  const date = (name: string, label: string, required = true, max: string | undefined = today) => (
    <Field label={label} htmlFor={name}>
      <Input id={name} name={name} type="date" max={max} defaultValue={required ? today : undefined} required={required} />
    </Field>
  );
  const money = (name: string, label: string) => (
    <Field label={label} htmlFor={name}>
      <Input id={name} name={name} inputMode="decimal" placeholder="2.300,00" required />
    </Field>
  );
  const guarantee = (name: string, label: string, preset?: string | null) => (
    <Field label={label} htmlFor={name}>
      <Select id={name} name={name} required defaultValue={lists.guarantees.find((g) => g.label === preset)?.id ?? ""}>
        <option value="" disabled>
          Escolha
        </option>
        {lists.guarantees.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <ActionForm action={dealStageAction} className="max-w-2xl rounded-3xl border border-line bg-surface p-5 shadow-card" key={opp.version}>
      {(s) => (
        <>
          <input type="hidden" name="oppId" value={opp.id} />
          <input type="hidden" name="version" value={opp.version} />
          <Field label={opp.lost ? "Reabrir em" : "Nova situação"} htmlFor="to">
            <Select id="to" name="to" value={to} onChange={(e) => setTo(e.target.value)}>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o === "FELL" ? `${FELL_LABEL} (cliente desistiu ou o contrato caiu)` : `${stageIndex(o) + 1}. ${STAGE_LABEL[o]}`}
                </option>
              ))}
            </Select>
          </Field>
          {to !== "FELL" && <p className="-mt-2 mb-4 text-[13px] text-ink-3">{STAGE_HINT[to as Stage]}</p>}

          <div className="grid gap-x-4 sm:grid-cols-2">
            {to === "NEGOTIATION" && (
              <>
                {money("proposedRent", "Valor proposto (R$)")}
                {guarantee("intendedGuarantee", "Garantia pretendida", opp.intendedGuarantee)}
              </>
            )}
            {to === "OWNER_PENDING" && date("proposalSentAt", "Data do envio da proposta")}
            {to === "PRE_ANALYSIS" && (
              <>
                {date("ownerAcceptedAt", "Data do aceite do proprietário")}
                {money("agreedRent", "Valor final acordado (R$)")}
              </>
            )}
            {to === "KYC_SENT" && (
              <>
                {date("kycSentAt", "Link de cadastro (KYC) enviado em")}
                {date("kycDueAt", "Prazo combinado para preencher", true, undefined)}
              </>
            )}
            {to === "APPROVED" && (
              <>
                {guarantee("guarantee", "Garantia definida", opp.intendedGuarantee)}
                {date("analysisDecidedAt", "Data da aprovação")}
              </>
            )}
            {(to === "INSPECTION" || (to === "CONTRACT" && opp.inspectionNeeded === null)) && (
              <Field label="Tem vistoria?" htmlFor="inspectionNeeded">
                <Select id="inspectionNeeded" name="inspectionNeeded" required defaultValue={opp.inspectionNeeded === null ? "" : opp.inspectionNeeded ? "sim" : "nao"}>
                  <option value="" disabled>
                    Escolha
                  </option>
                  <option value="sim">Sim</option>
                  <option value="nao">Não</option>
                </Select>
              </Field>
            )}
            {to === "CONTRACT" && (
              <>
                {date("contractReleasedAt", "Contrato liberado (ADM) em")}
                {date("contractSentAt", "Contrato enviado em (se já foi)", false)}
              </>
            )}
            {to === "SIGNED" && (
              <>
                {date("signedAt", "Data real da assinatura")}
                <Field label="Tipo de negócio" htmlFor="dealType">
                  <Select id="dealType" name="dealType" required defaultValue="LEASE">
                    <option value="LEASE">Locação</option>
                    <option value="INTERMEDIATION">Só intermediação</option>
                  </Select>
                </Field>
                {money("contractValue", "Valor do contrato (R$) · entra no VGL")}
              </>
            )}
            {to === "POSSESSION" && date("possessionAt", "Data da posse")}
          </div>

          {to === "KYC_SENT" && lists.missing.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-semibold">Documentação que falta (opcional)</p>
              <Chips name="docsMissingIds" items={lists.missing} />
              <p className="mt-2 text-[12px] text-ink-3">Parado aqui há muitos dias, o app avisa você e a gestora.</p>
            </div>
          )}
          {to === "SIGNED" && (
            <fieldset className="mb-5 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
              <legend className="px-1 text-[15px] font-bold">Para o marketing postar</legend>
              {lists.agents.length === 0 ? (
                <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
                  Nenhum agenciador cadastrado. {canManageLists ? <a href="/config/motivos#agenciadores" className="underline underline-offset-4">Cadastre em Listas e motivos</a> : "Peça à gestão para cadastrar."}
                </p>
              ) : (
                <Field label="Agenciador" htmlFor="agentId">
                  <Select id="agentId" name="agentId" required defaultValue="">
                    <option value="" disabled>
                      Escolha o agenciador
                    </option>
                    {lists.agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                  <FieldError state={s} name="agentId" />
                </Field>
              )}
              {lists.highlights.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-sm font-semibold">Diferenciais desta locação</p>
                  <Chips name="highlightIds" items={lists.highlights} defaults={suggested} />
                </div>
              )}
              <Field label="Conte o diferencial (obrigatório)" htmlFor="highlightNote">
                <Textarea id="highlightNote" name="highlightNote" maxLength={600} required minLength={5} />
                <FieldError state={s} name="highlightNote" />
              </Field>
            </fieldset>
          )}
          {to === "POSSESSION" && (
            <label className={cx("mb-4 flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 text-[14px]", "border-warn/40 bg-warn-soft")}>
              <input type="checkbox" name="keysHolderChecked" value="1" required className="mt-0.5 size-5" />
              <span>
                <strong>Antifraude:</strong> as chaves foram retiradas pelo próprio titular e o documento com foto foi impresso no verso do protocolo.
              </span>
            </label>
          )}
          {to === "FELL" && (
            <Field label="Motivo" htmlFor="lostReasonId" hint={`Etapa em que caiu: ${opp.stage ? STAGE_LABEL[opp.stage] : "em acompanhamento"} (registrada sozinha).`}>
              <Select id="lostReasonId" name="lostReasonId" required defaultValue="">
                <option value="" disabled>
                  Escolha o motivo
                </option>
                {lists.lostReasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <FieldError state={s} name="lostReasonId" />
            </Field>
          )}
          <Field label={to === "FELL" || back ? "Observação (obrigatória)" : "Observação (opcional)"} htmlFor="deal-note">
            <Textarea id="deal-note" name="note" maxLength={2000} required={to === "FELL" || back} placeholder={back ? "Por que voltar a situação?" : undefined} />
            <FieldError state={s} name="note" />
          </Field>
          <SubmitButton variant={to === "FELL" ? "danger" : "primary"}>{to === "FELL" ? "Registrar que caiu" : `Salvar: ${STAGE_LABEL[to as Stage]}`}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
