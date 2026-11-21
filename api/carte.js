import { envoyer, utilisateur, lireCorps } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return envoyer(res, 405, { erreur: 'Méthode non permise' });
  const moi = await utilisateur(req);
  if (!moi) return envoyer(res, 401, { erreur: 'Session expirée. Reconnecte-toi.' });
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return envoyer(res, 500, { erreur: 'La clé ANTHROPIC_API_KEY n\'est pas configurée dans Vercel.' });

  const corps = await lireCorps(req);
  const images = Array.isArray(corps.images) ? corps.images.slice(0, 2) : [];
  const categories = Array.isArray(corps.categories) ? corps.categories.map(String).slice(0, 40) : [];
  if (!images.length) return envoyer(res, 400, { erreur: 'Aucune photo reçue.' });

  const consignes = `Tu lis la photo d'une carte d'affaires (Québec, souvent en français).
Retourne UNIQUEMENT un objet JSON valide, sans texte autour. Mets une chaîne vide quand l'information n'est pas sur la carte. N'invente rien.
{
  "nom": "prénom et nom de la personne",
  "entreprise": "nom de l'entreprise",
  "titre": "titre ou métier tel qu'écrit",
  "telephone": "téléphone du bureau",
  "cellulaire": "cellulaire si indiqué séparément",
  "courriel": "adresse courriel",
  "site": "site web",
  "adresse": "adresse complète sur une ligne",
  "categorie": "UNE seule valeur exacte parmi : ${categories.join(' | ')}",
  "notes": "services offerts ou mentions utiles sur la carte (licence RBQ, spécialités), en une ou deux phrases courtes"
}
Formate les numéros de téléphone ainsi : 819 555-1234. S'il n'y a qu'un numéro, mets-le dans "telephone".`;

  const contenu = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }));
  contenu.push({ type: 'text', text: 'Voici la carte d\'affaires. Extrais les coordonnées selon les consignes.' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1200,
      system: consignes,
      messages: [{ role: 'user', content: contenu }]
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return envoyer(res, 502, { erreur: 'Claude n\'a pas pu lire la carte : ' + ((j.error && j.error.message) || r.status) });
  const sortie = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  try {
    envoyer(res, 200, { donnees: JSON.parse(sortie.slice(sortie.indexOf('{'), sortie.lastIndexOf('}') + 1)) });
  } catch {
    envoyer(res, 502, { erreur: 'Réponse illisible.' });
  }
}
