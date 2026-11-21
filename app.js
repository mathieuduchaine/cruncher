import { analyser, REGLAGES_DEFAUT, SCENARIOS, POSTES_DEPENSES, STATUTS, nb, reglagesComplets, nombreLogements } from './calc.js';
import { genererRapport } from './rapport.js';
import { vueContacts, vueContact, flushContacts, contactsEnAttente } from './contacts.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const TYPES = ['1½', '2½', '3½', '4½', '5½', '6½', '7½', '8½', 'Maison', 'Commercial', 'Garage', 'Stationnement'];

let logoPdf = null;
fetch('logo-clevor-pdf.jpg').then(r => r.ok ? r.blob() : null).then(b => {
  if (!b) return;
  const fr = new FileReader(); fr.onload = () => { logoPdf = fr.result; }; fr.readAsDataURL(b);
}).catch(() => {});

const etat = {
  sb: null, session: null, profil: null, immeubles: [], profils: [],
  courant: null, tri: { col: 'modifie_le', dir: -1 }, selection: new Set(),
  recherche: '', filtreStatut: '', filtreProprio: '', attente: null, attenteReglages: null, contacts: null
};

const $ = s => document.querySelector(s);
const app = $('#app');

/* ---------- Formatage ---------- */
const propre = s => s.replace(/[  ]/g, ' ');
function argent(v, dec = 0) {
  if (!isFinite(v)) return '—';
  return propre(Number(v).toLocaleString('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) + ' $';
}
function pct(v, dec = 2) { return isFinite(v) && v ? propre(Number(v).toLocaleString('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) + ' %' : '—'; }
function nombre(v, dec = 2) { return isFinite(v) && v ? propre(Number(v).toLocaleString('fr-CA', { minimumFractionDigits: dec, maximumFractionDigits: dec })) : '—'; }
function champNombre(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = nb(v);
  return propre(n.toLocaleString('fr-CA', { maximumFractionDigits: 2 }));
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dateCourte(s) { return s ? new Date(s).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function voile(texte) { $('#voile-texte').textContent = texte; $('#voile').hidden = false; }
function finVoile() { $('#voile').hidden = true; }

/* ---------- Chemins dans les données ---------- */
function lire(obj, chemin) { return chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function ecrire(obj, chemin, val) {
  const ks = chemin.split('.'); let o = obj;
  ks.slice(0, -1).forEach((k, i) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; });
  o[ks[ks.length - 1]] = val;
}

/* ---------- Démarrage ---------- */
async function demarrer() {
  const typeLien = (/type=(invite|recovery|signup|magiclink)/.exec(location.hash) || [])[1];
  let cfg = null;
  try { cfg = await (await fetch('/api/config')).json(); } catch { cfg = null; }
  if (!cfg || !cfg.url || !cfg.cle) return ecranConfig(cfg);
  etat.sb = window.supabase.createClient(cfg.url, cfg.cle);
  etat.sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') ecranMotDePasse('recovery'); });
  const { data } = await etat.sb.auth.getSession();
  const session = data && data.session;
  if (session && (typeLien === 'invite' || typeLien === 'recovery')) {
    history.replaceState(null, '', location.pathname);
    etat.session = session;
    return ecranMotDePasse(typeLien);
  }
  if (session) return entrer(session);
  ecranConnexion();
}

function ecranConfig(cfg) {
  const manque = (cfg && cfg.manque) || ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
  app.innerHTML = `<div class="porte"><div class="porte-boite">${logo()}
    <h2>Configuration incomplète</h2>
    <p>Il manque ces variables dans Vercel (Settings, Environment Variables) :</p>
    <ul class="liste-simple">${manque.map(m => `<li><code>${esc(m)}</code></li>`).join('')}</ul>
    <p class="discret">Après les avoir ajoutées, fais Redeploy dans Vercel.</p></div></div>`;
}

function logo() { return `<div class="logo"><img class="logo-img" src="logo-clevor.png" alt="Gestion Clevor"><span class="logo-app">CRUNCHER</span></div>`; }

function ecranConnexion(message = '') {
  app.innerHTML = `<div class="porte"><form class="porte-boite" id="f-connexion">${logo()}
    <p class="discret centre petit">Analyse d'immeubles à revenus</p>
    ${message ? `<p class="message">${esc(message)}</p>` : ''}
    <label>Courriel<input type="email" name="courriel" autocomplete="username" required></label>
    <label>Mot de passe<input type="password" name="mdp" autocomplete="current-password" required></label>
    <button class="btn principal large" type="submit">Se connecter</button>
    <button class="lien" type="button" id="b-oubli">Mot de passe oublié?</button>
  </form></div>`;
  $('#f-connexion').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Connexion…';
    const { data, error } = await etat.sb.auth.signInWithPassword({ email: f.get('courriel').trim(), password: f.get('mdp') });
    if (error) { btn.disabled = false; btn.textContent = 'Se connecter'; return ecranConnexionErreur(); }
    entrer(data.session);
  };
  $('#b-oubli').onclick = async () => {
    const courriel = $('#f-connexion [name=courriel]').value.trim();
    if (!courriel) return toast('Entre ton courriel d\'abord.');
    const { error } = await etat.sb.auth.resetPasswordForEmail(courriel, { redirectTo: location.origin });
    toast(error ? 'Envoi impossible : ' + error.message : 'Courriel envoyé. Clique le lien pour choisir un nouveau mot de passe.', 5000);
  };
}
function ecranConnexionErreur() { toast('Courriel ou mot de passe incorrect.'); }

function ecranMotDePasse(type) {
  app.innerHTML = `<div class="porte"><form class="porte-boite" id="f-mdp">${logo()}
    <h2>${type === 'invite' ? 'Bienvenue! Choisis ton mot de passe' : 'Nouveau mot de passe'}</h2>
    <label>Mot de passe<input type="password" name="m1" minlength="8" autocomplete="new-password" required></label>
    <label>Confirme<input type="password" name="m2" minlength="8" autocomplete="new-password" required></label>
    <button class="btn principal large" type="submit">Enregistrer</button>
  </form></div>`;
  $('#f-mdp').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('m1') !== f.get('m2')) return toast('Les deux mots de passe ne sont pas identiques.');
    const { error } = await etat.sb.auth.updateUser({ password: f.get('m1') });
    if (error) return toast('Erreur : ' + error.message, 5000);
    toast('Mot de passe enregistré.');
    const { data } = await etat.sb.auth.getSession();
    entrer(data.session);
  };
}

async function entrer(session) {
  etat.session = session;
  const { data: profil, error } = await etat.sb.from('cr_profils').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !profil) {
    app.innerHTML = `<div class="porte"><div class="porte-boite">${logo()}
      <h2>Accès non activé</h2><p>Ton compte (${esc(session.user.email)}) n'a pas encore accès au Cruncher. Demande une invitation à l'administrateur.</p>
      <button class="btn" id="b-sortir">Se déconnecter</button></div></div>`;
    $('#b-sortir').onclick = sortir;
    return;
  }
  etat.profil = profil;
  profil.reglages = profil.reglages || {};
  await chargerImmeubles();
  if (profil.est_admin) await chargerProfils();
  window.addEventListener('hashchange', router);
  router();
}

async function sortir() { await flush(); await etat.sb.auth.signOut(); location.hash = ''; location.reload(); }

async function chargerImmeubles() {
  const { data, error } = await etat.sb.from('cr_immeubles').select('*').order('modifie_le', { ascending: false });
  if (error) { toast('Chargement impossible : ' + error.message, 5000); etat.immeubles = []; return; }
  etat.immeubles = data || [];
}
async function chargerProfils() {
  const { data } = await etat.sb.from('cr_profils').select('*').order('cree_le', { ascending: true });
  etat.profils = data || [];
}

/* ---------- Routeur ---------- */
async function router() {
  await flush();
  const h = location.hash.replace(/^#\/?/, '');
  const [vue, arg] = h.split('/');
  coquille(vue || 'liste');
  if (vue === 'i' && arg) return vueFiche(arg);
  if (vue === 'comparer') return vueComparer((arg || '').split(',').filter(Boolean));
  if (vue === 'contacts') return vueContacts();
  if (vue === 'c' && arg) return vueContact(arg);
  if (vue === 'reglages') return vueReglages();
  if (vue === 'utilisateurs' && etat.profil.est_admin) return vueUtilisateurs();
  vueListe();
}
function aller(h) { if (location.hash === h) router(); else location.hash = h; }

function coquille(vue) {
  const admin = etat.profil.est_admin;
  app.innerHTML = `<header class="entete">
      <a href="#/" class="logo-lien">${logo()}</a>
      <nav>
        <a href="#/" class="${vue === 'liste' || vue === 'i' || vue === 'comparer' ? 'actif' : ''}">Immeubles</a>
        <a href="#/contacts" class="${vue === 'contacts' || vue === 'c' ? 'actif' : ''}">Contacts</a>
        <a href="#/reglages" class="${vue === 'reglages' ? 'actif' : ''}">Réglages</a>
        ${admin ? `<a href="#/utilisateurs" class="${vue === 'utilisateurs' ? 'actif' : ''}">Utilisateurs</a>` : ''}
      </nav>
      <div class="entete-droite"><span class="discret petit">${esc(etat.profil.nom || etat.profil.courriel)}</span>
        <button class="btn mini" id="b-sortir">Sortir</button></div>
    </header>
    <main id="vue"></main>`;
  $('#b-sortir').onclick = sortir;
}

/* ---------- Liste ---------- */
function proprio(id) { const p = etat.profils.find(x => x.id === id); return p ? (p.nom || p.courriel) : ''; }

function lignesListe() {
  const reg = etat.profil.reglages;
  const q = etat.recherche.toLowerCase();
  let lignes = etat.immeubles.map(i => {
    const a = analyser(i.donnees || {}, reg);
    return { i, a, s: a.principal };
  }).filter(({ i }) =>
    (!q || `${i.nom} ${i.ville} ${(i.donnees || {}).adresse || ''}`.toLowerCase().includes(q)) &&
    (!etat.filtreStatut || i.statut === etat.filtreStatut) &&
    (!etat.filtreProprio || i.user_id === etat.filtreProprio));
  const cles = {
    nom: x => x.i.nom.toLowerCase(), statut: x => x.i.statut, portes: x => x.a.n, prix: x => x.a.prix,
    porte: x => x.a.prixPorte, mrb: x => x.a.mrb || 999, tga: x => x.a.tga, cf: x => x.s.cfPorteMois, cfm: x => x.s.cfMois, rcd: x => x.s.rcdAuMax,
    cash: x => x.s.cash, proprio: x => proprio(x.i.user_id), modifie_le: x => x.i.modifie_le
  };
  const f = cles[etat.tri.col] || cles.modifie_le;
  lignes.sort((a, b) => { const va = f(a), vb = f(b); return (va > vb ? 1 : va < vb ? -1 : 0) * etat.tri.dir; });
  return lignes;
}

function vueListe() {
  const admin = etat.profil.est_admin;
  const v = $('#vue');
  v.innerHTML = `<div class="barre">
      <h1>Immeubles</h1>
      <div class="barre-actions">
        <label class="btn principal" id="b-import">Importer une fiche PDF<input type="file" accept="application/pdf" hidden id="f-pdf"></label>
        <button class="btn" id="b-nouveau">Nouvel immeuble</button>
      </div>
    </div>
    <div class="filtres">
      <input type="search" id="f-recherche" placeholder="Rechercher" value="${esc(etat.recherche)}">
      <select id="f-statut"><option value="">Tous les statuts</option>${STATUTS.map(s => `<option ${s === etat.filtreStatut ? 'selected' : ''}>${s}</option>`).join('')}</select>
      ${admin ? `<select id="f-proprio"><option value="">Tous les comptes</option>${etat.profils.map(p => `<option value="${p.id}" ${p.id === etat.filtreProprio ? 'selected' : ''}>${esc(p.nom || p.courriel)}</option>`).join('')}</select>` : ''}
      <button class="btn" id="b-comparer" ${etat.selection.size < 2 ? 'disabled' : ''}>Comparer (${etat.selection.size})</button>
    </div>
    <div id="tableau"></div>`;
  dessinerTableau();
  $('#f-pdf').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importerFiche(f); };
  $('#b-nouveau').onclick = () => creerEtOuvrir({});
  $('#f-recherche').oninput = e => { etat.recherche = e.target.value; dessinerTableau(); };
  $('#f-statut').onchange = e => { etat.filtreStatut = e.target.value; dessinerTableau(); };
  if (admin) $('#f-proprio').onchange = e => { etat.filtreProprio = e.target.value; dessinerTableau(); };
  $('#b-comparer').onclick = () => aller('#/comparer/' + [...etat.selection].join(','));
}

function dessinerTableau() {
  const admin = etat.profil.est_admin;
  const lignes = lignesListe();
  const t = $('#tableau');
  if (!etat.immeubles.length) {
    t.innerHTML = `<div class="vide"><p>Aucun immeuble pour l'instant.</p><p class="discret">Importe une fiche PDF de Centris ou RE/MAX, ou crée un immeuble à la main.</p></div>`;
    return;
  }
  const col = (cle, nom, cls = '') => `<th class="${cls} triable ${etat.tri.col === cle ? 'trie' : ''}" data-tri="${cle}">${nom}${etat.tri.col === cle ? (etat.tri.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const c = (cote, txt) => `<span class="pastille ${cote}">${txt}</span>`;
  t.innerHTML = `<div class="defile"><table class="grille">
    <thead><tr><th class="case"></th>${col('nom', 'Immeuble')}${col('statut', 'Statut')}${col('portes', 'Portes', 'num')}${col('prix', 'Prix', 'num')}${col('porte', '$/porte', 'num')}${col('mrb', 'MRB', 'num')}${col('tga', 'TGA', 'num')}${col('rcd', 'RCD*', 'num')}${col('cfm', 'Cash flow/mois*', 'num')}${col('cf', 'Par porte*', 'num')}${col('cash', 'Mise totale*', 'num')}${admin ? col('proprio', 'Compte') : ''}${col('modifie_le', 'Modifié', 'num')}</tr></thead>
    <tbody>${lignes.map(({ i, a, s }) => `<tr data-id="${i.id}">
      <td class="case"><input type="checkbox" data-sel="${i.id}" ${etat.selection.has(i.id) ? 'checked' : ''} aria-label="Sélectionner"></td>
      <td><strong>${esc(i.nom)}</strong><div class="discret petit">${esc(i.ville || '')}</div></td>
      <td><span class="statut s-${STATUTS.indexOf(i.statut)}">${esc(i.statut)}</span></td>
      <td class="num">${a.n || '—'}</td>
      <td class="num">${a.prix ? argent(a.prix) : '—'}</td>
      <td class="num">${a.prixPorte ? argent(a.prixPorte) : '—'}</td>
      <td class="num">${a.mrb ? c(a.cote.mrb, nombre(a.mrb)) : '—'}</td>
      <td class="num">${a.tga ? c(a.cote.tga, pct(a.tga)) : '—'}</td>
      <td class="num">${a.rne ? c(a.cote.rcd, nombre(s.rcdAuMax)) : '—'}</td>
      <td class="num">${a.rne ? argent(s.cfMois) : '—'}</td>
      <td class="num">${a.rne ? c(a.cote.cf, argent(s.cfPorteMois)) : '—'}</td>
      <td class="num">${a.prix ? argent(s.cash) : '—'}</td>
      ${admin ? `<td class="petit">${esc(proprio(i.user_id))}</td>` : ''}
      <td class="num petit discret">${dateCourte(i.modifie_le)}</td>
    </tr>`).join('')}</tbody></table></div>
    <p class="discret petit">* Selon ton scénario principal (Réglages). RCD au ratio prêt-valeur maximal : vert si ça passe. Clique un en-tête pour trier. Coche des immeubles pour les comparer.</p>`;
  t.querySelectorAll('th[data-tri]').forEach(th => th.onclick = () => {
    const cle = th.dataset.tri;
    etat.tri = { col: cle, dir: etat.tri.col === cle ? -etat.tri.dir : (cle === 'nom' || cle === 'mrb' || cle === 'cash' || cle === 'porte' ? 1 : -1) };
    dessinerTableau();
  });
  t.querySelectorAll('tbody tr').forEach(tr => tr.onclick = e => {
    if (e.target.matches('input[type=checkbox]')) return;
    aller('#/i/' + tr.dataset.id);
  });
  t.querySelectorAll('input[data-sel]').forEach(cb => cb.onchange = () => {
    if (cb.checked) etat.selection.add(cb.dataset.sel); else etat.selection.delete(cb.dataset.sel);
    const b = $('#b-comparer'); b.textContent = `Comparer (${etat.selection.size})`; b.disabled = etat.selection.size < 2;
  });
}

/* ---------- Création, import ---------- */
async function creerImmeuble(donnees, nomFichier) {
  const d = { statut: 'À analyser', logements: [], dep: {}, hyp: {}, fin: {}, ...donnees };
  const ligne = { nom: d.nom || 'Nouvel immeuble', ville: d.ville || '', statut: d.statut, donnees: d, user_id: etat.session.user.id };
  const { data, error } = await etat.sb.from('cr_immeubles').insert(ligne).select().single();
  if (error) throw new Error(error.message);
  etat.immeubles.unshift(data);
  return data;
}
async function creerEtOuvrir(d) {
  try { const i = await creerImmeuble(d); aller('#/i/' + i.id); }
  catch (e) { toast('Création impossible : ' + e.message, 5000); }
}

async function jeton() { const { data } = await etat.sb.auth.getSession(); return data.session ? data.session.access_token : ''; }

async function lirePdf(fichier) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await fichier.arrayBuffer() }).promise;
  let texte = '';
  for (let p = 1; p <= Math.min(doc.numPages, 25); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    texte += `\n--- Page ${p} ---\n` + tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('');
  }
  const images = [];
  if (texte.replace(/\s|---|Page \d+/g, '').length < 300) {
    for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1.6 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      images.push(cv.toDataURL('image/jpeg', 0.72).split(',')[1]);
    }
  }
  return { texte, images };
}

function nettoyer(x) {
  const d = {};
  const num = v => (v === null || v === undefined || v === '' || isNaN(nb(v))) ? '' : nb(v);
  const txt = v => (v === null || v === undefined) ? '' : String(v);
  for (const k of ['nom', 'adresse', 'ville', 'uls', 'courtier', 'notes']) d[k] = txt(x[k]);
  for (const k of ['annee', 'prix_demande', 'evaluation', 'nb_logements', 'rba_fiche', 'autres_revenus', 'superficie']) d[k] = num(x[k]);
  d.revenus_potentiels = !!x.revenus_potentiels;
  d.dep = {};
  for (const p of POSTES_DEPENSES) d.dep[p.cle] = num((x.dep || {})[p.cle]);
  d.logements = Array.isArray(x.logements) ? x.logements.map(l => ({ type: txt(l.type), loyer: num(l.loyer), loyer_marche: '', bail: txt(l.bail), note: '' })) : [];
  if (!d.nom) d.nom = d.adresse || 'Immeuble importé';
  return d;
}

async function importerFiche(fichier) {
  try {
    voile('Lecture du PDF…');
    const { texte, images } = await lirePdf(fichier);
    voile('Claude extrait les chiffres de la fiche…');
    const r = await fetch('/api/extraire', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await jeton() },
      body: JSON.stringify({ texte, images })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erreur || 'Erreur ' + r.status);
    const d = nettoyer(j.donnees || {});
    voile('Création de l\'immeuble…');
    const imm = await creerImmeuble(d);
    const chemin = `${etat.session.user.id}/${imm.id}.pdf`;
    const up = await etat.sb.storage.from('cr-fiches').upload(chemin, fichier, { upsert: true, contentType: 'application/pdf' });
    if (!up.error) {
      imm.donnees.fiche_pdf = chemin; imm.donnees.fiche_nom = fichier.name;
      await etat.sb.from('cr_immeubles').update({ donnees: imm.donnees }).eq('id', imm.id);
    }
    finVoile();
    toast('Fiche importée. Vérifie les chiffres avant de te fier à l\'analyse.', 4000);
    aller('#/i/' + imm.id);
  } catch (e) {
    finVoile();
    toast('Import impossible : ' + e.message, 6000);
  }
}

/* ---------- Fiche d'un immeuble ---------- */
function ch(chemin, libelle, opts = {}) {
  const d = etat.courant.donnees;
  const v = lire(d, chemin);
  const type = opts.type || 'n';
  const ph = opts.ph !== undefined ? ` placeholder="${esc(opts.ph)}"` : '';
  const aide = opts.aide ? `<small>${esc(opts.aide)}</small>` : '';
  const suffixe = opts.suf ? `<span class="suf">${opts.suf}</span>` : '';
  if (type === 't') return `<label class="champ ${opts.cls || ''}"><span>${libelle}</span><input data-p="${chemin}" data-t="t" value="${esc(v ?? '')}"${ph}>${aide}</label>`;
  if (type === 'zone') return `<label class="champ large ${opts.cls || ''}"><span>${libelle}</span><textarea data-p="${chemin}" data-t="t" rows="${opts.rows || 6}"${ph}>${esc(v ?? '')}</textarea></label>`;
  return `<label class="champ ${opts.cls || ''}"><span>${libelle}</span><div class="avec-suf"><input data-p="${chemin}" data-t="n" ${opts.brut ? 'data-brut="1"' : ''} inputmode="decimal" value="${esc(opts.brut ? (v ?? '') : champNombre(v))}"${ph}>${suffixe}</div>${aide}</label>`;
}

async function vueFiche(id) {
  let imm = etat.immeubles.find(i => i.id === id);
  if (!imm) {
    const { data } = await etat.sb.from('cr_immeubles').select('*').eq('id', id).maybeSingle();
    if (!data) { $('#vue').innerHTML = `<div class="vide"><p>Immeuble introuvable.</p><a href="#/" class="btn">Retour</a></div>`; return; }
    imm = data; etat.immeubles.push(imm);
  }
  imm.donnees = imm.donnees || {};
  const d = imm.donnees;
  d.logements = d.logements || []; d.dep = d.dep || {}; d.hyp = d.hyp || {}; d.fin = d.fin || {};
  if (!d.nom) d.nom = imm.nom; if (!d.statut) d.statut = imm.statut;
  etat.courant = imm;
  const R = reglagesComplets(etat.profil.reglages);
  const admin = etat.profil.est_admin && imm.user_id !== etat.session.user.id;

  $('#vue').innerHTML = `
    <div class="barre fiche-barre">
      <div><a href="#/" class="lien">← Immeubles</a>
        <h1 id="titre">${esc(d.nom)}</h1>
        <div class="discret petit">${esc(d.adresse || '')}${admin ? ` · Compte de ${esc(proprio(imm.user_id))}` : ''}</div></div>
      <div class="barre-actions">
        <span id="sauve" class="discret petit"></span>
        <button class="btn principal" id="b-rapport">Rapport PDF</button>
        <button class="btn" id="b-dupliquer">Dupliquer</button>
        <button class="btn danger" id="b-effacer">Supprimer</button>
      </div>
    </div>

    <section id="resume"></section>

    <div class="fiche">
      <div class="colonne">
        <section class="carte"><h2>Identification</h2><div class="champs">
          ${ch('nom', 'Nom', { type: 't' })}
          ${ch('adresse', 'Adresse', { type: 't' })}
          ${ch('ville', 'Ville', { type: 't' })}
          <label class="champ"><span>Statut</span><select data-p="statut" data-t="t">${STATUTS.map(s => `<option ${s === d.statut ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          ${ch('uls', 'No ULS / Centris', { type: 't' })}
          ${ch('courtier', 'Courtier', { type: 't' })}
          ${ch('annee', 'Année de construction', { brut: true })}
          ${ch('superficie', 'Superficie habitable', { suf: 'pi²' })}
          ${ch('evaluation', 'Évaluation municipale', { suf: '$' })}
          ${ch('prix_demande', 'Prix demandé', { suf: '$' })}
          ${ch('prix_offre', 'Prix analysé', { suf: '$', ph: 'Prix demandé', aide: 'Laisse vide pour analyser au prix demandé. Entre ton prix d\'offre pour voir ce qu\'il donne.' })}
        </div></section>

        <section class="carte" id="s-revenus"></section>

        <section class="carte"><h2>Dépenses</h2>
          <p class="discret petit">Entre les dépenses de la fiche. Le Cruncher les normalise comme un prêteur : il prend le plus élevé entre le montant réel et la norme.</p>
          <div class="defile"><table class="grille compacte"><thead><tr><th>Poste</th><th class="num">Fiche</th><th class="num">Normalisé</th></tr></thead>
          <tbody id="t-depenses">${POSTES_DEPENSES.map(p => `<tr><td>${p.nom}</td><td class="num"><input class="mini-champ" data-p="dep.${p.cle}" data-t="n" inputmode="decimal" value="${esc(champNombre(d.dep[p.cle]))}"></td><td class="num" id="norm-${p.cle}"></td></tr>`).join('')}</tbody>
          <tfoot id="pied-depenses"></tfoot></table></div>
        </section>

        <section class="carte" id="s-ratios"></section>

        <section class="carte"><h2>Hypothèses de cet immeuble</h2>
          <p class="discret petit">Laisse vide pour utiliser tes réglages par défaut (affichés en gris).</p>
          <div class="champs">
            ${ch('hyp.inoccupation', 'Inoccupation', { suf: '%', ph: champNombre(R.hyp.inoccupation) })}
            ${ch('hyp.gestion_pct', 'Gestion', { suf: '%', ph: champNombre(R.hyp.gestion_pct) })}
            ${ch('hyp.entretien_porte', 'Entretien par porte', { suf: '$', ph: champNombre(R.hyp.entretien_porte) })}
            ${ch('hyp.reserve_porte', 'Réserve par porte', { suf: '$', ph: champNombre(R.hyp.reserve_porte) })}
            ${ch('hyp.conciergerie_porte', 'Conciergerie par porte', { suf: '$', ph: champNombre(R.hyp.conciergerie_porte), aide: `À partir de ${R.hyp.conciergerie_seuil} logements` })}
            ${ch('frais_divers', 'Frais d\'acquisition divers', { suf: '$', ph: `${champNombre(R.hyp.frais_divers_pct)} % du prix`, aide: 'Notaire, inspection, évaluation, Phase 1, frais SCHL' })}
            ${ch('travaux', 'Travaux à faire dès l\'achat', { suf: '$', ph: '0' })}
            ${ch('hyp.appreciation', 'Appréciation annuelle', { suf: '%', ph: champNombre(R.hyp.appreciation) })}
            ${ch('hyp.hausse_loyers', 'Hausse des loyers par an', { suf: '%', ph: champNombre(R.hyp.hausse_loyers) })}
            ${ch('hyp.hausse_depenses', 'Hausse des dépenses par an', { suf: '%', ph: champNombre(R.hyp.hausse_depenses) })}
            ${ch('hyp.frais_vente', 'Frais de revente (TRI)', { suf: '%', ph: champNombre(R.hyp.frais_vente) })}
          </div>
        </section>

        <section class="carte"><h2>Financement</h2>
          <div class="scenarios">${SCENARIOS.map(s => `<div class="scenario"><h3>${s.nom}</h3><div class="champs serre">
            ${ch(`fin.${s.cle}.taux`, 'Taux', { suf: '%', ph: champNombre(R.fin[s.cle].taux) })}
            ${ch(`fin.${s.cle}.amort`, 'Amortissement', { suf: 'ans', ph: champNombre(R.fin[s.cle].amort) })}
            ${ch(`fin.${s.cle}.ltv`, 'Prêt max', { suf: '%', ph: champNombre(R.fin[s.cle].ltv) })}
            ${ch(`fin.${s.cle}.rcd`, 'RCD exigé', { ph: champNombre(R.fin[s.cle].rcd) })}
            ${ch(`fin.${s.cle}.prime`, 'Prime SCHL', { suf: '%', ph: champNombre(R.fin[s.cle].prime) })}
          </div><div class="res-scenario" id="fin-${s.cle}"></div></div>`).join('')}</div>
          <p class="discret petit">L'APH Select exige des travaux d'efficacité énergétique et un pointage suffisant. Valide avec ton prêteur.</p>
        </section>

        <section class="carte" id="s-stress"></section>
        <section class="carte" id="s-offre"></section>
        <section class="carte" id="s-projection"></section>

        <section class="carte"><h2>Notes</h2>
          ${ch('notes', '', { type: 'zone', rows: 8, ph: 'Visite, état du bâtiment, questions au courtier, négociation…' })}
          <div id="s-fichier"></div>
        </section>
      </div>
    </div>`;

  dessinerRevenus();
  dessinerFichier();
  majResultats();

  const v = $('#vue');
  v.addEventListener('input', surSaisie);
  v.addEventListener('change', surSaisie);
  v.addEventListener('focusout', e => {
    const el = e.target;
    if (el.dataset && el.dataset.t === 'n' && !el.dataset.brut && el.value.trim() !== '') el.value = champNombre(el.value);
  });
  $('#b-rapport').onclick = () => {
    flush();
    try { genererRapport(etat.courant, analyser(etat.courant.donnees, etat.profil.reglages), etat.profil, logoPdf); }
    catch (e) { toast('Rapport impossible : ' + e.message, 5000); }
  };
  $('#b-dupliquer').onclick = async () => {
    await flush();
    const copie = JSON.parse(JSON.stringify(etat.courant.donnees));
    copie.nom = (copie.nom || 'Immeuble') + ' (copie)';
    delete copie.fiche_pdf; delete copie.fiche_nom;
    creerEtOuvrir(copie);
  };
  $('#b-effacer').onclick = async () => {
    if (!confirm(`Supprimer « ${etat.courant.nom} »? Cette action est définitive.`)) return;
    clearTimeout(etat.attente); etat.attente = null;
    const cible = etat.courant;
    const { error } = await etat.sb.from('cr_immeubles').delete().eq('id', cible.id);
    if (error) return toast('Suppression impossible : ' + error.message, 5000);
    if (cible.donnees.fiche_pdf) etat.sb.storage.from('cr-fiches').remove([cible.donnees.fiche_pdf]);
    etat.immeubles = etat.immeubles.filter(i => i.id !== cible.id);
    etat.selection.delete(cible.id);
    etat.courant = null;
    toast('Immeuble supprimé.');
    aller('#/');
  };
}

function surSaisie(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.p) return;
  if (e.type === 'change' && el.tagName === 'INPUT' && el.type !== 'checkbox') return;
  const d = etat.courant.donnees;
  let val;
  if (el.type === 'checkbox') val = el.checked;
  else if (el.dataset.t === 'n') val = el.value.trim() === '' ? '' : nb(el.value);
  else val = el.value;
  ecrire(d, el.dataset.p, val);
  if (el.dataset.p === 'nom') $('#titre').textContent = val || 'Sans nom';
  if (el.dataset.redessine) dessinerRevenus();
  majResultats();
  planifier();
}

function dessinerRevenus() {
  const d = etat.courant.donnees;
  const logs = d.logements;
  $('#s-revenus').innerHTML = `<h2>Revenus</h2>
    <div class="champs">
      ${ch('rba_fiche', 'Revenus bruts annuels (fiche)', { suf: '$', aide: 'Utilisé seulement si les loyers des logements ne sont pas entrés.' })}
      ${ch('nb_logements', 'Nombre de logements', { aide: 'Utilisé seulement si la liste des logements est vide.' })}
      ${ch('autres_revenus', 'Autres revenus annuels', { suf: '$', aide: 'Stationnement, buanderie, rangement…' })}
      <label class="champ case-champ"><input type="checkbox" data-p="revenus_potentiels" ${d.revenus_potentiels ? 'checked' : ''}><span>Revenus « potentiels » selon la fiche</span></label>
    </div>
    <h3>Logements <span class="discret petit">(${logs.length})</span></h3>
    ${logs.length ? `<div class="defile"><table class="grille compacte logements"><thead><tr><th>Type</th><th class="num">Loyer actuel /mois</th><th class="num">Loyer du marché /mois</th><th>Fin du bail</th><th>Note</th><th></th></tr></thead>
    <tbody>${logs.map((l, k) => `<tr>
      <td><input class="mini-champ type" list="types" data-p="logements.${k}.type" data-t="t" value="${esc(l.type || '')}"></td>
      <td class="num"><input class="mini-champ" data-p="logements.${k}.loyer" data-t="n" inputmode="decimal" value="${esc(champNombre(l.loyer))}"></td>
      <td class="num"><input class="mini-champ" data-p="logements.${k}.loyer_marche" data-t="n" inputmode="decimal" value="${esc(champNombre(l.loyer_marche))}" placeholder="optionnel"></td>
      <td><input class="mini-champ" data-p="logements.${k}.bail" data-t="t" value="${esc(l.bail || '')}" placeholder="ex. 30 juin 2027"></td>
      <td><input class="mini-champ note" data-p="logements.${k}.note" data-t="t" value="${esc(l.note || '')}"></td>
      <td><button class="btn mini fantome" data-retirer="${k}" title="Retirer" aria-label="Retirer">✕</button></td>
    </tr>`).join('')}</tbody><tfoot id="pied-logements"></tfoot></table></div>` : ''}
    <datalist id="types">${TYPES.map(t => `<option value="${t}">`).join('')}</datalist>
    <div class="ajout-logements">
      <input type="number" id="aj-n" min="1" max="200" value="1" aria-label="Nombre">
      <select id="aj-type">${TYPES.map(t => `<option ${t === '4½' ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input id="aj-loyer" inputmode="decimal" placeholder="Loyer /mois">
      <button class="btn" id="b-ajouter">Ajouter</button>
    </div>`;
  $('#b-ajouter').onclick = () => {
    const n = Math.max(1, Math.min(200, parseInt($('#aj-n').value) || 1));
    const loyer = $('#aj-loyer').value.trim() === '' ? '' : nb($('#aj-loyer').value);
    for (let i = 0; i < n; i++) d.logements.push({ type: $('#aj-type').value, loyer, loyer_marche: '', bail: '', note: '' });
    dessinerRevenus(); majResultats(); planifier();
  };
  $('#s-revenus').querySelectorAll('[data-retirer]').forEach(b => b.onclick = () => {
    d.logements.splice(+b.dataset.retirer, 1);
    dessinerRevenus(); majResultats(); planifier();
  });
}

async function dessinerFichier() {
  const d = etat.courant.donnees;
  const z = $('#s-fichier');
  z.innerHTML = `<div class="fichier">${d.fiche_pdf ? `<button class="btn" id="b-voir-fiche">Ouvrir la fiche PDF</button><span class="discret petit">${esc(d.fiche_nom || '')}</span>` : '<span class="discret petit">Aucune fiche PDF jointe.</span>'}
    <label class="btn">${d.fiche_pdf ? 'Remplacer' : 'Joindre'} la fiche<input type="file" accept="application/pdf" hidden id="f-joindre"></label></div>`;
  if (d.fiche_pdf) $('#b-voir-fiche').onclick = async () => {
    const fen = window.open('', '_blank');
    const { data, error } = await etat.sb.storage.from('cr-fiches').createSignedUrl(d.fiche_pdf, 3600);
    if (error || !data) { if (fen) fen.close(); return toast('Fiche introuvable.'); }
    if (fen) fen.location = data.signedUrl; else location.href = data.signedUrl;
  };
  $('#f-joindre').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const imm = etat.courant;
    const chemin = `${imm.user_id}/${imm.id}.pdf`;
    const { error } = await etat.sb.storage.from('cr-fiches').upload(chemin, f, { upsert: true, contentType: 'application/pdf' });
    if (error) return toast('Envoi impossible : ' + error.message, 5000);
    d.fiche_pdf = chemin; d.fiche_nom = f.name; planifier(); dessinerFichier(); toast('Fiche jointe.');
  };
}

function majResultats() {
  const imm = etat.courant;
  const a = analyser(imm.donnees, etat.profil.reglages);
  const c = (cote, txt) => `<span class="pastille ${cote}">${txt}</span>`;
  const s = a.principal;
  const triTxt = v => v === null || v === undefined ? '—' : pct(v, 1);
  const k = (cls, titre, valeur, sous) => `<div class="kpi ${cls ? 'k-' + cls : ''}"><span>${titre}</span><strong>${valeur}</strong><small>${sous}</small></div>`;
  $('#resume').innerHTML = `
    <div class="groupe-kpi"><h3>Rentabilité de l'immeuble</h3><div class="kpis">
      ${k('', 'Prix analysé', a.prix ? argent(a.prix) : '—', `${a.n ? a.n + ' logements' : ''}${a.prixPorte ? ' · ' + argent(a.prixPorte) + '/porte' : ''}`)}
      ${k('', 'Revenu net (RNE)', argent(a.rne), `${argent(a.rnePorte)} par porte par an`)}
      ${k(a.cote.tga, 'TGA', pct(a.tga), 'taux global d\'actualisation')}
      ${k(a.cote.mrb, 'MRB', nombre(a.mrb), `MRN ${nombre(a.mrn)}`)}
    </div></div>
    <div class="groupe-kpi"><h3>Financement ${esc(s.nom)}</h3><div class="kpis">
      ${k(a.cote.rcd, 'RCD', a.rne ? (s.passe ? 'Passe' : 'Ne passe pas') : '—', a.rne ? `${nombre(s.rcdAuMax)} à ${pct(s.ltv, 0)} · exigé ${nombre(s.rcd)}` : '')}
      ${k(s.cfMois >= 0 ? a.cote.cf : 'faible', 'Cash flow net', argent(s.cfMois) + '/mois', `${argent(s.liquidites)} par an`)}
      ${k(a.cote.cf, 'Cash flow par porte', argent(s.cfPorteMois) + '/mois', 'après hypothèque')}
      ${k('', 'Argent requis', a.prix ? argent(s.cash) : '—', s.passe ? `mise de ${pct(s.misePct, 1)} + frais` : `mise de ${pct(s.misePct, 1)} (dont ${argent(s.miseSupplementaire)} de plus)`)}
    </div></div>
    <div class="groupe-kpi"><h3>Rendement</h3><div class="kpis">
      ${k('', 'Rendement sur liquidités', pct(s.rendLiquidites, 1), 'cash flow ÷ argent investi')}
      ${k('', 'Rendement total an 1', pct(s.rendTotal, 1), 'cash flow + capital + valeur')}
      ${k('', 'TRI sur 10 ans', triTxt(s.tri), `revente an 10 · multiple ${nombre(s.multiple)}×`)}
      ${k(s.pointMort > 95 ? 'faible' : s.pointMort > 88 ? 'moyen' : 'bon', 'Occupation minimale', pct(s.pointMort, 1), 'point mort, hypothèque incluse')}
    </div></div>
    <div class="verdict"><strong>${esc(a.verdict)}</strong>${!s.passe && a.rne ? `<p class="avertir">Au ${pct(s.ltv, 0)} demandé, le RCD serait de ${nombre(s.rcdAuMax)} alors que le prêteur exige ${nombre(s.rcd)}. Le prêt serait réduit à ${argent(s.pret)} : prévois ${argent(s.miseSupplementaire)} de mise de fonds en plus.</p>` : ''}${a.alertes.length ? `<ul>${a.alertes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;

  // Ratios
  $('#s-ratios').innerHTML = `<h2>Ratios</h2><div class="ratios">
    <div><span>Revenus par porte</span><strong>${argent(a.revenusPorte)}/an</strong></div>
    <div><span>Loyer moyen</span><strong>${argent(a.loyerMoyenActuel)}/mois</strong></div>
    <div><span>Dépenses par porte</span><strong>${argent(a.depPorte)}/an</strong></div>
    <div><span>Ratio des dépenses</span><strong>${pct(a.ratioDep, 1)}</strong></div>
    <div><span>RNE par porte</span><strong>${argent(a.rnePorte)}/an</strong></div>
    <div><span>Prix ÷ évaluation</span><strong>${a.prixEval ? nombre(a.prixEval) + '×' : '—'}</strong></div>
    <div><span>Prix au pi²</span><strong>${a.prixPi2 ? argent(a.prixPi2) : '—'}</strong></div>
    <div><span>Coût total d'acquisition</span><strong>${argent(a.coutTotal)}</strong></div>
  </div>`;

  // Tests de résistance
  $('#s-stress').innerHTML = `<h2>Tests de résistance <span class="discret petit">(${esc(s.nom)})</span></h2>
    <p class="discret petit">Ce qui arrive au cash flow si les choses tournent moins bien. Le RCD en rouge est sous le minimum exigé de ${nombre(s.rcd)}.</p>
    <div class="defile"><table class="grille compacte"><thead><tr><th>Scénario</th><th class="num">Cash flow /an</th><th class="num">Par porte /mois</th><th class="num">RCD</th></tr></thead><tbody>
      <tr class="total"><td>Situation de base</td><td class="num ${s.liquidites < 0 ? 'neg' : ''}">${argent(s.liquidites)}</td><td class="num">${argent(s.cfPorteMois)}</td><td class="num">${nombre(s.rcdReel)}</td></tr>
      ${s.stress.map(x => `<tr><td>${esc(x.nom)}</td><td class="num ${x.cf < 0 ? 'neg' : ''}">${argent(x.cf)}</td><td class="num ${x.cf < 0 ? 'neg' : ''}">${argent(x.cfPorteMois)}</td><td class="num ${x.rcd < s.rcd ? 'neg' : 'pos'}">${nombre(x.rcd)}</td></tr>`).join('')}
    </tbody></table></div>`;

  // Revenus : pied du tableau
  const pl = $('#pied-logements');
  if (pl) {
    const logs = imm.donnees.logements;
    const tot = logs.reduce((t, l) => t + nb(l.loyer), 0), totM = logs.reduce((t, l) => t + (nb(l.loyer_marche) || nb(l.loyer)), 0);
    pl.innerHTML = `<tr><td>Total</td><td class="num">${argent(tot)}</td><td class="num">${logs.some(l => nb(l.loyer_marche)) ? argent(totM) : ''}</td><td colspan="3" class="discret petit">${argent(tot * 12)} par an</td></tr>`;
  }

  // Dépenses
  for (const l of a.ex.lignes) {
    const cell = document.getElementById('norm-' + l.cle);
    if (cell) cell.innerHTML = `${argent(l.norm)}${l.ajuste ? `<div class="discret mini-note">${esc(l.note || 'ajusté')}</div>` : ''}`;
  }
  const inocc = a.ex.lignes.find(l => l.cle === 'inoccupation');
  const reserve = a.ex.lignes.find(l => l.cle === 'reserve');
  $('#pied-depenses').innerHTML = `
    ${reserve ? `<tr><td>Réserve de remplacement</td><td class="num">—</td><td class="num">${argent(reserve.norm)}</td></tr>` : ''}
    <tr class="total"><td>Total des dépenses</td><td class="num">${argent(a.ex.depReelles)}</td><td class="num">${argent(a.ex.depNorm)}</td></tr>
    <tr><td>Revenus bruts</td><td></td><td class="num">${argent(a.rba)}</td></tr>
    <tr><td>${esc(inocc.nom)}</td><td></td><td class="num">− ${argent(inocc.norm)}</td></tr>
    <tr class="total"><td>Revenu net d'exploitation (RNE)</td><td></td><td class="num">${argent(a.rne)}</td></tr>
    <tr><td class="discret">Ratio des dépenses (avec inoccupation)</td><td></td><td class="num discret">${pct(a.ratioDep, 1)}</td></tr>`;

  // Financement
  for (const sc of SCENARIOS) {
    const f = a.fin[sc.cle];
    $('#fin-' + sc.cle).innerHTML = `
      <div class="badge-rcd ${!a.rne ? '' : f.passe ? 'ok' : 'non'}">${!a.rne ? 'Entre les revenus' : f.passe ? `Passe à ${pct(f.ltv, 0)}` : `Ne passe pas à ${pct(f.ltv, 0)}`}<small>RCD ${nombre(f.rcdAuMax)} · exigé ${nombre(f.rcd)}</small></div>
      <dl>
      <dt>Prêt accordé</dt><dd>${argent(f.pret)} <small>(${pct(f.ltvEffectif, 1)})</small></dd>
      <dt>Limité par</dt><dd>${f.limite}</dd>
      ${f.prime ? `<dt>Prime SCHL ajoutée</dt><dd>${argent(f.prime)}</dd>` : ''}
      <dt>Paiement</dt><dd>${argent(f.paiementMensuel)}/mois</dd>
      <dt>Mise de fonds</dt><dd>${argent(f.mise)} <small>(${pct(f.misePct, 1)})</small></dd>
      ${f.miseSupplementaire > 0 ? `<dt>dont mise en plus (RCD)</dt><dd class="neg">${argent(f.miseSupplementaire)}</dd>` : ''}
      <dt>Taxe de bienvenue</dt><dd>${argent(a.dmi)}</dd>
      <dt>Frais divers et travaux</dt><dd>${argent(a.fraisDivers + a.travaux)}</dd>
      <dt class="fort">Argent requis</dt><dd class="fort">${argent(f.cash)}</dd>
      <dt class="fort">Cash flow net</dt><dd class="fort ${f.liquidites < 0 ? 'neg' : ''}">${argent(f.cfMois)}/mois</dd>
      <dt>Par an</dt><dd class="${f.liquidites < 0 ? 'neg' : ''}">${argent(f.liquidites)}</dd>
      <dt>Par porte</dt><dd>${argent(f.cfPorteMois)}/mois</dd>
      <dt>RCD réel</dt><dd>${nombre(f.rcdReel)}</dd>
      <dt>Occupation minimale</dt><dd>${pct(f.pointMort, 1)}</dd>
      <dt>Rendement sur liquidités</dt><dd>${pct(f.rendLiquidites, 1)}</dd>
      <dt>Capitalisation an 1</dt><dd>${argent(f.capitalisation)}</dd>
      <dt>Rendement total an 1</dt><dd>${pct(f.rendTotal, 1)}</dd>
      <dt class="fort">TRI sur 10 ans</dt><dd class="fort">${f.tri === null ? '—' : pct(f.tri, 1)}</dd>
      <dt>Multiple du capital</dt><dd>${nombre(f.multiple)}×</dd>
      <dt>Récupération de la mise</dt><dd>${f.recuperation ? f.recuperation + ' ans' : 'plus de 10 ans'}</dd>
    </dl>`;
  }

  // Prix d'offre
  const p = a.potentiel;
  $('#s-offre').innerHTML = `<h2>Prix d'offre</h2>
    <div class="offres">
      <div class="offre"><span>Au TGA de ${pct(a.cibles.a, 1)}</span><strong>${argent(Math.round(a.cibles.prixA / 1000) * 1000)}</strong></div>
      <div class="offre"><span>Au TGA de ${pct(a.cibles.b, 1)}</span><strong>${argent(Math.round(a.cibles.prixB / 1000) * 1000)}</strong></div>
      <div class="offre"><span>Prix demandé</span><strong>${a.prixDemande ? argent(a.prixDemande) : '—'}</strong>${a.prixDemande && a.cibles.prixA ? `<small>${pct((a.prixDemande / a.cibles.prixA - 1) * 100, 1)} au-dessus du TGA ${pct(a.cibles.a, 1)}</small>` : ''}</div>
    </div>
    <p>${a.n && a.rba ? `Loyer moyen actuel : <strong>${argent(a.loyerMoyenActuel)}</strong> par mois. Pour que le prix analysé donne un TGA de ${pct(a.cibles.a, 1)}, il faudrait environ <strong>${argent(a.loyerMoyenRequis)}</strong> par mois, soit ${argent(a.loyerMoyenRequis - a.loyerMoyenActuel)} de plus par logement.` : ''}</p>
    ${a.prixEval ? `<p class="discret">Le prix analysé représente ${nombre(a.prixEval)} fois l'évaluation municipale.</p>` : ''}
    ${p ? `<div class="potentiel"><h3>Au loyer du marché</h3><p>Revenus de ${argent(p.rba)} (${argent(p.gainAnnuel)} de plus par an). RNE de ${argent(p.rne)}, TGA de <strong>${pct(p.tga)}</strong> au prix analysé. Valeur au TGA cible : ${argent(Math.round(p.valeurB / 1000) * 1000)} à ${argent(Math.round(p.valeurA / 1000) * 1000)}.</p></div>` : '<p class="discret petit">Astuce : entre un loyer du marché pour chaque logement afin de voir le potentiel.</p>'}`;

  // Projection
  const ans = [1, 2, 3, 5, 10];
  const rows = a.projection.filter(x => ans.includes(x.annee));
  $('#s-projection').innerHTML = `<h2>Projection sur 10 ans <span class="discret petit">(${esc(a.scenarioProjection)})</span></h2>
    <div class="defile"><table class="grille compacte"><thead><tr><th>Année</th>${rows.map(r => `<th class="num">${r.annee}</th>`).join('')}</tr></thead><tbody>
      <tr><td>RNE</td>${rows.map(r => `<td class="num">${argent(r.rne)}</td>`).join('')}</tr>
      <tr><td>Liquidités</td>${rows.map(r => `<td class="num ${r.liquidites < 0 ? 'neg' : ''}">${argent(r.liquidites)}</td>`).join('')}</tr>
      <tr><td>Liquidités cumulées</td>${rows.map(r => `<td class="num">${argent(r.cumul)}</td>`).join('')}</tr>
      <tr><td>Valeur</td>${rows.map(r => `<td class="num">${argent(r.valeur)}</td>`).join('')}</tr>
      <tr><td>Solde du prêt</td>${rows.map(r => `<td class="num">${argent(r.solde)}</td>`).join('')}</tr>
      <tr class="total"><td>Équité</td>${rows.map(r => `<td class="num">${argent(r.equite)}</td>`).join('')}</tr>
    </tbody></table></div>`;
}

/* ---------- Sauvegarde ---------- */
function planifier() {
  const s = $('#sauve'); if (s) s.textContent = 'Modifications…';
  clearTimeout(etat.attente);
  etat.attente = setTimeout(sauver, 700);
}
async function sauver() {
  etat.attente = null;
  const imm = etat.courant; if (!imm) return;
  const d = imm.donnees;
  imm.nom = d.nom || 'Sans nom'; imm.ville = d.ville || ''; imm.statut = d.statut || 'À analyser';
  const { error } = await etat.sb.from('cr_immeubles').update({ nom: imm.nom, ville: imm.ville, statut: imm.statut, donnees: d }).eq('id', imm.id);
  const s = $('#sauve');
  if (error) { if (s) s.textContent = 'Non enregistré'; toast('Enregistrement impossible : ' + error.message, 6000); return; }
  imm.modifie_le = new Date().toISOString();
  if (s) s.textContent = 'Enregistré ✓';
}
async function flush() { await flushContacts(); if (etat.attente) { clearTimeout(etat.attente); await sauver(); } if (etat.attenteReglages) { clearTimeout(etat.attenteReglages); await sauverReglages(); } }
window.addEventListener('beforeunload', e => { if (etat.attente || etat.attenteReglages || contactsEnAttente()) { flush(); e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

/* ---------- Comparaison ---------- */
function vueComparer(ids) {
  const items = ids.map(id => etat.immeubles.find(i => i.id === id)).filter(Boolean)
    .map(i => ({ i, a: analyser(i.donnees || {}, etat.profil.reglages) }));
  const lignes = [
    ['Ville', x => esc(x.i.ville || ''), null],
    ['Statut', x => esc(x.i.statut), null],
    ['Logements', x => x.a.n || '—', null],
    ['Prix analysé', x => argent(x.a.prix), null],
    ['Prix par porte', x => argent(x.a.prixPorte), x => -x.a.prixPorte],
    ['Revenus bruts', x => argent(x.a.rba), null],
    ['RNE', x => argent(x.a.rne), x => x.a.rne],
    ['TGA', x => pct(x.a.tga), x => x.a.tga],
    ['MRB', x => nombre(x.a.mrb), x => -x.a.mrb],
    ['Ratio des dépenses', x => pct(x.a.ratioDep, 1), null],
    ['Loyer moyen', x => argent(x.a.loyerMoyenActuel), null],
    ['RCD SCHL au prêt max', x => `${nombre(x.a.fin.schl.rcdAuMax)} ${x.a.fin.schl.passe ? '(passe)' : '(ne passe pas)'}`, x => x.a.fin.schl.rcdAuMax],
    ['Cash flow net SCHL /mois', x => argent(x.a.fin.schl.cfMois), x => x.a.fin.schl.cfMois],
    ['Argent requis SCHL', x => argent(x.a.fin.schl.cash), x => -x.a.fin.schl.cash],
    ['Liquidités SCHL /an', x => argent(x.a.fin.schl.liquidites), x => x.a.fin.schl.liquidites],
    ['Liquidités SCHL /porte/mois', x => argent(x.a.fin.schl.cfPorteMois), x => x.a.fin.schl.cfPorteMois],
    ['Rendement total an 1 SCHL', x => pct(x.a.fin.schl.rendTotal, 1), x => x.a.fin.schl.rendTotal],
    ['TRI 10 ans SCHL', x => x.a.fin.schl.tri === null ? '—' : pct(x.a.fin.schl.tri, 1), x => x.a.fin.schl.tri ?? -999],
    ['Occupation minimale SCHL', x => pct(x.a.fin.schl.pointMort, 1), x => -x.a.fin.schl.pointMort],
    ['Argent requis conventionnel', x => argent(x.a.fin.conv.cash), x => -x.a.fin.conv.cash],
    ['Liquidités conv. /porte/mois', x => argent(x.a.fin.conv.cfPorteMois), x => x.a.fin.conv.cfPorteMois],
    ['Prix au TGA cible', x => `${argent(Math.round(x.a.cibles.prixB / 1000) * 1000)} à ${argent(Math.round(x.a.cibles.prixA / 1000) * 1000)}`, null],
    ['Équité dans 10 ans', x => argent(x.a.projection[9].equite), x => x.a.projection[9].equite]
  ];
  $('#vue').innerHTML = `<div class="barre"><div><a href="#/" class="lien">← Immeubles</a><h1>Comparaison</h1></div></div>
    ${items.length < 2 ? '<div class="vide"><p>Choisis au moins deux immeubles dans la liste.</p></div>' : `
    <div class="defile"><table class="grille comparer"><thead><tr><th></th>${items.map(x => `<th><a href="#/i/${x.i.id}">${esc(x.i.nom)}</a></th>`).join('')}</tr></thead>
    <tbody>${lignes.map(([nom, f, score]) => {
      let meilleur = -1;
      if (score) { let m = -Infinity; items.forEach((x, k) => { const v = score(x); if (isFinite(v) && v > m && x.a.prix) { m = v; meilleur = k; } }); }
      return `<tr><td>${nom}</td>${items.map((x, k) => `<td class="num ${k === meilleur ? 'meilleur' : ''}">${f(x)}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>
    <p class="discret petit">En vert : le meilleur de chaque ligne.</p>`}`;
}

/* ---------- Réglages ---------- */
function vueReglages() {
  const r = etat.profil.reglages;
  r.hyp = r.hyp || {}; r.fin = r.fin || {}; r.cibles = r.cibles || {}; r.seuils = r.seuils || {};
  SCENARIOS.forEach(s => { r.fin[s.cle] = r.fin[s.cle] || {}; });
  const D = REGLAGES_DEFAUT;
  const rc = (chemin, libelle, def, suf = '', aide = '') => {
    const v = lire(r, chemin);
    return `<label class="champ"><span>${libelle}</span><div class="avec-suf"><input data-r="${chemin}" inputmode="decimal" value="${esc(champNombre(v))}" placeholder="${esc(champNombre(def))}">${suf ? `<span class="suf">${suf}</span>` : ''}</div>${aide ? `<small>${esc(aide)}</small>` : ''}</label>`;
  };
  const dmi = Array.isArray(r.dmi) && r.dmi.length ? r.dmi : JSON.parse(JSON.stringify(D.dmi));
  $('#vue').innerHTML = `<div class="barre"><h1>Réglages</h1><span id="sauve-r" class="discret petit"></span></div>
    <p class="discret">Ces valeurs s'appliquent à tous tes immeubles, sauf quand tu les changes dans un immeuble. Laisse vide pour garder la valeur proposée (en gris).</p>
    <div class="fiche"><div class="colonne">
    <section class="carte"><h2>Profil</h2><div class="champs">
      <label class="champ"><span>Nom affiché dans les rapports</span><input id="r-nom" value="${esc(etat.profil.nom || '')}"></label>
      <label class="champ"><span>Courriel</span><input value="${esc(etat.profil.courriel)}" disabled></label>
    </div></section>
    <section class="carte"><h2>Dépenses normalisées</h2><div class="champs">
      ${rc('hyp.inoccupation', 'Inoccupation', D.hyp.inoccupation, '%')}
      ${rc('hyp.gestion_pct', 'Gestion', D.hyp.gestion_pct, '%', 'Pourcentage des revenus effectifs')}
      ${rc('hyp.entretien_porte', 'Entretien par porte', D.hyp.entretien_porte, '$')}
      ${rc('hyp.reserve_porte', 'Réserve de remplacement par porte', D.hyp.reserve_porte, '$')}
      ${rc('hyp.conciergerie_porte', 'Conciergerie par porte', D.hyp.conciergerie_porte, '$')}
      ${rc('hyp.conciergerie_seuil', 'Conciergerie à partir de', D.hyp.conciergerie_seuil, 'logements')}
      ${rc('hyp.frais_divers_pct', 'Frais d\'acquisition divers', D.hyp.frais_divers_pct, '% du prix')}
    </div></section>
    <section class="carte"><h2>Croissance</h2><div class="champs">
      ${rc('hyp.appreciation', 'Appréciation annuelle', D.hyp.appreciation, '%')}
      ${rc('hyp.hausse_loyers', 'Hausse des loyers par an', D.hyp.hausse_loyers, '%')}
      ${rc('hyp.hausse_depenses', 'Hausse des dépenses par an', D.hyp.hausse_depenses, '%')}
      ${rc('hyp.frais_vente', 'Frais de revente (pour le TRI)', D.hyp.frais_vente, '%')}
      <label class="champ"><span>Scénario principal (résumé, liste, projection)</span><select id="r-scenario">${SCENARIOS.map(s => `<option value="${s.cle}" ${(r.scenario_projection || 'schl') === s.cle ? 'selected' : ''}>${s.nom}</option>`).join('')}</select></label>
    </div></section>
    <section class="carte"><h2>Financement par défaut</h2><div class="scenarios">${SCENARIOS.map(s => `<div class="scenario"><h3>${s.nom}</h3><div class="champs serre">
      ${rc(`fin.${s.cle}.taux`, 'Taux', D.fin[s.cle].taux, '%')}
      ${rc(`fin.${s.cle}.amort`, 'Amortissement', D.fin[s.cle].amort, 'ans')}
      ${rc(`fin.${s.cle}.ltv`, 'Prêt max', D.fin[s.cle].ltv, '%')}
      ${rc(`fin.${s.cle}.rcd`, 'RCD exigé', D.fin[s.cle].rcd)}
      ${rc(`fin.${s.cle}.prime`, 'Prime SCHL', D.fin[s.cle].prime, '%')}
    </div></div>`).join('')}</div>
    <p class="discret petit">Mets à jour les taux selon ce que ton prêteur te donne.</p></section>
    <section class="carte"><h2>Cibles et couleurs</h2><div class="champs">
      ${rc('cibles.tga_a', 'TGA cible A', D.cibles.tga_a, '%')}
      ${rc('cibles.tga_b', 'TGA cible B', D.cibles.tga_b, '%')}
      ${rc('seuils.tga_bon', 'TGA vert à partir de', D.seuils.tga_bon, '%')}
      ${rc('seuils.tga_ok', 'TGA jaune à partir de', D.seuils.tga_ok, '%')}
      ${rc('seuils.mrb_bon', 'MRB vert jusqu\'à', D.seuils.mrb_bon)}
      ${rc('seuils.mrb_ok', 'MRB jaune jusqu\'à', D.seuils.mrb_ok)}
      ${rc('seuils.cf_bon', 'Liquidités vertes à partir de', D.seuils.cf_bon, '$/porte/mois')}
      ${rc('seuils.cf_ok', 'Liquidités jaunes à partir de', D.seuils.cf_ok, '$/porte/mois')}
    </div></section>
    <section class="carte"><h2>Taxe de bienvenue (droits de mutation)</h2>
      <p class="discret petit">Tranches provinciales 2026. Certaines villes appliquent un taux plus élevé au-delà de 500 000 $ (jusqu'à 3 %). Vérifie auprès de la ville de l'immeuble.</p>
      <table class="grille compacte"><thead><tr><th>Jusqu'à</th><th class="num">Taux</th></tr></thead><tbody>
      ${dmi.map((t, k) => `<tr><td>${t.jusqua === null || t.jusqua === '' ? 'Au-delà' : `<input class="mini-champ" data-dmi="${k}.jusqua" inputmode="decimal" value="${esc(champNombre(t.jusqua))}">`}</td><td class="num"><input class="mini-champ" data-dmi="${k}.taux" inputmode="decimal" value="${esc(champNombre(t.taux))}"> %</td></tr>`).join('')}
      </tbody></table>
      <button class="lien" id="b-dmi-defaut">Revenir aux tranches de 2026</button>
    </section>
    <section class="carte"><h2>Copie de sécurité</h2>
      <p class="discret petit">Tes données sont déjà dans la base de données Supabase. Ceci te donne en plus un fichier à garder sur ton ordinateur.</p>
      <div class="barre-actions"><button class="btn" id="b-export">Exporter mes immeubles</button>
      <label class="btn">Importer une copie<input type="file" accept="application/json" hidden id="f-json"></label></div>
    </section>
    </div></div>`;

  const v = $('#vue');
  v.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.r) { ecrire(r, el.dataset.r, el.value.trim() === '' ? '' : nb(el.value)); planifierReglages(); }
    if (el.dataset.dmi) { r.dmi = dmi; const [k, c] = el.dataset.dmi.split('.'); dmi[+k][c] = nb(el.value); planifierReglages(); }
    if (el.id === 'r-nom') { etat.profil.nom = el.value; planifierReglages(); }
  });
  v.addEventListener('focusout', e => { const el = e.target; if ((el.dataset.r || el.dataset.dmi) && el.value.trim() !== '') el.value = champNombre(el.value); });
  $('#r-scenario').onchange = e => { r.scenario_projection = e.target.value; planifierReglages(); };
  $('#b-dmi-defaut').onclick = () => { delete r.dmi; planifierReglages(); vueReglages(); };
  $('#b-export').onclick = exporter;
  $('#f-json').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importerJson(f); };
}
function planifierReglages() {
  const s = $('#sauve-r'); if (s) s.textContent = 'Modifications…';
  clearTimeout(etat.attenteReglages);
  etat.attenteReglages = setTimeout(sauverReglages, 700);
}
async function sauverReglages() {
  etat.attenteReglages = null;
  const { error } = await etat.sb.from('cr_profils').update({ reglages: etat.profil.reglages, nom: etat.profil.nom }).eq('id', etat.profil.id);
  const s = $('#sauve-r');
  if (error) { toast('Réglages non enregistrés : ' + error.message, 5000); if (s) s.textContent = 'Non enregistré'; return; }
  if (s) s.textContent = 'Enregistré ✓';
}

function exporter() {
  const mien = etat.immeubles.filter(i => i.user_id === etat.session.user.id);
  const blob = new Blob([JSON.stringify({ app: 'cruncher', version: 1, exporte_le: new Date().toISOString(), reglages: etat.profil.reglages, immeubles: mien.map(i => ({ nom: i.nom, ville: i.ville, statut: i.statut, donnees: i.donnees, cree_le: i.cree_le })) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cruncher-copie-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importerJson(f) {
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'cruncher' || !Array.isArray(j.immeubles)) throw new Error('Ce fichier n\'est pas une copie du Cruncher.');
    if (!confirm(`Ajouter ${j.immeubles.length} immeuble(s) à ton compte? Rien ne sera effacé.`)) return;
    voile('Importation…');
    for (const i of j.immeubles) { const d = i.donnees || {}; delete d.fiche_pdf; await creerImmeuble({ ...d, nom: d.nom || i.nom, statut: i.statut }); }
    finVoile(); toast('Copie importée.'); aller('#/');
  } catch (e) { finVoile(); toast('Import impossible : ' + e.message, 5000); }
}

/* ---------- Utilisateurs (admin) ---------- */
function vueUtilisateurs() {
  const compte = id => etat.immeubles.filter(i => i.user_id === id).length;
  $('#vue').innerHTML = `<div class="barre"><h1>Utilisateurs</h1></div>
    <section class="carte"><h2>Inviter quelqu'un</h2>
      <form id="f-inviter" class="champs">
        <label class="champ"><span>Nom</span><input name="nom" required></label>
        <label class="champ"><span>Courriel</span><input name="courriel" type="email" required></label>
        <div class="champ"><span>&nbsp;</span><button class="btn principal" type="submit">Envoyer l'invitation</button></div>
      </form>
      <p class="discret petit">La personne reçoit un courriel pour choisir son mot de passe. Elle voit seulement ses propres immeubles. Toi, tu vois tout.</p>
    </section>
    <section class="carte"><h2>Comptes</h2><div class="defile"><table class="grille"><thead><tr><th>Nom</th><th>Courriel</th><th class="num">Immeubles</th><th>Rôle</th><th></th></tr></thead><tbody>
      ${etat.profils.map(p => `<tr><td>${esc(p.nom || '')}</td><td>${esc(p.courriel)}</td><td class="num">${compte(p.id)}</td><td>${p.est_admin ? 'Administrateur' : 'Utilisateur'}</td>
      <td>${p.id !== etat.session.user.id ? `<button class="btn mini danger" data-retirer-u="${p.id}">Retirer l'accès</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div></section>`;
  $('#f-inviter').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    voile('Envoi de l\'invitation…');
    try {
      const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await jeton() },
        body: JSON.stringify({ action: 'inviter', nom: f.get('nom'), courriel: f.get('courriel'), origine: location.origin }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erreur || 'Erreur ' + r.status);
      await chargerProfils();
      finVoile();
      toast(j.existant ? 'Ce compte existait déjà : il a maintenant accès au Cruncher.' : 'Invitation envoyée.', 4000);
      vueUtilisateurs();
    } catch (err) { finVoile(); toast('Invitation impossible : ' + err.message, 6000); }
  };
  document.querySelectorAll('[data-retirer-u]').forEach(b => b.onclick = async () => {
    const p = etat.profils.find(x => x.id === b.dataset.retirerU);
    if (!confirm(`Retirer l'accès de ${p.nom || p.courriel}? Ses immeubles seront effacés.`)) return;
    const { error } = await etat.sb.from('cr_profils').delete().eq('id', p.id);
    if (error) return toast('Impossible : ' + error.message, 5000);
    etat.profils = etat.profils.filter(x => x.id !== p.id);
    etat.immeubles = etat.immeubles.filter(i => i.user_id !== p.id);
    vueUtilisateurs();
  });
}

export { etat, $, esc, toast, voile, finVoile, jeton, aller, proprio, dateCourte };

demarrer().catch(e => { app.innerHTML = `<div class="porte"><div class="porte-boite">${logo()}<p>Erreur au démarrage : ${esc(e.message)}</p></div></div>`; });
