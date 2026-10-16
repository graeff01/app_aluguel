-- Lista padrão do que pode faltar numa pré-análise pendente (a gestão edita em Listas e motivos).
-- Separado da migração anterior: valor novo de enum só pode ser usado depois que a transação que o criou termina.
INSERT INTO "Reason" ("id", "kind", "label", "sortOrder") VALUES
  (gen_random_uuid()::text, 'PRE_MISSING', 'Documento com foto (RG ou CNH)', 0),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Comprovante de renda', 1),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Comprovante de residência', 2),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Extrato bancário', 3),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Declaração de imposto de renda', 4),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Certidão de casamento ou união estável', 5),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Dados do fiador', 6),
  (gen_random_uuid()::text, 'PRE_MISSING', 'Outro', 7)
ON CONFLICT ("kind", "label") DO NOTHING;
