'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ProductForm } from '../../../components/product-form';

export default function NewProductPage() {
  const router = useRouter();
  return <section className="crm-product-detail"><Link href="/products" className="crm-product-back">← Каталог товаров</Link><div className="crm-product-detail-header"><div><span className="crm-eyebrow">АССОРТИМЕНТ</span><h1>Новый товар</h1><p>Фотографии можно добавить в карточке товара после сохранения.</p></div></div><ProductForm withPrice onSaved={(product, priceError) => { if (priceError) window.alert(`Товар создан, но цена не сохранена: ${priceError}. Укажите её в карточке товара.`); router.push(`/products/${product.id}`); }} /></section>;
}
