import { URL_SB, entetesAdmin, envoyer, utilisateur, lireCorps } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return envoyer(res, 405, { erreur: 'Méthode non permise' });
  const moi = await utilisateur(req);
  if (!moi) return envoyer(res, 401, { erreur: 'Session expirée. Reconnecte-toi.' });
  if (!moi.profil.est_admin) return envoyer(res, 403, { erreur: 'Réservé à l\'administrateur.' });

  const corps = await lireCorps(req);
  if (corps.action !== 'inviter') return envoyer(res, 400, { erreur: 'Action inconnue' });

  const courriel = String(corps.courriel || '').trim().toLowerCase();
  const nom = String(corps.nom || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(courriel)) return envoyer(res, 400, { erreur: 'Courriel invalide.' });
  const origine = corps.origine || `https://${req.headers.host}`;

  let id = null, existant = false;
  const inv = await fetch(`${URL_SB}/auth/v1/invite?redirect_to=${encodeURIComponent(origine)}`, {
    method: 'POST', headers: entetesAdmin(), body: JSON.stringify({ email: courriel, data: { nom } })
  });
  const invJson = await inv.json().catch(() => ({}));
  if (inv.ok) {
    id = invJson.id || (invJson.user && invJson.user.id);
  } else {
    // Le compte existe peut-être déjà dans ce projet Supabase : on lui donne simplement accès.
    const r = await fetch(`${URL_SB}/rest/v1/rpc/cr_id_par_courriel`, {
      method: 'POST', headers: entetesAdmin(), body: JSON.stringify({ p_courriel: courriel })
    });
    const trouve = r.ok ? await r.json() : null;
    if (!trouve) {
      const msg = invJson.msg || invJson.message || invJson.error_description || 'Invitation refusée par Supabase.';
      return envoyer(res, 400, { erreur: msg });
    }
    id = trouve; existant = true;
  }

  const up = await fetch(`${URL_SB}/rest/v1/cr_profils`, {
    method: 'POST',
    headers: entetesAdmin({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({ id, courriel, nom: nom || courriel.split('@')[0] })
  });
  if (!up.ok) return envoyer(res, 500, { erreur: 'Profil non créé : ' + (await up.text()) });
  envoyer(res, 200, { ok: true, existant });
}
