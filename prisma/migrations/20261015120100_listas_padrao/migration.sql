-- Listas padrão (a gestão edita em Listas e motivos). Separado da migração anterior:
-- valores novos de enum só podem ser usados depois que a transação que os criou termina.
INSERT INTO "Reason" ("id", "kind", "label", "sortOrder") VALUES
  (gen_random_uuid()::text, 'GUARANTEE', 'Fiador', 0),
  (gen_random_uuid()::text, 'GUARANTEE', 'Seguro fiança', 1),
  (gen_random_uuid()::text, 'GUARANTEE', 'CredPago', 2),
  (gen_random_uuid()::text, 'GUARANTEE', 'Aluga Rápido', 3),
  (gen_random_uuid()::text, 'GUARANTEE', 'CredAluga', 4),
  (gen_random_uuid()::text, 'GUARANTEE', 'Título de Capitalização', 5),
  (gen_random_uuid()::text, 'VISIT_CANCEL', 'Cliente desistiu', 0),
  (gen_random_uuid()::text, 'VISIT_CANCEL', 'Cliente não confirmou', 1),
  (gen_random_uuid()::text, 'VISIT_CANCEL', 'Imóvel já alugado', 2),
  (gen_random_uuid()::text, 'VISIT_CANCEL', 'Imóvel indisponível para visita', 3),
  (gen_random_uuid()::text, 'VISIT_CANCEL', 'Pré-análise reprovada', 4),
  (gen_random_uuid()::text, 'VISIT_CANCEL', 'Outro', 5),
  (gen_random_uuid()::text, 'LEASE_HIGHLIGHT', 'Alugado na 1ª visita', 0),
  (gen_random_uuid()::text, 'LEASE_HIGHLIGHT', 'Alugado em até 7 dias da 1ª visita', 1),
  (gen_random_uuid()::text, 'LEASE_HIGHLIGHT', 'Cliente indicado', 2),
  (gen_random_uuid()::text, 'LEASE_HIGHLIGHT', 'Imóvel estava parado há muito tempo', 3),
  (gen_random_uuid()::text, 'LEASE_HIGHLIGHT', 'Outro', 4)
ON CONFLICT ("kind", "label") DO NOTHING;
