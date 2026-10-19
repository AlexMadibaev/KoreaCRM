import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13]]]);

function cameraError(caught: unknown) {
  if (caught instanceof DOMException) {
    if (caught.name === 'NotAllowedError' || caught.name === 'PermissionDeniedError') return 'Разрешите кассе доступ к камере в настройках Windows или браузера.';
    if (caught.name === 'NotFoundError' || caught.name === 'DevicesNotFoundError') return 'Камера не найдена. Подключите камеру и попробуйте снова.';
    if (caught.name === 'NotReadableError' || caught.name === 'TrackStartError') return 'Камера занята другим приложением. Закройте его и попробуйте снова.';
  }
  return 'Не удалось включить камеру. Проверьте доступ к ней и попробуйте снова.';
}

export function CameraCodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let detected = false;
    let controls: IScannerControls | undefined;
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 250 });

    void reader.decodeFromVideoDevice(undefined, video, (result, _error, activeControls) => {
      if (!result || cancelled || detected) return;
      detected = true;
      activeControls.stop();
      onDetected(result.getText());
    }).then(activeControls => {
      if (cancelled || detected) activeControls.stop();
      else controls = activeControls;
    }).catch(caught => { if (!cancelled) setError(cameraError(caught)); });

    return () => {
      cancelled = true;
      controls?.stop();
      if (video.srcObject instanceof MediaStream) video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  }, [onDetected]);

  return <div className="camera-scanner">
    <video ref={videoRef} autoPlay muted playsInline aria-label="Изображение с камеры для считывания QR или EAN-13" />
    <p className="scan-hint">Покажите камере QR или штрихкод EAN-13. Вход выполнится автоматически.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button type="button" onClick={onClose}>Закрыть камеру</button>
  </div>;
}
