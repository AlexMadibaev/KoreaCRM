import { useEffect, useEffectEvent, useRef, useState } from 'react';

export const defaultIdleSeconds = 15;
export const minIdleSeconds = 1;
export const maxIdleSeconds = 3600;
const warningSeconds = 5;
const activityEvents = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;

export function validIdleSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minIdleSeconds && value <= maxIdleSeconds;
}

export function usePosIdle(enabled: boolean, idleSeconds: number, onExpire: () => void) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const continueRef = useRef<() => void>(() => {});
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (!enabled) return;
    let lastActivity = Date.now();
    let warningDeadline = 0;
    let timer: number;

    function tick() {
      const now = Date.now();
      if (!warningDeadline) {
        const untilWarning = lastActivity + idleSeconds * 1000 - now;
        if (untilWarning > 0) {
          timer = window.setTimeout(tick, untilWarning);
          return;
        }
        warningDeadline = now + warningSeconds * 1000;
      }
      const untilLogout = warningDeadline - now;
      if (untilLogout <= 0) {
        setRemaining(null);
        expire();
        return;
      }
      setRemaining(Math.ceil(untilLogout / 1000));
      timer = window.setTimeout(tick, Math.min(1000, untilLogout));
    }

    function recordActivity(event: Event) {
      if (event.isTrusted && !warningDeadline) lastActivity = Date.now();
    }

    continueRef.current = () => {
      window.clearTimeout(timer);
      warningDeadline = 0;
      lastActivity = Date.now();
      setRemaining(null);
      tick();
    };

    for (const event of activityEvents) window.addEventListener(event, recordActivity, { capture: true, passive: true });
    tick();
    return () => {
      window.clearTimeout(timer);
      for (const event of activityEvents) window.removeEventListener(event, recordActivity, true);
      continueRef.current = () => {};
      setRemaining(null);
    };
  }, [enabled, idleSeconds]);

  return { remaining: enabled ? remaining : null, continueSession: () => continueRef.current() };
}

export function PosIdleWarning({ remaining, onContinue }: { remaining: number; onContinue: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="pos-idle-dialog" ref={dialog} aria-labelledby="pos-idle-title" onCancel={event => event.preventDefault()}>
    <h2 id="pos-idle-title">Вы ещё здесь?</h2>
    <p>Выход из аккаунта через {remaining} сек.</p>
    <button type="button" className="cs-action is-accent" autoFocus onClick={onContinue}>Да, я здесь</button>
  </dialog>;
}
