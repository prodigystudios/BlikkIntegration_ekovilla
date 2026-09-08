import { describe, it, expect } from 'vitest';
import {
  reminderNotificationText,
  reminderReasonFor,
  reminderSmsBody,
  remindableUsers,
  smsReachSentence,
  timeReminderHref,
} from '@/lib/domains/time/reminders';
import { buildTimeReminderNotification } from '@/lib/domains/notifications/payload';

const row = (status: 'open' | 'submitted' | 'approved', entry_count: number) => ({ status, entry_count });

describe('reminderReasonFor', () => {
  it('skiljer "inget rapporterat" från "ej inlämnad"', () => {
    expect(reminderReasonFor(row('open', 0))).toBe('nothing_reported');
    expect(reminderReasonFor(row('open', 12))).toBe('not_submitted');
  });

  it('påminner aldrig om en inlämnad månad', () => {
    // Personen har gjort sitt och väntar på OSS. En påminnelse där ber om något hon redan lämnat,
    // och nästa gång läser hon inte påminnelserna.
    expect(reminderReasonFor(row('submitted', 12))).toBeNull();
    expect(reminderReasonFor(row('submitted', 0))).toBeNull();
  });

  it('påminner aldrig om en attesterad månad', () => {
    expect(reminderReasonFor(row('approved', 12))).toBeNull();
  });
});

describe('remindableUsers', () => {
  it('behåller listans ordning och tar bara med dem som går att påminna', () => {
    const people = [
      { user_id: 'a', ...row('open', 0) },
      { user_id: 'b', ...row('submitted', 20) },
      { user_id: 'c', ...row('open', 5) },
      { user_id: 'd', ...row('approved', 30) },
    ];
    expect(remindableUsers(people).map((p) => p.user_id)).toEqual(['a', 'c']);
  });
});

describe('reminderNotificationText', () => {
  it('säger vad appen VET, aldrig hur mycket som fattas', () => {
    // 🧨 Regeln som hela funktionen finns för. Systemet känner varken tjänstgöringsgrad eller
    // schema, så varje antal dagar/timmar i texten vore en gissning maskerad som en uppgift —
    // och en deltidare hade fått den varje månad tills ingen läste påminnelserna längre.
    const nothing = reminderNotificationText('nothing_reported', '2026-08-01');
    const notSubmitted = reminderNotificationText('not_submitted', '2026-08-01');
    for (const text of [nothing, notSubmitted]) {
      expect(`${text.title} ${text.body}`).not.toMatch(/\d+\s*(dag|dagar|timmar|h\b)/i);
    }
  });

  it('namnger månaden i både rubrik och text', () => {
    const text = reminderNotificationText('nothing_reported', '2026-08-01');
    expect(text.title).toContain('augusti 2026');
    expect(text.body).toContain('augusti 2026');
  });

  it('skiljer de två anledningarna åt i sak', () => {
    expect(reminderNotificationText('nothing_reported', '2026-08-01').body).toContain('ingen rapporterad tid');
    expect(reminderNotificationText('not_submitted', '2026-08-01').body).toContain('inte inlämnad');
  });

  it('lägger till det egna meddelandet utan att ersätta mallen', () => {
    const text = reminderNotificationText('not_submitted', '2026-08-01', 'Lönen körs på fredag.');
    expect(text.body).toContain('inte inlämnad');
    expect(text.body).toContain('Lönen körs på fredag.');
  });

  it('ignorerar ett meddelande som bara är blanksteg', () => {
    const text = reminderNotificationText('not_submitted', '2026-08-01', '   ');
    expect(text.body).toBe(reminderNotificationText('not_submitted', '2026-08-01').body);
  });
});

describe('reminderSmsBody', () => {
  const base = { periodStart: '2026-08-01', origin: 'https://app.ekovilla.se' } as const;

  it('skriver ut avsändaren — SMS:et landar utan appen omkring sig', () => {
    expect(reminderSmsBody({ ...base, reason: 'not_submitted' })).toMatch(/^Ekovilla:/);
  });

  it('bär en absolut länk till tidrapporten', () => {
    expect(reminderSmsBody({ ...base, reason: 'nothing_reported' })).toContain(
      'https://app.ekovilla.se/tid?datum=2026-08-01',
    );
  });

  it('håller sig på en rad — radbrytningar delar SMS:et i onödan', () => {
    const body = reminderSmsBody({ ...base, reason: 'not_submitted', message: 'Kom ihåg resan till Borås.' });
    expect(body).not.toContain('\n');
    expect(body).toContain('Kom ihåg resan till Borås.');
  });

  it('påstår inget antal, precis som notisen', () => {
    expect(reminderSmsBody({ ...base, reason: 'nothing_reported' })).not.toMatch(/\d+\s*(dag|dagar|timmar)/i);
  });
});

// 🧨 Href:en är periodens ANKARE i notistabellen, inte bara en länk: `entity_id` är uuid-typad och
// en periodstart är ingen uuid, så historiken ("påmind 3 sep") läser tillbaka raderna på exakt den
// här strängen. Ändras formatet på ena stället tystnar historiken utan att något går sönder
// synligt — därför binder testet ihop producenten och frågan.
describe('timeReminderHref som kontrakt', () => {
  it('ger notisen samma href som historikfrågan letar på', () => {
    const href = timeReminderHref('2026-08-01');
    const notification = buildTimeReminderNotification({ title: 't', body: 'b', href });
    expect(notification.href).toBe(href);
    expect(href).toBe('/tid?datum=2026-08-01');
  });

  it('pekar på tidrapporten med periodens första dag', () => {
    expect(timeReminderHref('2026-12-01')).toBe('/tid?datum=2026-12-01');
  });

  it('lämnar entity_id null — en periodstart är ingen uuid', () => {
    const notification = buildTimeReminderNotification({ title: 't', body: 'b', href: timeReminderHref('2026-08-01') });
    expect(notification.entity_id).toBeNull();
    expect(notification.type).toBe('time.reminder');
  });
});

// Raden under SMS-rutan. Fyra fall och en fälla: ett `alla` utanför singularvalet gav en ensam
// mottagare meningen "Går till alla mottagaren", vilket William läste som en fråga om vad den
// egentligen menade — och det är precis vad en trasig mening gör, den flyttar tolkningsarbetet
// till läsaren mitt i ett beslut som kostar pengar.
describe('smsReachSentence', () => {
  it('säger ingenting om antal när telefonuppgiften inte gick att läsa', () => {
    const text = smsReachSentence({ known: false, total: 5, reachable: 0 });
    expect(text).toContain('Notisen går alltid');
    // Får INTE påstå att ingen har nummer — vi vet inte.
    expect(text).not.toContain('Ingen av mottagarna');
  });

  it('böjer rätt för en enda mottagare', () => {
    expect(smsReachSentence({ known: true, total: 1, reachable: 1 })).toBe('Går till mottagaren.');
    expect(smsReachSentence({ known: true, total: 1, reachable: 1 })).not.toContain('alla');
  });

  it('säger vad som händer när den ende mottagaren saknar nummer', () => {
    const text = smsReachSentence({ known: true, total: 1, reachable: 0 });
    expect(text).toContain('Mottagaren har inget telefonnummer');
    expect(text).toContain('bara notisen går fram');
  });

  it('räknar upp när alla i en grupp kan nås', () => {
    expect(smsReachSentence({ known: true, total: 4, reachable: 4 })).toBe('Går till alla 4 mottagarna.');
  });

  it('säger hur många som faller bort när bara några kan nås', () => {
    expect(smsReachSentence({ known: true, total: 4, reachable: 3 })).toBe(
      'Går till 3 av 4. 1 saknar telefonnummer i profilen.',
    );
  });

  it('säger rakt ut när ingen i gruppen kan nås', () => {
    expect(smsReachSentence({ known: true, total: 4, reachable: 0 })).toContain('Ingen av mottagarna');
  });
});
