import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import puppeteer, { type Browser } from 'puppeteer';
import { env } from '../config/env.js';
import { getSettings } from '../modules/settings/routes.js';
import { money, amountInWords } from './money.js';
import { dateText } from './dates.js';
Handlebars.registerHelper('money', money);
Handlebars.registerHelper('date', dateText);
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
export async function billHtml(bill: any, format: 'a4' | 'thermal', autoPrint = false) {
  const settings = await getSettings();
  const patient = bill.request.patient;
  return render(format === 'a4' ? 'bill-a4' : 'bill-thermal', {
    ...bill,
    patient: {
      fullName: patient.fullName,
      patientCode: patient.patientCode,
      age: patient.age,
      gender: patient.gender,
      phone: patient.phone,
      guardianName: patient.guardianName,
      guardianRelation: patient.guardianRelation,
    },
    request: bill.request,
    items: bill.request.items,
    settings,
    showNursePhone: settings.show_nurse_phone_on_bill === 'true',
    logo: settings.logo?.startsWith('data:image/') ? settings.logo : '',
    amountWords: amountInWords(bill.total),
    cancelled: bill.status === 'CANCELLED',
    statusText: bill.status === 'PARTIAL' ? 'PARTIALLY PAID' : bill.status,
    autoPrint,
  });
}
export async function receiptHtml(payment: any, format: 'a4' | 'thermal') {
  const settings = await getSettings();
  return render('payment-receipt', {
    ...payment,
    settings,
    logo: settings.logo?.startsWith('data:image/') ? settings.logo : '',
    patient: payment.bill.request.patient.fullName,
    thermal: format === 'thermal',
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
export async function createPdf(html: string, format: 'a4' | 'thermal') {
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
      format === 'a4'
        ? {
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', right: '12mm', bottom: '16mm', left: '12mm' },
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate:
              '<div style="font-size:8px;text-align:center;width:100%;color:#777">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
          }
        : {
            width: '80mm',
            height: `${Math.max(400, height + 32)}px`,
            printBackground: true,
            margin: { top: '4mm', bottom: '4mm', left: '4mm', right: '4mm' },
          },
    );
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}
