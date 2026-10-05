// Load environment variables from .env file if available
try {
  process.loadEnvFile();
} catch {
  // No .env file or already provided by environment
}

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
