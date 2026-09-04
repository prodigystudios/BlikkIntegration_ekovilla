// Felet som ihopfogningen kastar, i en modul UTAN pdf-lib.
//
// Routen måste kunna känna igen felet med `instanceof` för att svara med ett vettigt besked i
// stället för ett generiskt 500. Importeras klassen från `offerPdfAssembly` drar routen samtidigt
// in pdf-lib i sin modulgraf, och då laddas hela PDF-motorn på varje kallstart — precis det som
// `offerPdfMode.ts` finns till för att undvika på den andra vägen.

export class OfferAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferAttachmentError';
  }
}
