// Outils partagés des fonctions serveur (Vercel, Node ESM). Aucune dépendance npm.

export const URL_SB = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
export const CLE_PUBLIQUE = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const CLE_SECRETE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Les nouvelles clés (sb_secret_...) vont seulement dans l'en-tête apikey.
// Les anciennes clés JWT (service_role) vont aussi dans Authorization.
export function entetesAdmin(extra = {}) {
  const h = { apikey: CLE_SECRETE, 'Content-Type': 'application/json', ...extra };
  if (!CLE_SECRETE.startsWith('sb_')) h.Authorization = `Bearer ${CLE_SECRETE}`;
  return h;
}

export function configManquante() {
  const manque = [];
  if (!URL_SB) manque.push('SUPABASE_URL');
  if (!CLE_PUBLIQUE) manque.push('SUPABASE_PUBLISHABLE_KEY');
  if (!CLE_SECRETE) manque.push('SUPABASE_SECRET_KEY');
  return manque;
}

export function envoyer(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

// Vérifie le jeton de l'utilisateur et retourne { id, email, profil } ou null.
export async function utilisateur(req) {
  const auth = req.headers.authorization || '';
  const jeton = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jeton) return null;
  const r = await fetch(`${URL_SB}/auth/v1/user`, { headers: { apikey: CLE_PUBLIQUE, Authorization: `Bearer ${jeton}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const p = await fetch(`${URL_SB}/rest/v1/cr_profils?id=eq.${u.id}&select=*`, { headers: entetesAdmin() });
  const lignes = p.ok ? await p.json() : [];
  if (!lignes.length) return null;
  return { id: u.id, email: u.email, profil: lignes[0] };
}

export async function lireCorps(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  try { return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}'); } catch { return {}; }
}
