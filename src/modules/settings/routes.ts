import { Router } from 'express';
import multer from 'multer';
import { db } from '../../config/db.js';
import { admin } from '../../middleware/requireRole.js';
import { settingsSchema } from '../../../shared/schema.js';
import { assert } from '../../lib/errors.js';
import { log } from '../../lib/activity.js';
export const getSettings = async () =>
  Object.fromEntries((await db.setting.findMany()).map((s) => [s.key, s.value]));
// Public branding is limited to these two fields; all office settings remain authenticated.
export const getBranding = async () =>
  Object.fromEntries(
    (
      await db.setting.findMany({
        where: { key: { in: ['company_name', 'logo'] } },
        select: { key: true, value: true },
      })
    ).map((s) => [s.key, s.value]),
  );
export const settingsRoutes = Router();
settingsRoutes.use(admin);
settingsRoutes.get('/', async (_req, res) => res.json(await getSettings()));
settingsRoutes.put('/', async (req, res) => {
  const data = settingsSchema.parse(req.body);
  await db.$transaction(async (tx) => {
    const before = Object.fromEntries(
      (await tx.setting.findMany({ where: { key: { not: 'logo' } } })).map((s) => [s.key, s.value]),
    );
    for (const [key, value] of Object.entries(data))
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await log(tx, req.user.id, 'UPDATE', 'Setting', 0, { before, after: data });
  });
  res.json(await getSettings());
});
settingsRoutes.post(
  '/logo',
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } }).single('logo'),
  async (req, res) => {
    const file = req.file;
    assert(file, 422, 'LOGO', 'Choose a PNG, JPEG or WebP logo.');
    const b = file.buffer;
    const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    const webp = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    assert(png || jpeg || webp, 422, 'IMAGE_TYPE', 'Only PNG, JPEG and WebP images are supported.');
    const value = `data:image/${png ? 'png' : jpeg ? 'jpeg' : 'webp'};base64,${b.toString('base64')}`;
    await db.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: 'logo' }, create: { key: 'logo', value }, update: { value } });
      await log(tx, req.user.id, 'UPDATE', 'Setting', 0, { logoUpdated: true });
    });
    res.json({ logo: value });
  },
);
