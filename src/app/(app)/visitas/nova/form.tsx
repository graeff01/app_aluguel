"use client";
import { useEffect, useMemo, useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { createVisitAction } from "@/app/actions/visits";

export function NewVisitForm({ consultants, defaultStart }: { consultants: { id: string; name: string }[]; defaultStart: string }) {
  const requestId = useMemo(() => crypto.randomUUID(), []);
  const [code, setCode] = useState("");
  return (
    <ActionForm action={createVisitAction} className="max-w-xl">
      {(s) => (
        <>
          <input type="hidden" name="requestId" value={requestId} />
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Data e hora" htmlFor="scheduledStart">
              <Input id="scheduledStart" name="scheduledStart" type="datetime-local" defaultValue={defaultStart} required />
              <FieldError state={s} name="scheduledStart" />
            </Field>
            <Field label="Duração" htmlFor="duration">
              <Select id="duration" name="duration" defaultValue="60">
                <option value="30">30 min</option>
                <option value="60">1 h</option>
                <option value="90">1 h 30</option>
                <option value="120">2 h</option>
              </Select>
            </Field>
          </div>
          <Field label="Nome do cliente" htmlFor="clientName">
            <Input id="clientName" name="clientName" required maxLength={200} autoComplete="off" />
            <FieldError state={s} name="clientName" />
          </Field>
          <Field label="Telefone (com DDD)" htmlFor="phoneRaw" hint="Opcional. Sem telefone, o cadastro fica com identificação pendente.">
            <Input id="phoneRaw" name="phoneRaw" type="tel" inputMode="tel" maxLength={40} />
          </Field>
          <Field label="Código do imóvel" htmlFor="propertyCode">
            <Input id="propertyCode" name="propertyCode" required maxLength={40} inputMode="numeric" onChange={(e) => setCode(e.target.value)} />
            <FieldError state={s} name="propertyCode" />
            <PropertyPreviewLine code={code} />
          </Field>
          {consultants.length > 0 && (
            <Field label="Consultora responsável" htmlFor="consultantId">
              <Select id="consultantId" name="consultantId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {consultants.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <FieldError state={s} name="consultantId" />
            </Field>
          )}
          <SubmitButton className="w-full sm:w-auto">Cadastrar visita</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

type Pv = { status: string; photoUrl?: string | null; title?: string | null; url?: string | null };

/** Confirma o imóvel enquanto digita o código: foto e título do anúncio. */
function PropertyPreviewLine({ code }: { code: string }) {
  const [pv, setPv] = useState<Pv | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const c = code.trim();
    if (c.length < 3) return setPv(null);
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/properties/preview?codigo=${encodeURIComponent(c)}`, { signal: ctl.signal, headers: { "x-requested-with": "visitas" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setPv(d))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 600);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [code]);
  if (code.trim().length < 3) return null;
  if (loading && !pv) return <p className="mt-2 text-[13px] text-ink-3">Buscando o imóvel no site…</p>;
  if (!pv) return null;
  if (pv.status === "OK")
    return (
      <div className="animate-rise mt-2.5 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-2.5">
        {pv.photoUrl ? <img src={pv.photoUrl} alt="" referrerPolicy="no-referrer" className="size-14 shrink-0 rounded-xl object-cover" /> : null}
        <div className="min-w-0">
          <p className="text-[12px] font-bold text-good">✓ Imóvel encontrado</p>
          <p className="line-clamp-2 text-[13px] text-ink-2">{pv.title}</p>
        </div>
      </div>
    );
  if (pv.status === "NOT_FOUND") return <p className="mt-2 text-[13px] font-semibold text-warn">Código não encontrado no site — confira se está certo (pode ser imóvel fora do ar).</p>;
  return null;
}
