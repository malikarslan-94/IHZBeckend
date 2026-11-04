import {describe,it,expect} from 'vitest';
import {calculateBill} from '../src/lib/billCalculator.js';
import {karachiYear} from '../src/lib/numberGenerator.js';
import {patientSchema,paymentSchema} from '../shared/schema.js';
import {amountInWords} from '../src/lib/money.js';
describe('Billing and shared validation',()=>{
 it('rounds each decimal line, then applies discount and tax',()=>{const b=calculateBill([{quantity:'1.25',rate:'100.01'}],{extraCharges:10,discount:5,taxPercent:15});expect(b.subtotal).toBe('125.01');expect(b.taxAmount).toBe('19.50');expect(b.total).toBe('149.51');});
 it('rejects discounts above the chargeable amount',()=>expect(()=>calculateBill([{quantity:1,rate:100}],{discount:101})).toThrow('Discount'));
 it('handles unpaid, partial, paid, overpaid and cancelled states',()=>{const items=[{quantity:2,rate:500}];expect(calculateBill(items).status).toBe('UNPAID');expect(calculateBill(items,{},[{amount:100}]).status).toBe('PARTIAL');expect(calculateBill(items,{},[{amount:1000}]).status).toBe('PAID');expect(calculateBill(items,{},[{amount:1100}]).balance).toBe('-100.00');expect(calculateBill(items,{},[{amount:1000}],true).status).toBe('CANCELLED');expect(calculateBill([{quantity:1,rate:0}]).status).toBe('UNPAID');});
 it('rejects nonpositive quantities and negative rates',()=>{expect(()=>calculateBill([{quantity:0,rate:500}])).toThrow();expect(()=>calculateBill([{quantity:1,rate:-1}])).toThrow();});
 it('normalizes Pakistan mobiles and requires bank references',()=>{const p={fullName:'Test Patient',phone:'+923001234567',address:'Islamabad'};expect(patientSchema.parse(p).phone).toBe('03001234567');expect(paymentSchema.safeParse({amount:1,method:'BANK_TRANSFER'}).success).toBe(false);expect(paymentSchema.safeParse({amount:0,method:'CASH'}).success).toBe(false);});
 it('uses the Karachi year boundary and amount in words',()=>{expect(karachiYear(new Date('2026-12-31T20:00:00Z'))).toBe('2027');expect(amountInWords(23000)).toBe('Twenty-three thousand rupees only');});
});
