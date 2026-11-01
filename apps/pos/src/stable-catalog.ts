export async function fetchStableCatalog<Product, Customer>(
  revision: () => Promise<string>,
  products: () => Promise<Product[]>,
  customers: () => Promise<Customer[]>,
  onRetry: () => void,
): Promise<{ revision: string; products: Product[]; customers: Customer[] }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await revision();
    const [loadedProducts, loadedCustomers] = await Promise.all([products(), customers()]);
    const after = await revision();
    if (before === after) return { revision: after, products: loadedProducts, customers: loadedCustomers };
    if (attempt < 2) onRetry();
  }
  throw new Error('Товары изменились во время загрузки. Повторите обновление.');
}
