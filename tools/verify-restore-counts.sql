SELECT
  (SELECT COUNT(*) FROM public."Product") AS products,
  (SELECT COUNT(*) FROM public."Sale") AS sales,
  (SELECT COUNT(*) FROM public."StockMovement") AS stock_movements;
