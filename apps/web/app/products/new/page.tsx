'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProductForm } from '../../../components/product-form';

export default function NewProductPage() {
  const router = useRouter();
  return <section className="crm-product-detail"><Link href="/products" className="crm-product-back">← Каталог товаров</Link><div className="crm-product-detail-header"><div><span className="crm-eyebrow">АССОРТИМЕНТ</span><h1>Новый товар</h1><p>После сохранения добавьте фотографии и цену продажи в карточке товара.</p></div></div><ProductForm onSaved={(product) => router.push(`/products/${product.id}`)} /></section>;
}
