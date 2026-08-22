import { describe, it, expect } from 'vitest';
import {
  decidePushSync,
  readFlag,
  writeFlag,
  shouldPersistEndpoint,
  markEndpointPersisted,
  PUSH_HAD_SUBSCRIPTION_KEY,
  PUSH_OPT_OUT_KEY,
  PUSH_PROMPT_DISMISSED_KEY,
  PUSH_PERSISTED_ENDPOINT_KEY,
  type PushPermission,
  type StorageLike,
} from '@/lib/domains/notifications/pushSync';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? String(map.get(k)) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
    dump: () => Object.fromEntries(map),
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => { throw new Error('storage blocked'); },
    setItem: () => { throw new Error('storage blocked'); },
    removeItem: () => { throw new Error('storage blocked'); },
  };
}

const BASE = {
  hasSubscription: false,
  permission: 'default' as PushPermission,
  optedOut: false,
  promptDismissed: false,
  hadSubscription: false,
};

describe('decidePushSync — de fyra grenarna', () => {
  it('lokal prenumeration finns → persist (så länge användaren inte valt bort notiser)', () => {
    for (const permission of ['default', 'granted', 'denied'] as PushPermission[]) {
      for (const promptDismissed of [false, true]) {
        for (const hadSubscription of [false, true]) {
          expect(
            decidePushSync({ hasSubscription: true, permission, optedOut: false, promptDismissed, hadSubscription }),
          ).toBe('persist');
        }
      }
    }
  });

  it('ingen prenumeration + granted + tidigare prenumeration → tyst omprenumeration', () => {
    expect(decidePushSync({ ...BASE, permission: 'granted', hadSubscription: true })).toBe('resubscribe-silently');
  });

  it('granted UTAN markör frågar i stället för att prenumerera tyst', () => {
    // Den som stängde av notiser innan flaggorna fanns har beviljat tillstånd, ingen prenumeration
    // och ingen markör — exakt samma form som "tappad rad". Utan den här regeln hade vi tyst slagit
    // på notiserna igen för någon som valt bort dem. Samma sak om localStorage vräks av ITP.
    expect(decidePushSync({ ...BASE, permission: 'granted', hadSubscription: false })).toBe('prompt');
  });

  it('ingen prenumeration + default → uppmaning', () => {
    expect(decidePushSync({ ...BASE, permission: 'default' })).toBe('prompt');
  });

  it('denied → ingenting, vi kan ändå inte fråga igen', () => {
    expect(decidePushSync({ ...BASE, permission: 'denied' })).toBe('idle');
    expect(decidePushSync({ ...BASE, permission: 'denied', promptDismissed: true })).toBe('idle');
    expect(decidePushSync({ ...BASE, permission: 'denied', optedOut: true })).toBe('idle');
  });
});

describe('decidePushSync — avfärdande och av-val', () => {
  it('avfärdad uppmaning återkommer inte', () => {
    expect(decidePushSync({ ...BASE, permission: 'default', promptDismissed: true })).toBe('idle');
  });

  it('ett avfärdande stoppar INTE den tysta omprenumerationen — den syns ju inte', () => {
    expect(
      decidePushSync({ ...BASE, permission: 'granted', hadSubscription: true, promptDismissed: true }),
    ).toBe('resubscribe-silently');
  });

  it('av-val slår tyst omprenumeration — annars slås notiser på igen efter disable()', () => {
    // Formen efter disable(): tillståndet ligger kvar som 'granted', prenumerationen är borta.
    // Utan av-valsflaggan är det exakt samma form som "beviljad men tappad rad".
    expect(decidePushSync({ ...BASE, permission: 'granted', hadSubscription: true, optedOut: true })).toBe('idle');
  });

  it('av-val slår ÄVEN en prenumeration som ligger kvar', () => {
    // unsubscribe() resolvar false vid misslyckande utan att kasta. Då står av-valet skrivet med
    // prenumerationen kvar — och en persist hade POST:at om den och återuppväckt raden som
    // avstängningen just raderade.
    expect(
      decidePushSync({ ...BASE, hasSubscription: true, permission: 'granted', optedOut: true, hadSubscription: true }),
    ).toBe('idle');
  });

  it('av-val slår också uppmaningen — vi tjatar inte om något användaren stängt av', () => {
    expect(decidePushSync({ ...BASE, permission: 'default', optedOut: true })).toBe('idle');
  });
});

describe('decidePushSync — hela matrisen är täckt', () => {
  it('varje kombination ger exakt ett giltigt utfall', () => {
    const seen = new Set<string>();
    for (const hasSubscription of [false, true]) {
      for (const permission of ['default', 'granted', 'denied'] as PushPermission[]) {
        for (const optedOut of [false, true]) {
          for (const promptDismissed of [false, true]) {
            for (const hadSubscription of [false, true]) {
              const action = decidePushSync({ hasSubscription, permission, optedOut, promptDismissed, hadSubscription });
              expect(['persist', 'resubscribe-silently', 'prompt', 'idle']).toContain(action);
              seen.add(action);
            }
          }
        }
      }
    }
    expect(seen).toEqual(new Set(['persist', 'resubscribe-silently', 'prompt', 'idle']));
  });
});

describe('flaggor i storage', () => {
  it('readFlag/writeFlag håller ihop', () => {
    const s = fakeStorage();
    expect(readFlag(s, PUSH_PROMPT_DISMISSED_KEY)).toBe(false);
    writeFlag(s, PUSH_PROMPT_DISMISSED_KEY, true);
    expect(readFlag(s, PUSH_PROMPT_DISMISSED_KEY)).toBe(true);
    writeFlag(s, PUSH_PROMPT_DISMISSED_KEY, false);
    expect(readFlag(s, PUSH_PROMPT_DISMISSED_KEY)).toBe(false);
    expect(s.dump()).toEqual({});
  });

  it('avfärdad uppmaning överlever en ny synk — den kommer inte tillbaka', () => {
    const s = fakeStorage();
    writeFlag(s, PUSH_PROMPT_DISMISSED_KEY, true);
    // Nästa inloggning läser samma flagga och hamnar i idle i stället för prompt.
    const action = decidePushSync({
      ...BASE,
      permission: 'default',
      promptDismissed: readFlag(s, PUSH_PROMPT_DISMISSED_KEY),
    });
    expect(action).toBe('idle');
  });

  it('ett aktivt ja rensar både av-val och avfärdande och sätter markören', () => {
    const s = fakeStorage({ [PUSH_OPT_OUT_KEY]: '1', [PUSH_PROMPT_DISMISSED_KEY]: '1' });
    writeFlag(s, PUSH_OPT_OUT_KEY, false);
    writeFlag(s, PUSH_PROMPT_DISMISSED_KEY, false);
    writeFlag(s, PUSH_HAD_SUBSCRIPTION_KEY, true);
    expect(s.dump()).toEqual({ [PUSH_HAD_SUBSCRIPTION_KEY]: '1' });
  });

  it('storage som saknas eller kastar tolkas som "inte satt" i stället för att krascha', () => {
    expect(readFlag(null, PUSH_OPT_OUT_KEY)).toBe(false);
    expect(readFlag(undefined, PUSH_OPT_OUT_KEY)).toBe(false);
    expect(readFlag(throwingStorage(), PUSH_OPT_OUT_KEY)).toBe(false);
    expect(() => writeFlag(throwingStorage(), PUSH_OPT_OUT_KEY, true)).not.toThrow();
    expect(() => writeFlag(null, PUSH_OPT_OUT_KEY, true)).not.toThrow();
  });
});

describe('shouldPersistEndpoint — en omPOST per session', () => {
  it('markerar INTE av sig själv — bara en lyckad POST kvitterar', () => {
    // Regressionsvakt: markerades endpointen redan vid frågan räckte ett 401 vid montering för att
    // stämplingen skulle hoppas över resten av sessionen. En ostämplad men levande rad är precis
    // vad städscriptet tolkar som skräp.
    const s = fakeStorage();
    expect(shouldPersistEndpoint(s, 'https://fcm.example/abc')).toBe(true);
    expect(s.dump()[PUSH_PERSISTED_ENDPOINT_KEY]).toBeUndefined();
    expect(shouldPersistEndpoint(s, 'https://fcm.example/abc')).toBe(true);
  });

  it('efter kvittens hoppas den över resten av sessionen', () => {
    const s = fakeStorage();
    expect(shouldPersistEndpoint(s, 'https://fcm.example/abc')).toBe(true);
    markEndpointPersisted(s, 'https://fcm.example/abc');
    expect(shouldPersistEndpoint(s, 'https://fcm.example/abc')).toBe(false);
    expect(s.dump()[PUSH_PERSISTED_ENDPOINT_KEY]).toBe('https://fcm.example/abc');
  });

  it('en NY endpoint POST:as om, även i samma session', () => {
    const s = fakeStorage();
    markEndpointPersisted(s, 'https://fcm.example/abc');
    expect(shouldPersistEndpoint(s, 'https://fcm.example/abc')).toBe(false);
    expect(shouldPersistEndpoint(s, 'https://fcm.example/xyz')).toBe(true);
    markEndpointPersisted(s, 'https://fcm.example/xyz');
    expect(shouldPersistEndpoint(s, 'https://fcm.example/xyz')).toBe(false);
  });

  it('kvittens utan fungerande storage kastar inte', () => {
    expect(() => markEndpointPersisted(null, 'e')).not.toThrow();
    expect(() => markEndpointPersisted(throwingStorage(), 'e')).not.toThrow();
  });

  it('utan fungerande storage POST:ar vi hellre en gång för mycket än att tappa stämplingen', () => {
    expect(shouldPersistEndpoint(null, 'https://fcm.example/abc')).toBe(true);
    expect(shouldPersistEndpoint(throwingStorage(), 'https://fcm.example/abc')).toBe(true);
  });

  it('tom endpoint POST:as aldrig', () => {
    expect(shouldPersistEndpoint(fakeStorage(), '')).toBe(false);
  });
});
