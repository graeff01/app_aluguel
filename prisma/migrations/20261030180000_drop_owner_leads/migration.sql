-- "Quanto rende o seu imóvel?" retirado: apaga os contatos de proprietários (dados pessoais) e os avisos ligados a eles
DELETE FROM "Alert" WHERE "url" = '/demanda/proprietarios';
DROP TABLE "OwnerLead";
