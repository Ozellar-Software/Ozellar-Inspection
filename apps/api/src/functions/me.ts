import { app } from '@azure/functions';
import { requireUser } from '../lib/auth.js';
import { handler } from '../lib/http.js';

export const meHandler = handler(async (req) => requireUser(req));
app.http('me', {
  route: 'me',
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous', // auth is done in code (Entra JWT)
  handler: meHandler,
});
