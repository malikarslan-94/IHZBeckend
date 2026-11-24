import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import puppeteer, { type Browser, type PDFOptions } from 'puppeteer';
import { Decimal } from 'decimal.js';
import { env } from '../config/env.js';
import { db } from '../config/db.js';
import { getSettings } from '../modules/settings/routes.js';
import { money, plainAmount, amountInWords } from './money.js';
import { dateText, dateTimeText } from './dates.js';
// a5: one A5 landscape slip. a4: the same slip twice (patient + office copy) on one A4 sheet.
export const printFormats = ['a5', 'a4', 'thermal'] as const;
export type PrintFormat = (typeof printFormats)[number];
Handlebars.registerHelper('money', money);
Handlebars.registerHelper('num', plainAmount);
Handlebars.registerHelper('date', dateText);
Handlebars.registerHelper('dateTime', dateTimeText);
Handlebars.registerHelper('label', (s: string) =>
  String(s || '')
    .replaceAll('_', ' ')
    .toLowerCase(),
);
Handlebars.registerHelper('inc', (n: number) => n + 1);
const templates = new Map<string, Handlebars.TemplateDelegate>();
async function render(name: string, data: unknown) {
  let template = templates.get(name);
  if (!template) {
    template = Handlebars.compile(await fs.readFile(path.resolve('src/templates', name + '.html'), 'utf8'));
    templates.set(name, template);
  }
  return template(data);
}
let a5Styles: string | undefined;
async function styles() {
  return (a5Styles ??= await fs.readFile(path.resolve('src/templates', 'a5.css'), 'utf8'));
}
// Only these patient fields reach printed documents; medical notes never do.
function printablePatient(patient: any) {
  return {
    fullName: patient.fullName,
    patientCode: patient.patientCode,
    age: patient.age,
    gender: patient.gender,
    phone: patient.phone,
    guardianName: patient.guardianName,
    guardianRelation: patient.guardianRelation,
    // Same style as the IDC slip: "40 yr(s) / F"
    ageGender:
      [patient.age != null ? `${patient.age} yr(s)` : '', patient.gender?.[0] ?? ''].filter(Boolean).join(' / ') ||
      '—',
    guardian: patient.guardianName
      ? `${patient.guardianName}${patient.guardianRelation ? ` (${patient.guardianRelation})` : ''}`
      : 'Self',
  };
}
const sentenceCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');
async function letterhead(format: PrintFormat) {
  const settings = await getSettings();
  const { company_phone: phone, company_whatsapp: whatsapp } = settings;
  return {
    settings,
    logo: settings.logo?.startsWith('data:image/') ? settings.logo : '',
    whatsapp: whatsapp && whatsapp !== phone ? whatsapp : '',
    // Terms print as a numbered "Note:" list; any numbering typed into the setting is replaced.
    terms: String(settings.terms_text || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d{1,2}\s*[).:-]+\s+/, '').trim())
      .filter(Boolean),
    styles: format === 'thermal' ? '' : await styles(),
    twoUp: format === 'a4',
    copies: format === 'a4' ? [{ copyName: 'Patient copy' }, { copyName: 'Office copy' }] : [{ copyName: '' }],
  };
}
async function userName(id: number | null | undefined) {
  if (!id) return '';
  return (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? '';
}
function servicePeriod(start?: Date | null, end?: Date | null) {
  return [...new Set([start, end].filter(Boolean).map(dateText))].join(' – ') || '—';
}
export async function billHtml(bill: any, format: PrintFormat, autoPrint = false) {
  const head = await letterhead(format);
  return render(format === 'thermal' ? 'bill-thermal' : 'bill-a5', {
    ...bill,
    ...head,
    patient: printablePatient(bill.request.patient),
    request: bill.request,
    items: bill.request.items,
    chargeLines: bill.request.chargeLines ?? [],
    // The A5 table lists services and additional charges together, so its total covers both.
    itemsTotal: new Decimal(bill.subtotal).add(bill.extraCharges).toFixed(2),
    servicePeriod: servicePeriod(bill.request.startDate, bill.request.endDate),
    visitTypeText: sentenceCase(bill.request.visitType),
    showNursePhone: head.settings.show_nurse_phone_on_bill === 'true',
    amountWords: amountInWords(bill.total),
    hasExtra: Number(bill.extraCharges) !== 0,
    hasDiscount: Number(bill.discount) !== 0,
    hasTax: Number(bill.taxAmount) !== 0,
    receivedVia: [...new Set(bill.payments.map((p: any) => sentenceCase(p.method)))].join(', '),
    preparedBy: await userName(bill.createdById),
    cancelled: bill.status === 'CANCELLED',
    statusText: bill.status === 'PARTIAL' ? 'PARTIALLY PAID' : bill.status,
    autoPrint,
  });
}
export async function receiptHtml(payment: any, format: PrintFormat) {
  return render(format === 'thermal' ? 'payment-receipt' : 'payment-receipt-a5', {
    ...payment,
    ...(await letterhead(format)),
    patient: printablePatient(payment.bill.request.patient),
    methodText: sentenceCase(payment.method),
    receivedBy: await userName(payment.receivedById),
  });
}
let browserPromise: Promise<Browser> | undefined;
export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = undefined;
    await browser.close();
  }
}
// Margins match the @page rules in the A5 templates.
const pageLayouts: Record<Exclude<PrintFormat, 'thermal'>, PDFOptions> = {
  a5: { format: 'A5', landscape: true, margin: { top: '6mm', right: '9mm', bottom: '5mm', left: '0' } },
  a4: { format: 'A4', margin: { top: '0', right: '0', bottom: '0', left: '0' } },
};
export async function createPdf(html: string, format: PrintFormat) {
  browserPromise ??= puppeteer
    .launch({
      headless: true,
      executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: env.PUPPETEER_NO_SANDBOX === 'true' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    })
    .catch((e) => {
      browserPromise = undefined;
      throw e;
    });
  const browser = await browserPromise;
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (r) =>
      r.url().startsWith('data:') || r.url() === 'about:blank' ? void r.continue() : void r.abort(),
    );
    await page.setContent(html, { waitUntil: 'load' });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const bytes = await page.pdf(
      format === 'thermal'
        ? {
            width: '80mm',
            height: `${Math.max(400, height + 32)}px`,
            printBackground: true,
            margin: { top: '4mm', bottom: '4mm', left: '4mm', right: '4mm' },
          }
        : { ...pageLayouts[format], printBackground: true, preferCSSPageSize: true },
    );
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}
