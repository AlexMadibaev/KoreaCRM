export default function OfflinePage() {
  return <main className="crm-offline-page">
    <div className="crm-offline-card">
      <span className="crm-offline-mark" aria-hidden="true">K</span>
      <span className="crm-eyebrow">KOREA CRM</span>
      <h1>Нет подключения к серверу</h1>
      <p>Проверьте интернет и откройте страницу снова. Продажи и изменения остатков доступны только при подключении.</p>
      <a href="/">Повторить подключение →</a>
    </div>
  </main>;
}
