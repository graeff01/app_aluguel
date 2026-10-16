"use client";
import { useMemo, useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select, Textarea, cx } from "@/components/ui";
import { createStaffVisitAction } from "@/app/actions/visits";
import { classifyTitle, DEFAULT_PATTERNS, parseVisitEvent } from "@/lib/parser";
import { extractClientData } from "@/lib/extract";

type Consultant = { id: string; name: string; away: string | null; today: number };

/** Lê uma mensagem colada: título no padrão da agenda ("Visita clt - Ana 123 - cod 1;2 - 51 9…") ou a mensagem do cliente. */
function readPasted(text: string) {
  const line = text.split(/\r?\n/).find((l) => /c[oó]d|im[oó]vel/i.test(l)) ?? text;
  const c = classifyTitle(line, DEFAULT_PATTERNS);
  const p = parseVisitEvent(line, null, c.cls === "VISIT" ? c.prefix : "");
  const d = extractClientData(text);
  return {
    clientName: p.clientName ?? d.fullName,
    phoneRaw: p.phoneRaw ?? d.phone,
    externalRef: p.externalRef ?? undefined,
    codes: p.propertyCode ? [p.propertyCode, ...p.extraPropertyCodes].join(";") : undefined,
  };
}

export function StaffVisitForm({ consultants, today }: { consultants: Consultant[]; today: string }) {
  const [chosen, setChosen] = useState("");
  const [pasted, setPasted] = useState("");
  const [filled, setFilled] = useState<string[] | null>(null);
  const requestId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`), []);
  function fill() {
    const d = readPasted(pasted);
    const got: string[] = [];
    const set = (id: string, v: string | undefined, label: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && v) {
        el.value = v;
        got.push(label);
      }
    };
    set("clientName", d.clientName, "nome");
    set("externalRef", d.externalRef, "nº do atendimento");
    set("phoneRaw", d.phoneRaw, "telefone");
    set("propertyCodes", d.codes, "imóvel");
    setFilled(got);
  }
  return (
    <ActionForm action={createStaffVisitAction} className="max-w-2xl rounded-[26px] border border-line bg-surface p-5 shadow-card sm:p-7">
      {(st) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          <details className="group mb-5 rounded-2xl border border-line bg-surface-2">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[14px] font-semibold">
              Colar a mensagem ou o título e preencher sozinho
              <span aria-hidden className="text-lg text-ink-3 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="px-4 pb-4">
              <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} aria-label="Mensagem colada" placeholder={"Ex.: Visita clt - Ana Souza 2864969 - cod 339541;835840 - 51 99926-7871\nou a mensagem do cliente com nome e telefone."} className="block w-full rounded-2xl border border-line-strong bg-surface px-4 py-3 text-[15px] focus:border-ink focus:outline-none" />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" onClick={fill} disabled={!pasted.trim()} className="press min-h-10 rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary disabled:opacity-40">
                  Preencher campos
                </button>
                {filled && <span className={filled.length ? "text-[13px] font-semibold text-good" : "text-[13px] font-semibold text-warn"}>{filled.length ? `Preenchido: ${filled.join(", ")}. Confira.` : "Não encontrei os dados — preencha à mão."}</span>}
              </div>
            </div>
          </details>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Nome do cliente" htmlFor="clientName" error={st.fieldErrors?.clientName}>
              <Input id="clientName" name="clientName" autoComplete="off" required />
            </Field>
            <Field label="Nº do atendimento (CRM)" htmlFor="externalRef" hint="Opcional. Vai no título, como já é usado na agenda.">
              <Input id="externalRef" name="externalRef" inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label="Telefone" htmlFor="phoneRaw" error={st.fieldErrors?.phoneRaw}>
              <Input id="phoneRaw" name="phoneRaw" type="tel" inputMode="tel" placeholder="51 99999-9999" autoComplete="off" />
            </Field>
            <Field label="Imóvel(is)" htmlFor="propertyCodes" error={st.fieldErrors?.propertyCodes} hint="Vários: separe com ; (um cartão para cada imóvel).">
              <Input id="propertyCodes" name="propertyCodes" placeholder="339541;835840" autoComplete="off" required />
            </Field>
            <Field label="Dia" htmlFor="date">
              <Input id="date" name="date" type="date" defaultValue={today} min={today} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Horário" htmlFor="time" error={st.fieldErrors?.scheduledStart}>
                <Input id="time" name="time" type="time" required />
              </Field>
              <Field label="Duração" htmlFor="duration">
                <Select id="duration" name="duration" defaultValue="60">
                  {[30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
          <fieldset className="mb-5">
            <legend className="mb-2 text-sm font-semibold text-ink">Consultora</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {consultants.map((c) => (
                <label key={c.id} className={cx("press relative flex cursor-pointer items-center gap-3 rounded-[22px] border-2 bg-surface p-4 transition", chosen === c.id ? "border-accent" : "border-line hover:border-line-strong")}>
                  <input type="radio" name="consultantId" value={c.id} checked={chosen === c.id} onChange={() => setChosen(c.id)} className="sr-only" required />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold">{c.name}</span>
                    <span className="block text-[12px] text-ink-3">{c.today ? `${c.today} visita${c.today > 1 ? "s" : ""} hoje` : "Nenhuma visita hoje"}</span>
                    {c.away && <span className="mt-1 inline-block rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] font-bold text-warn">Ausente até {c.away}</span>}
                  </span>
                </label>
              ))}
            </div>
            <FieldError state={st} name="consultantId" />
          </fieldset>
          <Field label="Observação para a consultora (opcional)" htmlFor="note" hint="Vai na descrição do evento. Não coloque CPF ou documentos.">
            <Textarea id="note" name="note" rows={2} maxLength={500} />
          </Field>
          {st.fieldErrors?.allowOverlap && (
            <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn">
              <input type="checkbox" name="allowOverlap" value="1" className="mt-0.5 size-5" />
              <span>
                <strong>Marcar mesmo assim</strong> nesse horário (ex.: imóveis no mesmo prédio).
              </span>
            </label>
          )}
          <SubmitButton className="w-full sm:w-auto">Agendar e pôr na agenda Google</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
