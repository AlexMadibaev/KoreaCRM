'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProductForm } from '../../../components/product-form';

export default function NewProductPage() {
  const router = useRouter();
  return <section className="space-y-5"><Link href="/products" className="text-sm underline">← К товарам</Link><h1 className="text-2xl font-semibold">Новый товар</h1><p className="text-sm text-slate-500">После сохранения откроется карточка товара, где можно добавить фотографии и цену продажи.</p><ProductForm onSaved={(product) => router.push(`/products/${product.id}`)} /></section>;
}
