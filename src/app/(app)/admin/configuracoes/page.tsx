import { requireAdmin } from "@/lib/require";
import { getSettings } from "@/lib/settings";
import { dateOnlyKey } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, PageHeader, Section, Select } from "@/components/ui";
import { settingsAction } from "@/app/actions/admin";

export const metadata = { title: "Regras e aplicativo" };

function YesNo({ name, value, label, hint }: { name: string; value: boolean; label: string; hint?: string }) {
  return (
    <Field label={label} htmlFor={name} hint={hint}>
      <Select id={name} name={name} defaultValue={value ? "1" : "0"}>
        <option value="1">Sim</option>
        <option value="0">Não</option>
      </Select>
    </Field>
  );
}

export default async function SettingsPage() {
  await requireAdmin();
  const s = await getSettings();
  return (
    <>
      <PageHeader title="Regras e aplicativo" />
      <ActionForm action={settingsAction} className="max-w-2xl">
        <Section title="Cobrança de resultados">
          <Field label="Data de início da cobrança" htmlFor="resultsStartDate" hint="Visitas anteriores não entram como pendência nem na cobertura (sem cobrança retroativa).">
            <Input id="resultsStartDate" name="resultsStartDate" type="date" defaultValue={dateOnlyKey(s.resultsStartDate)} required />
          </Field>
          <Field label="Limite da observação (caracteres)" htmlFor="noteMaxLength">
            <Input id="noteMaxLength" name="noteMaxLength" type="number" min={200} max={5000} defaultValue={s.noteMaxLength} />
          </Field>
        </Section>
        <Section title="Permissões das consultoras">
          <YesNo name="consultantCanUpdateOpp" value={s.consultantCanUpdateOpp} label="Podem atualizar o andamento das próprias oportunidades" hint="Gestora e admin sempre podem." />
          <YesNo name="consultantCanCorrectData" value={s.consultantCanCorrectData} label="Podem corrigir dados (nome, telefone, código) das próprias visitas" />
          <YesNo name="consultantCanCreateVisit" value={s.consultantCanCreateVisit} label="Podem cadastrar visita manual" />
        </Section>
        <Section title="Imóveis e metas">
          <Field label="Link do imóvel no site" htmlFor="propertyUrlTemplate" hint="Use {codigo} onde entra o código do imóvel. A foto e o título do anúncio são lidos dessa página (só o código é enviado).">
            <Input id="propertyUrlTemplate" name="propertyUrlTemplate" defaultValue={s.propertyUrlTemplate} maxLength={300} />
          </Field>
          <Field label="Meta de cobertura de registro (%)" htmlFor="coverageGoal" hint="Linha de referência no painel da gestão.">
            <Input id="coverageGoal" name="coverageGoal" type="number" min={50} max={100} defaultValue={s.coverageGoal} />
          </Field>
        </Section>
        <Section title="Lembretes de pendências">
          <YesNo name="remindersEnabled" value={s.remindersEnabled} label="Enviar lembrete diário no celular" hint="Para quem ativou os lembretes no aparelho. Consultora: visitas dela há mais de 24 h sem registro. Gestora: resumo da equipe. Não envia aos domingos." />
          <Field label="Horário do envio (Brasília)" htmlFor="reminderHour">
            <Input id="reminderHour" name="reminderHour" type="number" min={6} max={20} defaultValue={s.reminderHour} />
          </Field>
        </Section>
        <Section title="Sincronização">
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label="Intervalo (minutos)" htmlFor="syncIntervalMinutes">
              <Input id="syncIntervalMinutes" name="syncIntervalMinutes" type="number" min={1} max={120} defaultValue={s.syncIntervalMinutes} />
            </Field>
            <Field label="Intervalo mínimo do botão manual (s)" htmlFor="manualSyncMinSeconds">
              <Input id="manualSyncMinSeconds" name="manualSyncMinSeconds" type="number" min={10} max={3600} defaultValue={s.manualSyncMinSeconds} />
            </Field>
            <Field label="Dias anteriores importados" htmlFor="syncPastDays">
              <Input id="syncPastDays" name="syncPastDays" type="number" min={1} max={365} defaultValue={s.syncPastDays} />
            </Field>
            <Field label="Dias futuros importados" htmlFor="syncFutureDays">
              <Input id="syncFutureDays" name="syncFutureDays" type="number" min={7} max={365} defaultValue={s.syncFutureDays} />
            </Field>
          </div>
        </Section>
        <Section title="Aparência">
          <Field label="Nome do produto" htmlFor="productName">
            <Input id="productName" name="productName" defaultValue={s.productName} maxLength={60} />
          </Field>
          <Field label="Cor principal" htmlFor="primaryColor" hint="Precisa de contraste mínimo 4,5:1 com texto branco.">
            <Input id="primaryColor" name="primaryColor" type="color" defaultValue={s.primaryColor} className="h-12 w-24 p-1" />
          </Field>
        </Section>
        <SubmitButton>Salvar configurações</SubmitButton>
      </ActionForm>
    </>
  );
}
