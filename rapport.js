// Rapport PDF d'analyse (jsPDF + autotable, chargés dans index.html)
import { SCENARIOS } from './calc.js';

const p = s => String(s ?? '').replace(/[  ]/g, ' ').replace(/[↑↓✓✕▲]/g, '');
const $ = (v, dec = 0) => isFinite(v) ? p(Number(v).toLocaleString('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) + ' $' : '-';
const pc = (v, dec = 2) => isFinite(v) && v ? p(Number(v).toLocaleString('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) + ' %' : '-';
const nm = (v, dec = 2) => isFinite(v) && v ? p(Number(v).toLocaleString('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) : '-';

const ENCRE = [1, 29, 69], DOUX = [104, 116, 138], OR = [184, 140, 74], OR_CLAIR = [241, 212, 145], FOND = [243, 241, 235];
const COTE = { bon: [46, 125, 82], moyen: [176, 128, 44], faible: [178, 64, 50] };

export function genererRapport(imm, a, profil, logo) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('Bibliothèque PDF non chargée. Vérifie ta connexion.');
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  const d = imm.donnees || {};
  const L = doc.internal.pageSize.getWidth(), M = 40;
  let y = 0;

  // En-tête aux couleurs de Gestion Clevor
  doc.setFillColor(...ENCRE); doc.rect(0, 0, L, 74, 'F');
  doc.setFillColor(...OR_CLAIR); doc.rect(0, 74, L, 2, 'F');
  if (logo) {
    try { const pr = doc.getImageProperties(logo); const h = 50; doc.addImage(logo, 'JPEG', M - 10, 12, h * pr.width / pr.height, h); }
    catch { doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('GESTION CLEVOR', M, 44); }
  } else { doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('GESTION CLEVOR', M, 44); }
  doc.setTextColor(...OR_CLAIR); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text('CRUNCHER  ·  ANALYSE D\'IMMEUBLE À REVENUS', L - M, 32, { align: 'right' });
  doc.setTextColor(205, 214, 230); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(p(`Préparé par ${profil.nom || profil.courriel} le ${new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' })}`), L - M, 47, { align: 'right' });

  doc.setTextColor(...ENCRE); doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
  doc.text(p(d.nom || imm.nom || 'Immeuble'), M, 106, { maxWidth: L - 2 * M });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DOUX);
  const sous = [d.adresse, d.adresse && d.ville && String(d.adresse).includes(d.ville) ? '' : d.ville, d.annee ? `construit en ${d.annee}` : '', d.uls ? `ULS ${d.uls}` : ''].filter(Boolean).join('  ·  ');
  doc.text(p(sous), M, 122, { maxWidth: L - 2 * M });
  y = 138;

  // Indicateurs
  const P = a.principal;
  const rangees = [[
    ['Prix analysé', $(a.prix), `${a.n || '-'} logements · ${$(a.prixPorte)}/porte`, null],
    ['RNE', $(a.rne), `${$(a.rnePorte)} par porte`, null],
    ['TGA', pc(a.tga), 'taux global', a.cote.tga],
    ['MRB', nm(a.mrb), `MRN ${nm(a.mrn)}`, a.cote.mrb]
  ], [
    ['RCD ' + P.nom, a.rne ? (P.passe ? 'Passe' : 'Ne passe pas') : '-', `${nm(P.rcdAuMax)} à ${pc(P.ltv, 0)} · exigé ${nm(P.rcd)}`, a.cote.rcd],
    ['Cash flow net', $(P.cfMois) + '/mois', `${$(P.cfPorteMois)} par porte par mois`, P.cfMois < 0 ? 'faible' : a.cote.cf],
    ['Argent requis', $(P.cash), `mise de ${pc(P.misePct, 1)} + frais`, null],
    ['TRI sur 10 ans', P.tri === null ? '-' : pc(P.tri, 1), `occupation min. ${pc(P.pointMort, 1)}`, null]
  ]];
  const lk = (L - 2 * M - 3 * 8) / 4;
  for (const rangee of rangees) {
    rangee.forEach(([t, v, s2, c], k) => {
      const x = M + k * (lk + 8);
      doc.setFillColor(...FOND); doc.roundedRect(x, y, lk, 54, 4, 4, 'F');
      if (c) { doc.setFillColor(...COTE[c]); doc.rect(x, y + 6, 2.5, 42, 'F'); }
      doc.setTextColor(...DOUX); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.text(p(t).toUpperCase(), x + 9, y + 14);
      doc.setTextColor(...(c ? COTE[c] : ENCRE)); doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(p(v), x + 9, y + 32);
      doc.setTextColor(...DOUX); doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.text(p(s2), x + 9, y + 45, { maxWidth: lk - 12 });
    });
    y += 62;
  }
  y += 10;

  // Verdict
  doc.setTextColor(...ENCRE); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  const lv = doc.splitTextToSize(p(a.verdict), L - 2 * M);
  doc.text(lv, M, y); y += lv.length * 13 + 4;
  if (a.alertes.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...COTE.faible);
    a.alertes.forEach(t => { const l = doc.splitTextToSize('• ' + p(t), L - 2 * M); doc.text(l, M, y); y += l.length * 11; });
    y += 4;
  }

  const style = {
    theme: 'plain', margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 3.2, bottom: 3.2, left: 5, right: 5 }, textColor: ENCRE, lineColor: [225, 222, 215], lineWidth: { bottom: 0.4 } },
    headStyles: { fillColor: ENCRE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.section !== 'head') return;
      const cs = ((data.table.styles && data.table.styles.columnStyles) || {})[data.column.index];
      if (cs && cs.halign) data.cell.styles.halign = cs.halign;
    }
  };
  const titre = (t) => {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
    doc.setTextColor(...OR); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(p(t).toUpperCase(), M, y); y += 8;
  };
  const apres = () => { y = doc.lastAutoTable.finalY + 22; };
  const gras = { fontStyle: 'bold' };

  // Revenus et dépenses
  titre('Revenus et dépenses');
  const lignes = a.ex.lignes.filter(l => l.cle !== 'inoccupation' && (l.reel || l.norm));
  const inocc = a.ex.lignes.find(l => l.cle === 'inoccupation');
  doc.autoTable({
    ...style, startY: y,
    head: [['Poste', 'Fiche', 'Normalisé', 'Note']],
    body: [
      [{ content: 'Revenus bruts annuels', styles: gras }, '', { content: $(a.rba), styles: gras }, d.revenus_potentiels ? 'revenus potentiels' : ''],
      [p(inocc.nom), '', '- ' + $(inocc.norm), ''],
      ...lignes.map(l => [p(l.nom), l.reel ? $(l.reel) : '-', $(l.norm), p(l.note || '')]),
      [{ content: 'Total des dépenses', styles: gras }, { content: $(a.ex.depReelles), styles: gras }, { content: $(a.ex.depNorm), styles: gras }, `ratio ${pc(a.ratioDep, 1)}`],
      [{ content: 'Revenu net d\'exploitation (RNE)', styles: { ...gras, textColor: OR } }, '', { content: $(a.rne), styles: { ...gras, textColor: OR } }, '']
    ],
    columnStyles: { 0: { cellWidth: 230 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'left', textColor: DOUX, fontSize: 7.5 } }
  });
  apres();

  // Logements
  const logs = (d.logements || []).filter(l => l.type || l.loyer);
  if (logs.length) {
    titre('Logements');
    doc.autoTable({
      ...style, startY: y,
      head: [['Type', 'Loyer actuel', 'Loyer du marché', 'Fin du bail', 'Note']],
      body: logs.map(l => [p(l.type), l.loyer ? $(l.loyer) : '-', l.loyer_marche ? $(l.loyer_marche) : '-', p(l.bail || ''), p(l.note || '')]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'left' }, 4: { halign: 'left' } }
    });
    apres();
  }

  // Financement
  titre('Financement');
  const F = SCENARIOS.map(s => a.fin[s.cle]);
  const r = (nom, f, opt) => [opt ? { content: nom, styles: opt } : nom, ...F.map(x => opt ? { content: f(x), styles: opt } : f(x))];
  doc.autoTable({
    ...style, startY: y,
    head: [['', ...SCENARIOS.map(s => s.nom)]],
    body: [
      r('Au prêt maximal', x => x.passe ? `Passe (RCD ${nm(x.rcdAuMax)})` : `Ne passe pas (RCD ${nm(x.rcdAuMax)})`, gras),
      r('Taux, amortissement', x => `${pc(x.taux)} · ${x.amort} ans`),
      r('RCD exigé, prêt max', x => `${nm(x.rcd)} · ${pc(x.ltv, 0)}`),
      r('Prêt', x => $(x.pret)),
      r('Limité par', x => p(x.limite)),
      r('Prime SCHL ajoutée', x => x.prime ? $(x.prime) : '-'),
      r('Paiement mensuel', x => $(x.paiementMensuel)),
      r('Mise de fonds', x => `${$(x.mise)} (${pc(x.misePct, 1)})`),
      r('dont mise en plus (RCD)', x => x.miseSupplementaire > 0 ? $(x.miseSupplementaire) : '-'),
      r('Taxe de bienvenue', () => $(a.dmi)),
      r('Frais divers et travaux', () => $(a.fraisDivers + a.travaux)),
      r('Argent requis', x => $(x.cash), gras),
      r('Cash flow net mensuel', x => $(x.cfMois), gras),
      r('Cash flow net annuel', x => $(x.liquidites)),
      r('Par porte par mois', x => $(x.cfPorteMois)),
      r('RCD réel', x => nm(x.rcdReel)),
      r('Rendement sur liquidités', x => pc(x.rendLiquidites, 1)),
      r('Capitalisation an 1', x => $(x.capitalisation)),
      r('Occupation minimale (point mort)', x => pc(x.pointMort, 1)),
      r('Rendement total an 1', x => pc(x.rendTotal, 1)),
      r('TRI sur 10 ans', x => x.tri === null ? '-' : pc(x.tri, 1), { ...gras, textColor: OR }),
      r('Multiple du capital', x => nm(x.multiple) + ' x'),
      r('Récupération de la mise', x => x.recuperation ? x.recuperation + ' ans' : 'plus de 10 ans')
    ],
    columnStyles: { 0: { cellWidth: 150 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
  });
  apres();

  // Tests de résistance
  titre(`Tests de résistance (${P.nom})`);
  doc.autoTable({
    ...style, startY: y,
    head: [['Scénario', 'Cash flow /an', 'Par porte /mois', 'RCD']],
    body: [
      [{ content: 'Situation de base', styles: gras }, { content: $(P.liquidites), styles: gras }, { content: $(P.cfPorteMois), styles: gras }, { content: nm(P.rcdReel), styles: gras }],
      ...P.stress.map(x => [p(x.nom), $(x.cf), $(x.cfPorteMois), { content: nm(x.rcd), styles: { textColor: x.rcd < P.rcd ? COTE.faible : COTE.bon } }])
    ],
    columnStyles: { 0: { cellWidth: 230 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
  });
  apres();

  // Ratios
  titre('Ratios');
  doc.autoTable({
    ...style, startY: y,
    body: [
      ['Revenus par porte', $(a.revenusPorte) + ' /an', 'Loyer moyen', $(a.loyerMoyenActuel) + ' /mois'],
      ['Dépenses par porte', $(a.depPorte) + ' /an', 'Ratio des dépenses', pc(a.ratioDep, 1)],
      ['RNE par porte', $(a.rnePorte) + ' /an', 'Prix au pi²', a.prixPi2 ? $(a.prixPi2) : '-'],
      ['Prix ÷ évaluation', a.prixEval ? nm(a.prixEval) + ' x' : '-', 'Coût total d\'acquisition', $(a.coutTotal)]
    ],
    columnStyles: { 0: { textColor: DOUX }, 1: { halign: 'right', fontStyle: 'bold' }, 2: { textColor: DOUX }, 3: { halign: 'right', fontStyle: 'bold' } }
  });
  apres();

  // Prix d'offre
  titre('Prix d\'offre');
  const rond = v => Math.round(v / 1000) * 1000;
  const corps = [
    [`Valeur au TGA de ${pc(a.cibles.a, 1)}`, $(rond(a.cibles.prixA))],
    [`Valeur au TGA de ${pc(a.cibles.b, 1)}`, $(rond(a.cibles.prixB))],
    ['Prix demandé', a.prixDemande ? $(a.prixDemande) : '-'],
    ['Loyer moyen actuel', $(a.loyerMoyenActuel) + ' /mois'],
    [`Loyer moyen requis pour un TGA de ${pc(a.cibles.a, 1)} au prix analysé`, $(a.loyerMoyenRequis) + ' /mois']
  ];
  if (a.evaluation) corps.push(['Évaluation municipale', `${$(a.evaluation)} (prix = ${nm(a.prixEval)} fois)`]);
  if (a.potentiel) corps.push(['TGA au loyer du marché', `${pc(a.potentiel.tga)} (valeur ${$(rond(a.potentiel.valeurB))} à ${$(rond(a.potentiel.valeurA))})`]);
  doc.autoTable({ ...style, startY: y, body: corps, columnStyles: { 0: { cellWidth: 300 }, 1: { halign: 'right', fontStyle: 'bold' } } });
  apres();

  // Projection
  titre(`Projection sur 10 ans (${a.scenarioProjection})`);
  const ans = a.projection.filter(x => [1, 2, 3, 5, 10].includes(x.annee));
  doc.autoTable({
    ...style, startY: y,
    head: [['Année', ...ans.map(x => String(x.annee))]],
    body: [
      ['RNE', ...ans.map(x => $(x.rne))],
      ['Liquidités', ...ans.map(x => $(x.liquidites))],
      ['Liquidités cumulées', ...ans.map(x => $(x.cumul))],
      ['Valeur', ...ans.map(x => $(x.valeur))],
      ['Solde du prêt', ...ans.map(x => $(x.solde))],
      [{ content: 'Équité', styles: gras }, ...ans.map(x => ({ content: $(x.equite), styles: gras }))]
    ],
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
  });
  apres();

  // Notes
  if (d.notes && String(d.notes).trim()) {
    titre('Notes');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...ENCRE);
    const l = doc.splitTextToSize(p(d.notes), L - 2 * M);
    for (const ligne of l) {
      if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 50; }
      doc.text(ligne, M, y); y += 12;
    }
    y += 10;
  }

  // Hypothèses
  titre('Hypothèses');
  const H = a.H;
  const hyp = `Inoccupation ${pc(H.inoccupation, 1)}, gestion ${pc(H.gestion_pct, 1)} des revenus effectifs, entretien ${$(H.entretien_porte)} par porte` +
    (H.reserve_porte ? `, réserve ${$(H.reserve_porte)} par porte` : '') +
    `. Appréciation ${pc(H.appreciation, 1)}, hausse des loyers ${pc(H.hausse_loyers, 1)} et des dépenses ${pc(H.hausse_depenses, 1)} par an. ` +
    'Intérêts composés semestriellement. Les dépenses retenues sont le plus élevé entre le montant de la fiche et la norme. ' +
    'Cette analyse est un outil de travail : les montants de financement doivent être confirmés par le prêteur.';
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...DOUX);
  const lh = doc.splitTextToSize(p(hyp), L - 2 * M);
  doc.text(lh, M, y);

  // Pieds de page
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5); doc.setTextColor(...DOUX);
    doc.text(p(`Gestion Clevor · Cruncher · ${d.nom || imm.nom}`), M, doc.internal.pageSize.getHeight() - 22);
    doc.text(`${i} / ${n}`, L - M, doc.internal.pageSize.getHeight() - 22, { align: 'right' });
  }

  const nomFichier = 'Analyse - ' + p(d.nom || imm.nom || 'immeuble').replace(/[\\/:*?"<>|]/g, '-') + '.pdf';
  doc.save(nomFichier);
  return nomFichier;
}
