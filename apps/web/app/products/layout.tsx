import { CatalogShell } from '../../components/catalog-shell';

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return <CatalogShell>{children}</CatalogShell>;
}
