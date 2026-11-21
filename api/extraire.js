import { envoyer, utilisateur, lireCorps } from './_lib.js';

const CONSIGNES = `Tu lis une fiche descriptive d'immeuble à revenus du Québec (Centris, RE/MAX, Royal LePage, etc.).
Retourne UNIQUEMENT un objet JSON valide, sans texte autour, avec ces clés. Mets null quand l'information n'est pas dans la fiche. N'invente rien.

{
  "nom": "adresse courte servant de nom, ex. « 683-697, 3e Rue de la Pointe »",
  "adresse": "adresse complète",
  "ville": "ville",
  "uls": "numéro ULS / Centris",
  "courtier": "nom du courtier et agence, avec téléphone si présent",
  "annee": nombre (année de construction),
  "prix_demande": nombre,
  "evaluation": nombre (évaluation municipale totale),
  "nb_logements": nombre,
  "superficie": nombre (superficie habitable totale du bâtiment en pieds carrés; convertis les m² en pi² en multipliant par 10,764),
  "logements": [ { "type": "4½", "loyer": nombre mensuel ou null, "bail": "échéance du bail si indiquée ou null" } ],
  "rba_fiche": nombre (revenus bruts annuels totaux indiqués),
  "autres_revenus": nombre annuel (stationnement, buanderie, etc., seulement s'ils sont séparés des loyers),
  "revenus_potentiels": true si la fiche dit que les revenus sont « potentiels », sinon false,
  "dep": {
    "taxes_mun": nombre, "taxes_scol": nombre, "assurances": nombre, "electricite": nombre,
    "chauffage": nombre, "deneigement": nombre, "pelouse": nombre, "entretien": nombre,
    "conciergerie": nombre, "gestion": nombre, "autres": nombre
  },
  "notes": "points utiles pour un investisseur, en phrases courtes : mode de chauffage et qui le paie, électricité, fondation, toiture, fenêtres, travaux récents, stationnements, inclusions, zonage. Maximum 8 lignes séparées par des retours de ligne."
}

Règles :
Tous les montants sont annuels en dollars, sans symbole. Les loyers des logements sont mensuels.
Ne remplis "logements" que si la fiche détaille les logements un par un (type ou loyer). Sinon, liste vide.
Un 5½ et 4 × 4½ donne cinq entrées. Utilise le caractère ½.
Taxes scolaires : celles de l'année la plus récente.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return envoyer(res, 405, { erreur: 'Méthode non permise' });
  const moi = await utilisateur(req);
  if (!moi) return envoyer(res, 401, { erreur: 'Session expirée. Reconnecte-toi.' });
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return envoyer(res, 500, { erreur: 'La clé ANTHROPIC_API_KEY n\'est pas configurée dans Vercel.' });

  const corps = await lireCorps(req);
  const texte = String(corps.texte || '').slice(0, 60000);
  const images = Array.isArray(corps.images) ? corps.images.slice(0, 4) : [];
  if (!texte.trim() && !images.length) return envoyer(res, 400, { erreur: 'La fiche est vide ou illisible.' });

  const contenu = [];
  for (const img of images) contenu.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
  contenu.push({ type: 'text', text: (texte ? `Texte de la fiche :\n\n${texte}\n\n` : '') + 'Extrais les données selon les consignes.' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 4000,
      system: CONSIGNES,
      messages: [{ role: 'user', content: contenu }]
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return envoyer(res, 502, { erreur: 'Claude n\'a pas pu lire la fiche : ' + ((j.error && j.error.message) || r.status) });

  const sortie = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const debut = sortie.indexOf('{'), fin = sortie.lastIndexOf('}');
  try {
    const donnees = JSON.parse(sortie.slice(debut, fin + 1));
    envoyer(res, 200, { donnees });
  } catch {
    envoyer(res, 502, { erreur: 'Réponse illisible. Réessaie ou entre les chiffres à la main.' });
  }
}
