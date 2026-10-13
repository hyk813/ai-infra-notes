import type { APIRoute } from 'astro';
import { siteVersion } from '../config';

export const GET: APIRoute = () => new Response(JSON.stringify({ version: siteVersion }), {
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
