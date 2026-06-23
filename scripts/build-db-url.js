// Builds a Postgres connection URL from PG* env vars and prints it.
// Lets the Prisma CLI (migrate/studio) work from credentials only — no
// DATABASE_URL env. Used by the prisma:* npm scripts.
const {
  PGUSER,
  PGPASSWORD,
  PGHOST,
  PGPORT = '5432',
  PGDATABASE,
  PGSSLMODE = 'prefer',
} = process.env;

if (!PGUSER || !PGPASSWORD || !PGHOST || !PGDATABASE) {
  // eslint-disable-next-line no-console
  console.error('Missing PG* env vars (need PGUSER, PGPASSWORD, PGHOST, PGDATABASE).');
  process.exit(1);
}

const pass = encodeURIComponent(PGPASSWORD);
process.stdout.write(
  `postgresql://${PGUSER}:${pass}@${PGHOST}:${PGPORT}/${PGDATABASE}?sslmode=${PGSSLMODE}`,
);
