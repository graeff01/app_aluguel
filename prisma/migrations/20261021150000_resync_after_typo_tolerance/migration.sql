-- Reconhecimento de títulos com erro de digitação ("Vista clt"): força uma leitura completa
-- da agenda na próxima sincronização, para importar eventos que antes eram ignorados.
UPDATE "SyncState" SET "lastReconcileAt" = NULL;
