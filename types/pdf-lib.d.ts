declare module 'pdf-lib' {
  export const StandardFonts: {
    Courier: string;
    CourierBold: string;
    CourierOblique: string;
    CourierBoldOblique: string;
    Helvetica: string;
    HelveticaBold: string;
    HelveticaOblique: string;
    HelveticaBoldOblique: string;
    TimesRoman: string;
    TimesRomanBold: string;
    TimesRomanItalic: string;
    TimesRomanBoldItalic: string;
    Symbol: string;
    ZapfDingbats: string;
  };

  export function rgb(r: number, g: number, b: number): any;

  export class PDFDocument {
    static create(): Promise<PDFDocument>;
    addPage(size?: [number, number] | { width: number; height: number }): any;
    embedFont(font: string): Promise<any>;
  embedPng(png: Uint8Array | ArrayBuffer | Buffer): Promise<{ width: number; height: number }>;
    save(): Promise<Uint8Array>;
  }
}
