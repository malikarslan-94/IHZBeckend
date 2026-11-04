import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { isAllowedOrigin } from './config/origins.js';
import { auth, csrf } from './middleware/auth.js';
import { office } from './middleware/requireRole.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { patientRoutes } from './modules/patients/routes.js';
import { nurseRoutes } from './modules/nurses/routes.js';
import { serviceRoutes } from './modules/services/routes.js';
import { requestRoutes } from './modules/requests/routes.js';
import { billRoutes } from './modules/bills/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { settingsRoutes, getSettings, getBranding } from './modules/settings/routes.js';
import { activityRoutes } from './modules/activity/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
export const app = express();
app.disable('x-powered-by');
app.use(
  helmet(),
  cors({
    origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)),
    credentials: true,
  }),
  express.json({ limit: '1mb' }),
  cookieParser(),
  csrf,
);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/branding', async (_req, res) => res.json(await getBranding()));
app.use('/api/auth', authRoutes);
app.use('/api', auth);
app.get('/api/preferences', office, async (_req, res) => res.json(await getSettings()));
app.use('/api/users', userRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/nurses', nurseRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/bills', billRoutes);
app.use('/api', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }));
app.use(errorHandler);
