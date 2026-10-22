import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { safeReturnTo } from './returnTo';

/**
 * En lista som öppnar en panel eller ett formulär från en djuplänk (`?quote_id=`, `?call_id=`,
 * `?task_id=`, `?ny_order=`) som bär en returväg — i dag från kundkortet. Då är panelen hela besöket:
 * när den stängs eller sparas går man tillbaka dit länken kom ifrån, inte till listan man aldrig bad om.
 *
 * - `arm(raw)` när DJUPLÄNKENS panel faktiskt öppnas, aldrig vid montering. En djuplänk som inte
 *   hittar sin rad öppnar ingenting, och en panel användaren sedan öppnar själv ska stängas i listan.
 * - `disarm()` när användaren själv byter resa (öppnar en annan rad, går vidare till Redigera).
 * - `leave()` vid stäng/spara. 🧨 `replace`, inte `push`: låg djuplänkens adress kvar i historiken
 *   öppnade Bakåt från kortet panelen igen, och dess stängning ledde till kortet igen — en loop man
 *   inte kom ur med bakåtknappen.
 */
export function useDeepLinkReturn() {
  const router = useRouter();
  const targetRef = useRef<string | null>(null);
  return {
    arm(raw: string | null) { targetRef.current = safeReturnTo(raw); },
    disarm() { targetRef.current = null; },
    /** Den aktiva returvägen, eller null. */
    current(): string | null { return targetRef.current; },
    /** Går tillbaka om en returväg är aktiv. Sant när den navigerade. */
    leave(): boolean {
      const target = targetRef.current;
      targetRef.current = null;
      if (!target) return false;
      router.replace(target);
      return true;
    },
  };
}
