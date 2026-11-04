# IHZ ERP backend

Express and Prisma API for Islamabad Health Zone, using PostgreSQL (including Neon).
This repository includes its validation schemas and seed logo and runs independently
of the frontend repository. Use Node.js 22.

## Local development

Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
The original project layout with an environment file at `../.env` is also supported;
values from that file take precedence over this folder's `.env`.

```sh
npm ci
npm run db:generate
npm run db:deploy
npm run dev
```

The API listens on port 3001 by default. `GET /health` checks the HTTP server;
`GET /api/branding` also queries the database.

For a new empty database, set `SEED_ADMIN_PASSWORD` and `SEED_STAFF_PASSWORD`
to passwords of at least 12 characters, then run:

```sh
NODE_ENV=production npm run db:seed
```

This creates default settings, services, and `admin` / `staff` accounts without
development sample records. Existing passwords and records are preserved.
Running the seed in development also adds sample patients, nurses, bills, and payments.
The existing Neon database already contains the migrated local records.

## Build and deploy

Configure `DATABASE_URL`, `JWT_SECRET`, `CLIENT_URL` (the frontend origin), and
`NODE_ENV=production` in the hosting provider. Set `PORT` if the host requires it.
Environment files and credentials are excluded from Git and Docker build contexts.

Set `CLIENT_URL=*` to allow any HTTP(S) frontend origin, or use a single URL to
limit access to that origin. CORS reflects allowed origins so cookie credentials
work. Production session cookies use `SameSite=None; Secure` for cross-site
requests; development cookies keep `SameSite=Lax` for local HTTP.
Frontends must send `credentials: 'include'` (or Axios `withCredentials: true`)
and `X-Requested-With: HomeNursing` on POST, PUT, PATCH, and DELETE requests.
Browser restrictions on third-party cookies can still affect cross-site sessions.

```sh
npm ci --include=dev
npm run db:generate
npm run build
npm run db:deploy
npm start
```

Keep `src/templates` with the deployment for bill and receipt rendering. PDF generation
requires Chromium: npm normally downloads Puppeteer's browser, or set
`PUPPETEER_EXECUTABLE_PATH` to an installed browser. The Dockerfile includes Chromium
and builds the backend from this repository alone. Pass runtime environment variables
to the container; it runs migrations and starts the server without seeding records.

## Verification

```sh
npm test
npm run build
```

`npm run test:api` runs the database integration suite using a temporary PostgreSQL
schema and removes that schema afterward. Run it against a dedicated test database.
