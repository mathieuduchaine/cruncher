// Cruncher : moteur de calcul. Aucune dépendance, aucun accès réseau.

export const REGLAGES_DEFAUT = {
  hyp: {
    inoccupation: 3,          // % des revenus bruts
    gestion_pct: 8,           // % des revenus effectifs
    entretien_porte: 610,     // $ par logement par an
    reserve_porte: 0,         // $ par logement par an
    conciergerie_porte: 250,  // $ par logement par an
    conciergerie_seuil: 12,   // appliquée à partir de ce nombre de logements
    frais_divers_pct: 1,      // notaire, inspection, évaluation, Phase 1, frais SCHL (% du prix)
    appreciation: 2,          // % par an
    hausse_loyers: 2.5,       // % par an
    hausse_depenses: 2.5      // % par an
  },
  fin: {
    conv: { taux: 4.75, amort: 25, ltv: 75, rcd: 1.2, prime: 0 },
    schl: { taux: 4.0, amort: 40, ltv: 85, rcd: 1.3, prime: 4.0 },
    aph:  { taux: 4.0, amort: 50, ltv: 95, rcd: 1.1, prime: 3.0 }
  },
  dmi: [ // droits de mutation (taxe de bienvenue), tranches 2026
    { jusqua: 62900, taux: 0.5 },
    { jusqua: 315000, taux: 1.0 },
    { jusqua: 500000, taux: 1.5 },
    { jusqua: null, taux: 1.5 }   // certaines villes appliquent jusqu'à 3 % ici
  ],
  cibles: { tga_a: 6.0, tga_b: 6.5 },
  seuils: { tga_bon: 6.5, tga_ok: 5.5, mrb_bon: 10, mrb_ok: 12, cf_bon: 100, cf_ok: 50 },
  scenario_projection: 'schl'
};

export const SCENARIOS = [
  { cle: 'conv', nom: 'Conventionnel' },
  { cle: 'schl', nom: 'SCHL standard' },
  { cle: 'aph', nom: 'APH Select' }
];

export const POSTES_DEPENSES = [
  { cle: 'taxes_mun', nom: 'Taxes municipales' },
  { cle: 'taxes_scol', nom: 'Taxes scolaires' },
  { cle: 'assurances', nom: 'Assurances' },
  { cle: 'electricite', nom: 'Électricité' },
  { cle: 'chauffage', nom: 'Chauffage' },
  { cle: 'deneigement', nom: 'Déneigement' },
  { cle: 'pelouse', nom: 'Pelouse' },
  { cle: 'entretien', nom: 'Entretien et réparations' },
  { cle: 'conciergerie', nom: 'Conciergerie' },
  { cle: 'gestion', nom: 'Gestion' },
  { cle: 'autres', nom: 'Autres dépenses' }
];

export const STATUTS = ['À analyser', 'En analyse', 'Visité', 'Offre déposée', 'Refusé', 'Abandonné', 'Acheté'];

export function nb(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v).replace(/[\s  $%]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function vide(v) { return v === null || v === undefined || v === ''; }

// Fusionne les réglages du compte avec les valeurs propres à l'immeuble (vides = défaut).
export function fusionner(defaut, propre) {
  const out = {};
  for (const k of Object.keys(defaut)) {
    const d = defaut[k];
    const p = propre ? propre[k] : undefined;
    if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = fusionner(d, p || {});
    else out[k] = vide(p) ? d : nb(p);
  }
  return out;
}

export function reglagesComplets(reglages) {
  const r = reglages || {};
  return {
    hyp: fusionner(REGLAGES_DEFAUT.hyp, r.hyp),
    fin: fusionner(REGLAGES_DEFAUT.fin, r.fin),
    dmi: Array.isArray(r.dmi) && r.dmi.length ? r.dmi : REGLAGES_DEFAUT.dmi,
    cibles: fusionner(REGLAGES_DEFAUT.cibles, r.cibles),
    seuils: fusionner(REGLAGES_DEFAUT.seuils, r.seuils),
    scenario_projection: r.scenario_projection || REGLAGES_DEFAUT.scenario_projection
  };
}

// Taux périodique mensuel, intérêt composé semestriellement (norme canadienne).
function tauxMensuel(tauxAnnuelPct) {
  const r = tauxAnnuelPct / 100;
  return Math.pow(1 + r / 2, 1 / 6) - 1;
}

export function paiementMensuel(capital, tauxPct, ans) {
  if (capital <= 0 || ans <= 0) return 0;
  const i = tauxMensuel(tauxPct), n = ans * 12;
  if (i === 0) return capital / n;
  return capital * i / (1 - Math.pow(1 + i, -n));
}

export function capitalPourPaiement(paiement, tauxPct, ans) {
  if (paiement <= 0 || ans <= 0) return 0;
  const i = tauxMensuel(tauxPct), n = ans * 12;
  if (i === 0) return paiement * n;
  return paiement * (1 - Math.pow(1 + i, -n)) / i;
}

export function soldeApres(capital, tauxPct, ans, mois) {
  if (capital <= 0) return 0;
  const i = tauxMensuel(tauxPct);
  const p = paiementMensuel(capital, tauxPct, ans);
  if (i === 0) return Math.max(0, capital - p * mois);
  const f = Math.pow(1 + i, mois);
  return Math.max(0, capital * f - p * (f - 1) / i);
}

export function droitsMutation(base, tranches) {
  let total = 0, bas = 0;
  for (const t of tranches) {
    const haut = vide(t.jusqua) ? Infinity : nb(t.jusqua);
    if (base > bas) total += (Math.min(base, haut) - bas) * nb(t.taux) / 100;
    bas = haut;
    if (base <= haut) break;
  }
  return total;
}

function revenusDe(d, utiliserMarche) {
  const logs = Array.isArray(d.logements) ? d.logements : [];
  const avecLoyer = logs.filter(l => nb(l.loyer) > 0 || (utiliserMarche && nb(l.loyer_marche) > 0));
  let loyers;
  if (avecLoyer.length) {
    loyers = logs.reduce((s, l) => {
      const m = utiliserMarche && nb(l.loyer_marche) > 0 ? nb(l.loyer_marche) : nb(l.loyer);
      return s + m * 12;
    }, 0);
  } else {
    loyers = nb(d.rba_fiche);
  }
  return loyers + nb(d.autres_revenus);
}

function exploitation(d, H, rbaOverride) {
  const n = nombreLogements(d);
  const rba = rbaOverride !== undefined ? rbaOverride : revenusDe(d, false);
  const inoccupation = rba * H.inoccupation / 100;
  const effectif = rba - inoccupation;
  const dep = d.dep || {};
  const lignes = [{ cle: 'inoccupation', nom: `Inoccupation et mauvaises créances (${fmtPct(H.inoccupation)})`, reel: 0, norm: inoccupation, ajuste: true }];
  for (const p of POSTES_DEPENSES) {
    const reel = nb(dep[p.cle]);
    let norm = reel, note = '';
    if (p.cle === 'entretien') { const m = n * H.entretien_porte; if (m > reel) { norm = m; note = `${H.entretien_porte} $/porte`; } }
    if (p.cle === 'conciergerie' && n >= H.conciergerie_seuil) { const m = n * H.conciergerie_porte; if (m > reel) { norm = m; note = `${H.conciergerie_porte} $/porte`; } }
    if (p.cle === 'gestion') { const m = effectif * H.gestion_pct / 100; if (m > reel) { norm = m; note = `${fmtPct(H.gestion_pct)} des revenus`; } }
    lignes.push({ cle: p.cle, nom: p.nom, reel, norm, note, ajuste: norm !== reel });
  }
  if (H.reserve_porte > 0) lignes.push({ cle: 'reserve', nom: 'Réserve de remplacement', reel: 0, norm: n * H.reserve_porte, note: `${H.reserve_porte} $/porte`, ajuste: true });
  const depReelles = lignes.filter(l => l.cle !== 'inoccupation').reduce((s, l) => s + l.reel, 0);
  const depNorm = lignes.filter(l => l.cle !== 'inoccupation').reduce((s, l) => s + l.norm, 0);
  return { rba, inoccupation, effectif, lignes, depReelles, depNorm, rne: effectif - depNorm };
}

export function nombreLogements(d) {
  const logs = Array.isArray(d.logements) ? d.logements.length : 0;
  return logs || Math.round(nb(d.nb_logements));
}

function fmtPct(v) { return String(Math.round(v * 100) / 100).replace('.', ',') + ' %'; }

function financer(rne, prix, f) {
  // Le RCD s'applique au prêt total, prime SCHL incluse.
  const parRcd = capitalPourPaiement(rne / f.rcd / 12, f.taux, f.amort) / (1 + f.prime / 100);
  const parLtv = prix * f.ltv / 100;
  const pret = Math.max(0, Math.min(parRcd, parLtv));
  const limite = parRcd < parLtv ? 'RCD' : 'Ratio prêt-valeur';
  const prime = pret * f.prime / 100;
  const pretTotal = pret + prime;
  const pm = paiementMensuel(pretTotal, f.taux, f.amort);
  const service = pm * 12;
  const mise = prix - pret;
  const liquidites = rne - service;
  const capitalisation = pretTotal - soldeApres(pretTotal, f.taux, f.amort, 12);
  return { ...f, parRcd, parLtv, pret, limite, prime, pretTotal, paiementMensuel: pm, service, mise, misePct: prix ? mise / prix * 100 : 0, liquidites, rcdReel: service ? rne / service : 0, capitalisation };
}

export function analyser(imm, reglages) {
  const R = reglagesComplets(reglages);
  const d = imm || {};
  const H = fusionner(R.hyp, d.hyp);
  const F = {};
  for (const s of SCENARIOS) F[s.cle] = fusionner(R.fin[s.cle], d.fin && d.fin[s.cle]);
  const n = nombreLogements(d);
  const prixDemande = nb(d.prix_demande);
  const prix = nb(d.prix_offre) || prixDemande;
  const ex = exploitation(d, H);
  const tga = prix ? ex.rne / prix * 100 : 0;
  const mrb = ex.rba ? prix / ex.rba : 0;
  const mrn = ex.rne ? prix / ex.rne : 0;
  const prixPorte = n ? prix / n : 0;
  const ratioDep = ex.rba ? (ex.depNorm + ex.inoccupation) / ex.rba * 100 : 0;
  const evaluation = nb(d.evaluation);
  const dmi = droitsMutation(prix, R.dmi);
  const fraisDivers = vide(d.frais_divers) ? prix * H.frais_divers_pct / 100 : nb(d.frais_divers);
  const travaux = nb(d.travaux);
  const appreciation1 = prix * H.appreciation / 100;

  const fin = {};
  for (const s of SCENARIOS) {
    const r = financer(ex.rne, prix, F[s.cle]);
    r.nom = s.nom;
    r.cash = r.mise + dmi + fraisDivers + travaux;
    r.cfPorteMois = n ? r.liquidites / n / 12 : 0;
    r.rendLiquidites = r.cash > 0 ? r.liquidites / r.cash * 100 : 0;
    r.rendTotal = r.cash > 0 ? (r.liquidites + r.capitalisation + appreciation1) / r.cash * 100 : 0;
    fin[s.cle] = r;
  }

  // Prix suggérés selon les TGA cibles
  const prixCible = t => t > 0 ? ex.rne / (t / 100) : 0;
  // Loyer moyen requis pour que le prix analysé atteigne le TGA cible A
  const rneRequis = prix * R.cibles.tga_a / 100;
  const garde = (1 - H.inoccupation / 100) * (1 - H.gestion_pct / 100);
  const depSansGestion = ex.depNorm - (ex.lignes.find(l => l.cle === 'gestion') || { norm: 0 }).norm;
  const rbaRequis = garde > 0 ? (rneRequis + depSansGestion - nb(d.autres_revenus) * garde) / garde : 0;
  const loyerMoyenActuel = n ? (ex.rba - nb(d.autres_revenus)) / n / 12 : 0;
  const loyerMoyenRequis = n ? rbaRequis / n / 12 : 0;

  // Potentiel au loyer du marché
  let potentiel = null;
  const logs = Array.isArray(d.logements) ? d.logements : [];
  if (logs.some(l => nb(l.loyer_marche) > 0)) {
    const exM = exploitation(d, H, revenusDe(d, true));
    potentiel = {
      rba: exM.rba, rne: exM.rne,
      tga: prix ? exM.rne / prix * 100 : 0,
      valeurA: prixCible(R.cibles.tga_a), valeurB: 0,
      gainAnnuel: exM.rba - ex.rba
    };
    potentiel.valeurA = R.cibles.tga_a ? exM.rne / (R.cibles.tga_a / 100) : 0;
    potentiel.valeurB = R.cibles.tga_b ? exM.rne / (R.cibles.tga_b / 100) : 0;
  }

  // Projection sur 10 ans selon le scénario choisi
  const sc = fin[R.scenario_projection] || fin.schl;
  const projection = [];
  let cumul = 0;
  for (let a = 1; a <= 10; a++) {
    const fr = Math.pow(1 + H.hausse_loyers / 100, a - 1);
    const fd = Math.pow(1 + H.hausse_depenses / 100, a - 1);
    const eff = ex.effectif * fr;
    const gestion = (ex.lignes.find(l => l.cle === 'gestion') || { norm: 0 }).norm * fr;
    const rne = eff - (depSansGestion * fd + gestion);
    const cf = rne - sc.service;
    cumul += cf;
    const valeur = prix * Math.pow(1 + H.appreciation / 100, a);
    const solde = soldeApres(sc.pretTotal, sc.taux, sc.amort, a * 12);
    projection.push({ annee: a, rne, liquidites: cf, cumul, valeur, solde, equite: valeur - solde });
  }

  const S = R.seuils;
  const cote = {
    tga: tga >= S.tga_bon ? 'bon' : tga >= S.tga_ok ? 'moyen' : 'faible',
    mrb: !mrb ? 'moyen' : mrb <= S.mrb_bon ? 'bon' : mrb <= S.mrb_ok ? 'moyen' : 'faible',
    cf: fin.schl.cfPorteMois >= S.cf_bon ? 'bon' : fin.schl.cfPorteMois >= S.cf_ok ? 'moyen' : 'faible'
  };

  const alertes = [];
  if (!prix) alertes.push('Aucun prix entré.');
  if (!n) alertes.push('Nombre de logements inconnu.');
  if (!ex.rba) alertes.push('Aucun revenu entré.');
  if (!nb((d.dep || {}).assurances)) alertes.push('Assurances manquantes : demande le montant réel au courtier.');
  if (!nb((d.dep || {}).taxes_mun)) alertes.push('Taxes municipales manquantes.');
  if (d.revenus_potentiels) alertes.push('Les revenus de la fiche sont « potentiels » : exige les baux réels.');
  if (ex.depReelles && ex.rba && ex.depReelles / ex.rba < 0.2) alertes.push('Les dépenses de la fiche semblent trop basses : elles ont été normalisées.');

  return {
    n, prix, prixDemande, evaluation, prixEval: evaluation ? prix / evaluation : 0,
    H, F, R, ex, rba: ex.rba, rne: ex.rne, tga, mrb, mrn, prixPorte, ratioDep,
    dmi, fraisDivers, travaux, fin,
    cibles: { a: R.cibles.tga_a, b: R.cibles.tga_b, prixA: prixCible(R.cibles.tga_a), prixB: prixCible(R.cibles.tga_b) },
    loyerMoyenActuel, loyerMoyenRequis, potentiel, projection, scenarioProjection: sc.nom,
    cote, alertes, verdict: verdict(tga, prix, prixCible(R.cibles.tga_a), prixCible(R.cibles.tga_b), cote, R)
  };
}

function verdict(tga, prix, pA, pB, cote, R) {
  if (!prix || !tga) return 'Entre le prix, les revenus et les dépenses pour obtenir une analyse.';
  const m = v => Math.round(v / 5000) * 5000;
  const f = v => m(v).toLocaleString('fr-CA').replace(/[  ]/g, ' ') + ' $';
  if (tga >= R.seuils.tga_bon) return `Rendement solide au prix analysé. Vérifie les baux et l'état du bâtiment avant d'aller plus loin.`;
  if (tga >= R.seuils.tga_ok) return `Rendement acceptable, sans plus. Une offre entre ${f(pB)} et ${f(pA)} viserait un TGA de ${String(R.cibles.tga_b).replace('.', ',')} à ${String(R.cibles.tga_a).replace('.', ',')} %.`;
  return `Trop cher pour ce qu'il rapporte aujourd'hui. Au TGA cible, il vaut environ ${f(pB)} à ${f(pA)}.`;
}
