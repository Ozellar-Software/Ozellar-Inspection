import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust environment loader: checks cwd, backend subdirectory, monorepo parent, and known VM path
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend', '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '.env'),
  '/opt/Ozellar-Inspection/backend/.env',
  '/opt/Ozellar-Inspection/.env',
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
      console.log(`[Env] Loaded environment configuration from: ${envPath}`);
      break;
    } catch {
      // Keep checking other candidate paths
    }
  }
}

// Ensure instant, clean termination on systemd stop or restart (avoids 90s timeout delay)
process.on('SIGTERM', () => {
  console.log('[Process] SIGTERM received. Terminating backend cleanly...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[Process] SIGINT received. Terminating backend cleanly...');
  process.exit(0);
});

// Entry point: importing each module registers its HTTP routes with the Functions host.
import './functions/auth.js';
import './functions/me.js';
import './functions/users.js';
import './functions/vessels.js';
import './functions/templates.js';
import './functions/approvals.js';
import './functions/photos.js';
import './functions/sync.js';
import './functions/notifications.js';
