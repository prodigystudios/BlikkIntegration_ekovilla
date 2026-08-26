import { describe, it, expect } from 'vitest';
import { materialRenameEffect, inferMaterialFromArticle, sacksFor } from '@/lib/domains/crm/materials';

// 🧨 Artikelnamnet är radens ENDA källa till vilket material den är, och materialet ger säckvikten.
// Ur den faller säckantalet på ordern och i planeringen, depålagrets materialavdrag och
// materialrubriken i arbetsbeskrivningen.
//
// Namnet blev redigerbart på arbetsordern (det gick förut bara att sätta i offerten, som låses vid
// orderskapandet). Redigerbarheten är rätt — en generisk "Övrigt"-artikel behöver ofta ett
// begripligt namn — men följden får inte vara tyst.

describe('materialRenameEffect', () => {
  it('varumärkesordet borta → materialet förloras', () => {
    expect(materialRenameEffect('Ekovilla lösull vind', 'Lösull vind'))
      .toEqual({ kind: 'lost', from: 'EKOVILLA' });
  });

  it('byte av varumärke → materialet byts', () => {
    expect(materialRenameEffect('Ekovilla lösull vind', 'Knauf Supafil vind'))
      .toEqual({ kind: 'changed', from: 'EKOVILLA', to: 'KNAUF SUPAFIL' });
  });

  it('omdöpning som behåller varumärket är ofarlig', () => {
    expect(materialRenameEffect('Ekovilla lösull vind', 'Ekovilla lösull – snedtak plan 2')).toBeNull();
  });

  it('rad som aldrig härledde något material varnar inte', () => {
    // En frakt- eller etableringsrad byter ingenting när den döps om.
    expect(materialRenameEffect('Frakt', 'Frakt Stockholm')).toBeNull();
    expect(materialRenameEffect(null, 'Vindduk')).toBeNull();
  });

  it('tömt namn räknas som förlorat material, inte som "ingen ändring"', () => {
    expect(materialRenameEffect('Ekovilla lösull', '')).toEqual({ kind: 'lost', from: 'EKOVILLA' });
    expect(materialRenameEffect('Ekovilla lösull', null)).toEqual({ kind: 'lost', from: 'EKOVILLA' });
  });

  it('skiftläge spelar ingen roll — mönstren är okänsliga', () => {
    expect(materialRenameEffect('EKOVILLA LÖSULL', 'ekovilla lösull')).toBeNull();
  });
});

describe('materialRenameEffect — varför varningen finns', () => {
  it('förlorat material nollar säckantalet', () => {
    const before = inferMaterialFromArticle('Ekovilla lösull vind');
    const after = inferMaterialFromArticle('Lösull vind');
    expect(after).toBeNull();

    // 30 m³ à 45 kg/m³ = 1350 kg. Med Ekovillas 14 kg/säck: 97 säckar.
    expect(sacksFor(30, 45, before!.bagWeight)).toBe(97);
    // Utan material finns ingen säckvikt att räkna med — talet blir noll, och noll säckar PÅSTÅR
    // att inget material går åt. Det är felet varningen ska göra synligt.
    expect(sacksFor(30, 45, 0)).toBe(0);
  });

  it('bytt material ändrar antalet säckar', () => {
    const ekovilla = inferMaterialFromArticle('Ekovilla lösull')!;
    const knauf = inferMaterialFromArticle('Knauf Supafil')!;
    expect(ekovilla.bagWeight).toBe(14);
    expect(knauf.bagWeight).toBe(15.5);
    expect(sacksFor(30, 45, ekovilla.bagWeight)).toBe(97);
    expect(sacksFor(30, 45, knauf.bagWeight)).toBe(88);
  });
});
