import { z } from 'zod';
import { Decimal } from 'decimal.js';
export const roles = ['ADMIN', 'STAFF', 'NURSE'] as const;
export const genders = ['MALE', 'FEMALE', 'OTHER'] as const;
export const units = ['PER_VISIT', 'PER_DAY', 'PER_SHIFT', 'PER_HOUR', 'PER_ITEM'] as const;
export const visits = ['SINGLE_VISIT', 'DAILY_VISITS', 'SHIFT_12H', 'SHIFT_24H', 'OTHER'] as const;
export const requestStatuses = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const billStatuses = ['UNPAID', 'PARTIAL', 'PAID', 'CANCELLED'] as const;
export const methods = ['CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CHEQUE', 'OTHER'] as const;
export const normalizePhone = (value: string) => value.replace(/[\s()-]/g, '').replace(/^\+?92/, '0');
export const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .pipe(z.string().regex(/^03\d{9}$/, 'Enter a valid Pakistani mobile number.'));
const optionalText = z.string().trim().max(3000).nullish();
const blankOptional = (schema: z.ZodTypeAny) => z.preprocess((v) => (v === '' ? null : v), schema.nullish());
export const moneySchema = z.coerce
  .number()
  .finite()
  .min(0)
  .max(9999999999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001, 'Use no more than two decimal places.');
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.');
export const dateSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (!calendarDateSchema.safeParse(value.slice(0, 10)).success) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+05:00`);
  if (z.string().datetime({ offset: true }).safeParse(value).success) return new Date(value);
  return value;
}, z.date({ invalid_type_error: 'Enter a valid date.', required_error: 'Enter a valid date.' }));
export const patientSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required.').max(120),
  phone: phoneSchema,
  altPhone: blankOptional(phoneSchema),
  address: z.string().trim().min(3, 'Address is required.').max(1000),
  area: optionalText,
  city: optionalText,
  age: blankOptional(z.coerce.number().int().min(0).max(130)),
  gender: blankOptional(z.enum(genders)),
  guardianName: optionalText,
  guardianRelation: optionalText,
  medicalNotes: optionalText,
});
export const nurseSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  cnic: blankOptional(z.string().regex(/^\d{5}-\d{7}-\d$/, 'Use XXXXX-XXXXXXX-X.')),
  gender: blankOptional(z.enum(genders)),
  qualification: optionalText,
  isActive: z.boolean().default(true),
});
export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(150),
  category: z.string().trim().min(1).max(80),
  unit: z.enum(units),
  defaultRate: moneySchema,
  description: optionalText,
  isActive: z.boolean().default(true),
});
export const itemSchema = z.object({
  id: z.number().int().positive().optional(),
  serviceId: z.coerce.number().int().positive(),
  description: z.string().trim().min(1).max(300).optional(),
  serviceDate: blankOptional(dateSchema),
  quantity: moneySchema.refine((v) => v > 0 && v <= 99999999.99, 'Quantity must be greater than zero.'),
  rate: moneySchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
}).superRefine((item, context) => {
  if (item.rate !== undefined && new Decimal(item.quantity).mul(item.rate).toDecimalPlaces(2).gt('9999999999.99'))
    context.addIssue({ code: 'custom', path: ['rate'], message: 'Line amount exceeds the supported limit.' });
});
export const billSchema = z.object({
  extraCharges: moneySchema.default(0),
  extraChargesNote: optionalText,
  discount: moneySchema.default(0),
  taxPercent: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    moneySchema.pipe(z.number().max(100)).optional(),
  ),
  notes: optionalText,
});
export const requestFields = z.object({
  patientId: z.coerce.number().int().positive().optional(),
  patient: patientSchema.optional(),
  nurseId: blankOptional(z.coerce.number().int().positive()),
  requestDate: dateSchema.optional(),
  startDate: blankOptional(dateSchema),
  endDate: blankOptional(dateSchema),
  visitType: z.enum(visits),
  serviceAddress: z.string().trim().max(1000).optional(),
  notes: optionalText,
  status: z.enum(requestStatuses).optional(),
  items: z.array(itemSchema).max(100).default([]),
  generateBill: z.boolean().default(false),
  charges: billSchema.optional(),
});
export const requestSchema = requestFields.superRefine((v, c) => {
  if (!v.patientId && !v.patient)
    c.addIssue({ code: 'custom', path: ['patientId'], message: 'Choose or add a patient.' });
  if (v.startDate && v.endDate && v.endDate < v.startDate)
    c.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after start date.' });
  if (v.generateBill && !v.items.length)
    c.addIssue({ code: 'custom', path: ['items'], message: 'Add at least one service to generate a bill.' });
  if (v.status === 'ASSIGNED' && !v.nurseId)
    c.addIssue({ code: 'custom', path: ['nurseId'], message: 'Assign a nurse before marking the request assigned.' });
});
export const paymentSchema = z
  .object({
    amount: moneySchema.refine((v) => v > 0, 'Amount must be greater than zero.'),
    paymentDate: dateSchema.optional(),
    method: z.enum(methods),
    referenceNo: optionalText,
    notes: optionalText,
    allowOverpayment: z.boolean().default(false),
  })
  .superRefine((v, c) => {
    if (v.method !== 'CASH' && !v.referenceNo?.trim())
      c.addIssue({
        code: 'custom',
        path: ['referenceNo'],
        message: 'Reference is required for non-cash payments.',
      });
  });
export const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(72),
  role: z.enum(roles),
  nurseId: blankOptional(z.coerce.number().int().positive()),
  isActive: z.boolean().default(true),
});
export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Please give a reason.').max(1000) });
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(72),
});
export const settingsSchema = z.object({
  company_name: z.string().trim().min(1).max(150),
  company_address: z.string().max(1000),
  company_phone: z.string().max(80),
  company_whatsapp: z.string().max(80),
  company_email: z.union([z.literal(''), z.string().email()]),
  default_city: z.string().max(100),
  bill_prefix: z.string().regex(/^[A-Z0-9-]{1,12}$/),
  bill_footer: z.string().max(1000),
  terms_text: z.string().max(3000),
  tax_percent: z
    .string()
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100, 'Tax must be between 0 and 100.'),
  show_nurse_phone_on_bill: z.enum(['true', 'false']),
});
