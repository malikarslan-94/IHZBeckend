import { Router } from 'express';
import ExcelJS from 'exceljs';
import { office } from '../../middleware/requireRole.js';
import { report } from './service.js';
import { dayKey } from '../../lib/dates.js';
import { assert } from '../../lib/errors.js';
import { query } from '../../lib/query.js';
export const reportRoutes = Router();
reportRoutes.use(office);
reportRoutes.get('/:name{/:export}', async (req, res) => {
  const name = String(req.params.name),
    q = query(req, []);
  let from = q.from,
    to = q.to;
  if (req.user.role === 'STAFF') {
    from = from || dayKey();
    to = to || dayKey();
    assert(
      name === 'summary' && from === dayKey() && to === dayKey(),
      403,
      'DAILY_ONLY',
      'Staff can access today’s summary only.',
    );
  }
  const data = await report(name, from, to);
  if (req.params.export === 'export') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(name);
    const rows = Array.isArray(data) ? data : [data];
    const keys = rows.length ? Object.keys(rows[0]).filter((k) => k !== 'billId') : ['No records'];
    sheet.columns = keys.map((k) => ({ header: k.replace(/([A-Z])/g, ' $1'), key: k, width: 24 }));
    for (const row of rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087F83' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    res
      .attachment(`${name}-${from || 'all'}-${to || 'all'}.xlsx`)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await workbook.xlsx.write(res);
    res.end();
  } else {
    res.json(data);
  }
});
