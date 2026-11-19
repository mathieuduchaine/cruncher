import { URL_SB, CLE_PUBLIQUE, envoyer, configManquante } from './_lib.js';

export default async function handler(req, res) {
  const manque = configManquante();
  if (!process.env.ANTHROPIC_API_KEY) manque.push('ANTHROPIC_API_KEY (import de fiches seulement)');
  envoyer(res, 200, { url: URL_SB, cle: CLE_PUBLIQUE, manque });
}
