WITH settings AS (
  SELECT COALESCE(
    (SELECT "rules"::jsonb FROM "LoyaltySettings" WHERE "id" = 1),
    '{"mode":"DISCOUNT","tiers":[{"minimumMinor":"50000","percent":"7"},{"minimumMinor":"80000","percent":"10"}]}'::jsonb
  ) AS rules
), tiers AS (
  SELECT (tier->>'minimumMinor')::numeric AS minimum, (tier->>'percent')::numeric AS percent
  FROM settings CROSS JOIN LATERAL jsonb_array_elements(rules->'tiers') AS tier
  WHERE rules->>'mode' = 'DISCOUNT'
), refunds AS (
  SELECT "saleId", SUM("amountMinor") AS amount
  FROM "SaleReturn"
  GROUP BY "saleId"
), earned AS (
  SELECT sale."customerId", MAX(tiers.percent) AS percent
  FROM "Sale" AS sale
  LEFT JOIN refunds ON refunds."saleId" = sale."id"
  JOIN tiers ON sale."totalMinor" - COALESCE(refunds.amount, 0) >= tiers.minimum
  WHERE sale."status" = 'COMPLETED' AND sale."customerId" IS NOT NULL
  GROUP BY sale."customerId"
)
UPDATE "Customer" AS customer
SET "discountPercent" = earned.percent, "updatedAt" = CURRENT_TIMESTAMP
FROM earned
WHERE customer."id" = earned."customerId"
  AND customer."deletedAt" IS NULL
  AND customer."discountPercent" < earned.percent;
