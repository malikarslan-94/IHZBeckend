export const money = (v: unknown) =>
  `Rs ${Number(v || 0).toLocaleString('en-PK', { maximumFractionDigits: Number(v) % 1 ? 2 : 0 })}`;
const small = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n: number): string {
  if (n < 20) return small[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? '-' + small[n % 10] : '');
  if (n < 1000) return small[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + words(n % 100) : '');
  for (const [v, label] of [
    [1e9, 'billion'],
    [1e6, 'million'],
    [1000, 'thousand'],
  ] as const)
    if (n >= v) return words(Math.floor(n / v)) + ' ' + label + (n % v ? ' ' + words(n % v) : '');
  return '';
}
export function amountInWords(amount: unknown) {
  const paisa = Math.round(Number(amount) * 100);
  const text =
    words(Math.floor(paisa / 100)) +
    ' rupees' +
    (paisa % 100 ? ' and ' + words(paisa % 100) + ' paisa' : '') +
    ' only';
  return text[0].toUpperCase() + text.slice(1);
}
