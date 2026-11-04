import { Decimal } from 'decimal.js';
import { AppError } from './errors.js';
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
type Money = Decimal.Value;
export function calculateBill(
  items: { quantity: Money; rate: Money }[],
  charges: { extraCharges?: Money; discount?: Money; taxPercent?: Money } = {},
  payments: { amount: Money }[] = [],
  cancelled = false,
) {
  const amounts = items.map((i) => {
    const q = new Decimal(i.quantity),
      r = new Decimal(i.rate);
    if (q.lte(0) || r.lt(0))
      throw new AppError(422, 'INVALID_LINE', 'Quantity must be positive and rate cannot be negative.');
    return q.mul(r).toDecimalPlaces(2);
  });
  const subtotal = amounts.reduce((sum, v) => sum.add(v), new Decimal(0));
  const extraCharges = new Decimal(charges.extraCharges || 0),
    discount = new Decimal(charges.discount || 0),
    taxPercent = new Decimal(charges.taxPercent || 0);
  if (extraCharges.lt(0) || discount.lt(0) || taxPercent.lt(0) || taxPercent.gt(100))
    throw new AppError(
      422,
      'INVALID_CHARGES',
      'Charges, discount and tax must be valid non-negative values.',
    );
  if (discount.gt(subtotal.add(extraCharges)))
    throw new AppError(422, 'DISCOUNT_TOO_HIGH', 'Discount cannot exceed subtotal plus extra charges.', {
      discount: 'Discount is greater than the chargeable amount.',
    });
  const taxAmount = subtotal.add(extraCharges).sub(discount).mul(taxPercent).div(100).toDecimalPlaces(2);
  const total = subtotal.add(extraCharges).sub(discount).add(taxAmount);
  const paidAmount = payments.reduce((sum, p) => sum.add(p.amount), new Decimal(0));
  const balance = total.sub(paidAmount);
  if ([subtotal, extraCharges, discount, total, paidAmount, balance].some((v) => v.abs().gt('9999999999.99')))
    throw new AppError(422, 'AMOUNT_TOO_LARGE', 'Bill amount exceeds the supported limit.');
  const status = cancelled
    ? 'CANCELLED'
    : paidAmount.gte(total) && total.gt(0)
      ? 'PAID'
      : paidAmount.gt(0)
        ? 'PARTIAL'
        : 'UNPAID';
  return {
    subtotal: subtotal.toFixed(2),
    extraCharges: extraCharges.toFixed(2),
    discount: discount.toFixed(2),
    taxPercent: taxPercent.toFixed(2),
    taxAmount: taxAmount.toFixed(2),
    total: total.toFixed(2),
    paidAmount: paidAmount.toFixed(2),
    balance: balance.toFixed(2),
    status: status as 'CANCELLED' | 'PAID' | 'PARTIAL' | 'UNPAID',
  };
}
