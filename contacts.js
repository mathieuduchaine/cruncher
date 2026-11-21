// Section Contacts : carnet des contacts immobiliers, avec numérisation des cartes d'affaires.
import { etat, $, esc, toast, voile, finVoile, jeton, aller, proprio, dateCourte } from './app.js';

export const CATEGORIES = [
  'Courtier immobilier', 'Prêteur / banque', 'Courtier hypothécaire', 'Notaire', 'Avocat', 'Comptable / fiscaliste',
  'Évaluateur agréé', 'Inspecteur en bâtiment', 'Entrepreneur général', 'Électricien', 'Plombier', 'Toiture',
  'Chauffage / thermopompes', 'Efficacité énergétique', 'Internet / télécom', 'Assureur', 'Gestionnaire immobilier',
  'Concierge / entretien', 'Déneigement / paysagement', 'Investisseur', 'Vendeur', 'Ville / municipalité', 'Autre'
];

const CHAMPS = [
  ['nom', 'Nom complet'], ['entreprise', 'Entreprise'], ['titre', 'Titre ou métier'],
  ['telephone', 'Téléphone'], ['cellulaire', 'Cellulaire'], ['courriel', 'Courriel'],
  ['site', 'Site web'], ['adresse', 'Adresse'], ['rencontre', 'Où je l\'ai rencontré']
];

let attente = null;
const urls = new Map(); // chemin -> { url, expire }

async function urlPhoto(chemin) {
  if (!chemin) return '';
  const c = urls.get(chemin);
  if (c && c.expire > Date.now()) return c.url;
  const { data } = await etat.sb.storage.from('cr-fiches').createSignedUrl(chemin, 3600);
  if (!data) return '';
  urls.set(chemin, { url: data.signedUrl, expire: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function chargerContacts() {
  const { data, error } = await etat.sb.from('cr_contacts').select('*').order('modifie_le', { ascending: false });
  etat.contacts = error ? [] : (data || []);
  etat.contactsErreur = error ? error.message : '';
}

// Réduit la photo (max 1600 px) pour l'envoyer et la garder légère.
function reduire(fichier, max = 1600) {
  return new Promise((ok, ko) => {
    const img = new Image();
    const u = URL.createObjectURL(fichier);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * r); cv.height = Math.round(img.height * r);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(u);
      cv.toBlob(b => b ? ok(b) : ko(new Error('Photo illisible')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(u); ko(new Error('Format de photo non pris en charge')); };
    img.src = u;
  });
}
function enBase64(blob) {
  return new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
}

/* ---------- Appareil photo dans la page (Mac : iPhone par Caméra de continuité) ---------- */
const estMobile = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) && window.innerWidth < 1100);
function lireCamera() { try { return localStorage.getItem('cruncher-camera') || ''; } catch { return ''; } }
function garderCamera(id) { try { localStorage.setItem('cruncher-camera', id); } catch { /* rien */ } }

function ouvrirCamera(titre) {
  return new Promise(async (ok, annule) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return annule(new Error('Ce navigateur ne permet pas d\'utiliser la caméra.'));
    const fond = document.createElement('div');
    fond.className = 'camera-fond';
    fond.innerHTML = `<div class="camera-boite">
      <div class="camera-tete"><strong>${esc(titre)}</strong>
        <div class="camera-choix"><label class="discret petit" for="cam-choix">Caméra</label><select id="cam-choix"></select><button class="btn mini" id="cam-chercher">Chercher mon iPhone</button></div></div>
      <p class="camera-aide" id="cam-aide" hidden>Ton iPhone n'est pas détecté. Verrouille-le, pose-le immobile à l'horizontale près du Mac, puis clique sur « Chercher mon iPhone ». Il apparaîtra dans le menu Caméra.</p>
      <div class="camera-vue"><video id="cam-video" playsinline autoplay muted></video><div class="camera-cadre"></div><p id="cam-msg">Connexion à la caméra…</p></div>
      <p class="discret petit centre">Ton iPhone devrait s'allumer tout seul s'il est près du Mac. Place la carte dans le cadre.</p>
      <div class="camera-actions"><button class="btn" id="cam-annuler">Annuler</button><button class="btn principal" id="cam-prendre" disabled>Prendre la photo</button></div>
    </div>`;
    document.body.appendChild(fond);
    const video = fond.querySelector('#cam-video'), choix = fond.querySelector('#cam-choix'), msg = fond.querySelector('#cam-msg'), prendre = fond.querySelector('#cam-prendre');
    let flux = null;
    const arreter = () => { if (flux) flux.getTracks().forEach(t => t.stop()); flux = null; };
    let surChangement = null;
    const fermer = () => { arreter(); fond.remove(); if (surChangement) navigator.mediaDevices.removeEventListener('devicechange', surChangement); };
    const demarrer = async (deviceId) => {
      arreter(); prendre.disabled = true; msg.hidden = false; msg.textContent = 'Connexion à la caméra…';
      try {
        flux = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1440 } } : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        video.srcObject = flux; await video.play().catch(() => {});
        msg.hidden = true; prendre.disabled = false;
        const actuel = flux.getVideoTracks()[0].getSettings().deviceId;
        return actuel;
      } catch (e) {
        msg.textContent = e.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorise la caméra pour ce site dans Safari (Réglages pour ce site web).' : 'Caméra introuvable : ' + e.message;
        return null;
      }
    };
    fond.querySelector('#cam-annuler').onclick = () => { fermer(); annule(new Error('annule')); };
    choix.onchange = async () => { garderCamera(choix.value); await demarrer(choix.value); };
    prendre.onclick = () => {
      const cv = document.createElement('canvas');
      cv.width = video.videoWidth; cv.height = video.videoHeight;
      cv.getContext('2d').drawImage(video, 0, 0);
      cv.toBlob(b => { fermer(); b ? ok(b) : annule(new Error('Photo vide')); }, 'image/jpeg', 0.9);
    };
    const aide = fond.querySelector('#cam-aide');
    let actuel = null;
    const lister = async (basculerVersIphone) => {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const iphone = cams.find(d => /iphone|continuit/i.test(d.label));
      if (basculerVersIphone && iphone && iphone.deviceId !== actuel) {
        const r = await demarrer(iphone.deviceId);
        if (r) { actuel = r; garderCamera(iphone.deviceId); }
      }
      choix.innerHTML = cams.length
        ? cams.map((d, k) => `<option value="${esc(d.deviceId)}" ${d.deviceId === actuel ? 'selected' : ''}>${esc(d.label || 'Caméra ' + (k + 1))}</option>`).join('')
        : '<option>Aucune caméra</option>';
      aide.hidden = !!iphone;
      return !!iphone;
    };
    // Premier démarrage, puis choix automatique de l'iPhone s'il est disponible.
    actuel = await demarrer(lireCamera() || undefined);
    if (actuel === null && lireCamera()) actuel = await demarrer();
    await lister(!lireCamera());
    // Si l'iPhone se connecte pendant que la fenêtre est ouverte, on bascule dessus.
    surChangement = () => { if (document.body.contains(fond)) lister(true); };
    navigator.mediaDevices.addEventListener('devicechange', surChangement);
    fond.querySelector('#cam-chercher').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Recherche…';
      let trouve = await lister(true);
      for (let k = 0; !trouve && k < 5; k++) { await new Promise(r => setTimeout(r, 1500)); trouve = await lister(true); }
      e.target.disabled = false; e.target.textContent = 'Chercher mon iPhone';
      if (!trouve) toast('iPhone introuvable. Vérifie qu\'il est verrouillé, immobile et à l\'horizontale, avec Wi-Fi et Bluetooth.', 6000);
    };
  });
}

// Sur iPhone : l'appareil photo natif. Sur ordinateur : la caméra dans la page.
async function photographier(titre, inputMobile) {
  if (estMobile()) { inputMobile.click(); return null; }
  try { return await ouvrirCamera(titre); }
  catch (e) { if (e.message !== 'annule') { toast(e.message + ' Choisis plutôt une photo.', 5000); } return null; }
}

async function creerContact(donnees) {
  const d = { categorie: 'Autre', notes: '', photos: [], ...donnees };
  const ligne = { user_id: etat.session.user.id, nom: d.nom || 'Nouveau contact', entreprise: d.entreprise || '', categorie: d.categorie, donnees: d };
  const { data, error } = await etat.sb.from('cr_contacts').insert(ligne).select().single();
  if (error) throw new Error(error.message);
  etat.contacts.unshift(data);
  return data;
}

async function televerser(contact, blob, cote) {
  const chemin = `${contact.user_id}/contacts/${contact.id}-${cote}-${Date.now()}.jpg`;
  const { error } = await etat.sb.storage.from('cr-fiches').upload(chemin, blob, { upsert: true, contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  return chemin;
}

async function lireCarte(blobs) {
  const images = [];
  for (const b of blobs) images.push(await enBase64(b));
  const r = await fetch('/api/carte', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await jeton() },
    body: JSON.stringify({ images, categories: CATEGORIES })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erreur || 'Erreur ' + r.status);
  return j.donnees || {};
}

function nettoyer(x) {
  const d = {};
  for (const [k] of CHAMPS) d[k] = x[k] ? String(x[k]) : '';
  d.categorie = CATEGORIES.includes(x.categorie) ? x.categorie : 'Autre';
  d.notes = x.notes ? String(x.notes) : '';
  if (!d.nom) d.nom = d.entreprise || 'Contact sans nom';
  return d;
}

async function numeriser(fichier) {
  try {
    voile('Préparation de la photo…');
    const blob = await reduire(fichier);
    voile('Lecture de la carte…');
    let d = {};
    try { d = nettoyer(await lireCarte([blob])); }
    catch (e) { toast('Lecture automatique impossible (' + e.message + '). La photo est gardée : remplis la fiche à la main.', 6000); d = { nom: 'Carte à compléter', categorie: 'Autre' }; }
    d.rencontre = d.rencontre || '';
    voile('Enregistrement…');
    const c = await creerContact(d);
    const chemin = await televerser(c, blob, 'recto');
    c.donnees.photos = [chemin];
    await etat.sb.from('cr_contacts').update({ donnees: c.donnees }).eq('id', c.id);
    finVoile();
    toast('Carte numérisée. Vérifie les informations.', 3500);
    aller('#/c/' + c.id);
  } catch (e) { finVoile(); toast('Numérisation impossible : ' + e.message, 6000); }
}

// Complète la fiche sans écraser ce qui est déjà rempli.
function fusionner(d, nouv) {
  const vides = ['', 'Carte à compléter', 'Contact sans nom', 'Nouveau contact', 'Sans nom'];
  let change = 0;
  for (const [k] of CHAMPS) {
    if (k === 'rencontre' || !nouv[k]) continue;
    const actuel = String(d[k] || '').trim();
    const remplacable = !actuel || (k === 'nom' && (vides.includes(actuel) || actuel === d.entreprise));
    if (remplacable && nouv[k] !== actuel) { d[k] = nouv[k]; change++; }
  }
  if ((!d.categorie || d.categorie === 'Autre') && nouv.categorie && nouv.categorie !== 'Autre') { d.categorie = nouv.categorie; change++; }
  if (nouv.notes && !String(d.notes || '').includes(nouv.notes)) { d.notes = d.notes ? d.notes + '\n' + nouv.notes : nouv.notes; change++; }
  return change;
}

async function blobDe(chemin) {
  const u = await urlPhoto(chemin);
  if (!u) throw new Error('Photo introuvable');
  const r = await fetch(u);
  if (!r.ok) throw new Error('Photo introuvable');
  return r.blob();
}

// Relit toutes les photos de la carte (recto et verso) et complète la fiche.
async function relire(c, blobsConnus = {}) {
  const d = c.donnees;
  const blobs = [];
  for (const ch of d.photos.slice(0, 2)) blobs.push(blobsConnus[ch] || await blobDe(ch));
  const nouv = nettoyer(await lireCarte(blobs));
  return fusionner(d, nouv);
}

/* ---------- Liste ---------- */
export async function vueContacts() {
  if (!etat.contacts) await chargerContacts();
  const v = $('#vue');
  v.innerHTML = `<div class="barre">
      <h1>Contacts</h1>
      <div class="barre-actions">
        <button class="btn principal" id="b-numeriser">Numériser une carte</button><input type="file" accept="image/*" capture="environment" hidden id="f-carte">
        <label class="btn">Choisir une photo<input type="file" accept="image/*" hidden id="f-carte-photo"></label>
        <button class="btn" id="b-contact">Ajouter à la main</button>
      </div>
    </div>
    ${etat.contactsErreur ? `<div class="verdict"><p class="avertir">La section Contacts n'est pas encore installée dans Supabase : roule le fichier supabase-contacts.txt dans SQL Editor. (${esc(etat.contactsErreur)})</p></div>` : ''}
    <div class="filtres">
      <input type="search" id="f-rech-c" placeholder="Rechercher un nom, une entreprise, un métier" value="${esc(etat.rechContacts || '')}">
      <select id="f-cat"><option value="">Toutes les catégories</option>${CATEGORIES.map(c => `<option ${c === etat.catContacts ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </div>
    <div id="liste-contacts" class="contacts"></div>`;
  dessiner();
  $('#f-carte').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) numeriser(f); };
  $('#b-numeriser').onclick = async () => { const b = await photographier('Numériser une carte d\'affaires', $('#f-carte')); if (b) numeriser(b); };
  $('#f-carte-photo').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) numeriser(f); };
  $('#b-contact').onclick = async () => {
    try { const c = await creerContact({ nom: '' }); aller('#/c/' + c.id); } catch (e) { toast('Création impossible : ' + e.message, 5000); }
  };
  $('#f-rech-c').oninput = e => { etat.rechContacts = e.target.value; dessiner(); };
  $('#f-cat').onchange = e => { etat.catContacts = e.target.value; dessiner(); };
}

function dessiner() {
  const z = $('#liste-contacts');
  const q = (etat.rechContacts || '').toLowerCase();
  const liste = etat.contacts.filter(c => {
    const d = c.donnees || {};
    const texte = `${d.nom} ${d.entreprise} ${d.titre} ${d.categorie} ${d.notes} ${d.rencontre} ${d.adresse}`.toLowerCase();
    return (!q || texte.includes(q)) && (!etat.catContacts || d.categorie === etat.catContacts);
  }).sort((a, b) => (a.donnees.categorie || '').localeCompare(b.donnees.categorie || '', 'fr') || (a.donnees.nom || '').localeCompare(b.donnees.nom || '', 'fr'));
  if (!etat.contacts.length) {
    z.innerHTML = `<div class="vide"><p>Aucun contact pour l'instant.</p><p class="discret">Sur ton iPhone, touche « Numériser une carte » : l'appareil photo s'ouvre, tu prends la carte en photo et le Cruncher remplit la fiche.</p></div>`;
    return;
  }
  if (!liste.length) { z.innerHTML = '<p class="discret">Aucun contact ne correspond.</p>'; return; }
  let cat = null, html = '';
  for (const c of liste) {
    const d = c.donnees || {};
    if (d.categorie !== cat) { cat = d.categorie; html += `<h3 class="cat-contacts">${esc(cat || 'Autre')}</h3>`; }
    const tel = d.cellulaire || d.telephone;
    html += `<div class="contact" data-id="${c.id}">
      <div class="contact-photo" data-photo="${esc((d.photos || [])[0] || '')}">${(d.photos || []).length ? '' : `<span>${esc((d.nom || '?').slice(0, 1).toUpperCase())}</span>`}</div>
      <div class="contact-texte"><strong>${esc(d.nom || 'Sans nom')}</strong>
        <div class="discret petit">${esc([d.titre, d.entreprise].filter(Boolean).join(' · '))}</div>
        ${etat.profil.est_admin && c.user_id !== etat.session.user.id ? `<div class="discret petit">Compte de ${esc(proprio(c.user_id))}</div>` : ''}
      </div>
      <div class="contact-actions">
        ${tel ? `<a class="btn mini" href="tel:${esc(tel.replace(/[^\d+]/g, ''))}" data-stop>Appeler</a>` : ''}
        ${d.courriel ? `<a class="btn mini" href="mailto:${esc(d.courriel)}" data-stop>Courriel</a>` : ''}
      </div>
    </div>`;
  }
  z.innerHTML = html;
  z.querySelectorAll('.contact').forEach(el => el.onclick = e => { if (e.target.closest('[data-stop]')) return; aller('#/c/' + el.dataset.id); });
  z.querySelectorAll('[data-photo]').forEach(async el => {
    const ch = el.dataset.photo; if (!ch) return;
    const u = await urlPhoto(ch);
    if (u) el.style.backgroundImage = `url("${u}")`;
  });
}

/* ---------- Fiche d'un contact ---------- */
export async function vueContact(id) {
  if (!etat.contacts) await chargerContacts();
  const c = etat.contacts.find(x => x.id === id);
  if (!c) { $('#vue').innerHTML = `<div class="vide"><p>Contact introuvable.</p><a href="#/contacts" class="btn">Retour</a></div>`; return; }
  c.donnees = c.donnees || {};
  const d = c.donnees; d.photos = d.photos || [];
  etat.contactCourant = c;
  $('#vue').innerHTML = `
    <div class="barre fiche-barre">
      <div><a href="#/contacts" class="lien">← Contacts</a><h1 id="titre-c">${esc(d.nom || 'Sans nom')}</h1>
        <div class="discret petit">${esc(d.categorie || '')}${c.cree_le ? ' · ajouté le ' + dateCourte(c.cree_le) : ''}</div></div>
      <div class="barre-actions"><span id="sauve-c" class="discret petit"></span>
        <button class="btn" id="b-vcard">Ajouter à mes contacts iPhone</button>
        <button class="btn danger" id="b-effacer-c">Supprimer</button></div>
    </div>
    <div class="fiche-contact">
      <section class="carte">
        <h2>Coordonnées</h2>
        <div class="champs">
          <label class="champ"><span>Catégorie</span><select data-c="categorie">${CATEGORIES.map(x => `<option ${x === d.categorie ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          ${CHAMPS.map(([k, l]) => `<label class="champ"><span>${l}</span><input data-c="${k}" value="${esc(d[k] || '')}" ${k === 'courriel' ? 'type="email" autocapitalize="off"' : ''} ${k.includes('tel') || k === 'cellulaire' ? 'type="tel"' : ''}></label>`).join('')}
          <label class="champ large"><span>Notes</span><textarea data-c="notes" rows="5" placeholder="Services offerts, tarifs, recommandé par…">${esc(d.notes || '')}</textarea></label>
        </div>
        <div class="liens-rapides" id="liens-c"></div>
      </section>
      <section class="carte">
        <h2>Carte d'affaires</h2>
        <div class="photos-carte" id="photos-c"></div>
        <div class="barre-actions">
          <button class="btn" id="b-photo-c">${d.photos.length ? 'Ajouter le verso' : 'Photographier la carte'}</button><input type="file" accept="image/*" capture="environment" hidden id="f-ajout-photo">
          <label class="btn">Choisir une photo<input type="file" accept="image/*" hidden id="f-ajout-photo2"></label>
          ${d.photos.length ? '<button class="btn" id="b-relire">Relire la carte</button>' : ''}
        </div>
      </section>
    </div>`;
  liens(); photos();
  const v = $('#vue');
  const surSaisie = e => {
    const el = e.target; if (!el.dataset || !el.dataset.c) return;
    d[el.dataset.c] = el.value;
    if (el.dataset.c === 'nom') $('#titre-c').textContent = el.value || 'Sans nom';
    liens(); planifier();
  };
  v.addEventListener('input', surSaisie);
  const ajouterBlob = async f => {
    try {
      voile('Envoi de la photo…');
      const blob = await reduire(f);
      const ch = await televerser(c, blob, d.photos.length ? 'verso' : 'recto');
      d.photos.push(ch); await sauver();
      voile('Lecture de la carte…');
      let n = 0;
      try { n = await relire(c, { [ch]: blob }); }
      catch (e) { toast('Photo ajoutée, mais lecture impossible : ' + e.message, 6000); }
      await sauver(); finVoile();
      if (n) toast(`Fiche complétée avec le ${d.photos.length > 1 ? 'verso' : 'recto'}. Vérifie les informations.`, 4000);
      else toast('Photo ajoutée. Aucune nouvelle information trouvée.', 4000);
      vueContact(c.id);
    } catch (err) { finVoile(); toast('Envoi impossible : ' + err.message, 5000); }
  };
  const ajouter = e => { const f = e.target.files[0]; e.target.value = ''; if (f) ajouterBlob(f); };
  $('#f-ajout-photo').onchange = ajouter;
  $('#f-ajout-photo2').onchange = ajouter;
  $('#b-photo-c').onclick = async () => { const b = await photographier(d.photos.length ? 'Photographier le verso' : 'Photographier la carte', $('#f-ajout-photo')); if (b) ajouterBlob(b); };
  $('#b-vcard').onclick = () => vcard(d);
  if ($('#b-relire')) $('#b-relire').onclick = async () => {
    try {
      await sauver(); voile('Lecture de la carte…');
      const n = await relire(c);
      await sauver(); finVoile();
      toast(n ? 'Fiche complétée. Ce que tu avais déjà écrit n\'a pas été changé.' : 'Aucune nouvelle information trouvée sur la carte.', 4500);
      vueContact(c.id);
    } catch (e) { finVoile(); toast('Lecture impossible : ' + e.message, 6000); }
  };
  $('#b-effacer-c').onclick = async () => {
    if (!confirm(`Supprimer le contact « ${d.nom || 'sans nom'} »?`)) return;
    clearTimeout(attente); attente = null;
    const { error } = await etat.sb.from('cr_contacts').delete().eq('id', c.id);
    if (error) return toast('Suppression impossible : ' + error.message, 5000);
    if (d.photos.length) etat.sb.storage.from('cr-fiches').remove(d.photos);
    etat.contacts = etat.contacts.filter(x => x.id !== c.id);
    etat.contactCourant = null;
    toast('Contact supprimé.');
    aller('#/contacts');
  };
}

function liens() {
  const d = etat.contactCourant.donnees;
  const t = [];
  for (const k of ['cellulaire', 'telephone']) if (d[k]) t.push(`<a class="btn" href="tel:${esc(d[k].replace(/[^\d+]/g, ''))}">Appeler ${k === 'cellulaire' ? 'le cellulaire' : 'le bureau'}</a>`);
  if (d.cellulaire) t.push(`<a class="btn" href="sms:${esc(d.cellulaire.replace(/[^\d+]/g, ''))}">Texto</a>`);
  if (d.courriel) t.push(`<a class="btn" href="mailto:${esc(d.courriel)}">Écrire</a>`);
  if (d.site) t.push(`<a class="btn" href="${esc(/^https?:/.test(d.site) ? d.site : 'https://' + d.site)}" target="_blank" rel="noopener">Site web</a>`);
  if (d.adresse) t.push(`<a class="btn" href="https://maps.apple.com/?q=${encodeURIComponent(d.adresse)}" target="_blank" rel="noopener">Plan</a>`);
  $('#liens-c').innerHTML = t.join('');
}

async function photos() {
  const d = etat.contactCourant.donnees;
  const z = $('#photos-c');
  if (!d.photos.length) { z.innerHTML = '<p class="discret petit">Aucune photo de la carte.</p>'; return; }
  z.innerHTML = d.photos.map((p, k) => `<figure><a target="_blank" rel="noopener" data-k="${k}"><img alt="Carte ${k ? 'verso' : 'recto'}"></a>
    <figcaption>${k ? 'Verso' : 'Recto'} <button class="lien" data-retirer-photo="${k}">Retirer</button></figcaption></figure>`).join('');
  d.photos.forEach(async (p, k) => {
    const u = await urlPhoto(p);
    const a = z.querySelector(`a[data-k="${k}"]`);
    if (a && u) { a.href = u; a.querySelector('img').src = u; }
  });
  z.querySelectorAll('[data-retirer-photo]').forEach(b => b.onclick = async () => {
    if (!confirm('Retirer cette photo?')) return;
    const [ch] = d.photos.splice(+b.dataset.retirerPhoto, 1);
    etat.sb.storage.from('cr-fiches').remove([ch]);
    await sauver(); photos();
  });
}

function vcard(d) {
  const e = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const lignes = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${e(d.nom)}`, `N:${e(d.nom)};;;;`];
  if (d.entreprise) lignes.push(`ORG:${e(d.entreprise)}`);
  if (d.titre) lignes.push(`TITLE:${e(d.titre)}`);
  if (d.cellulaire) lignes.push(`TEL;TYPE=CELL:${e(d.cellulaire)}`);
  if (d.telephone) lignes.push(`TEL;TYPE=WORK:${e(d.telephone)}`);
  if (d.courriel) lignes.push(`EMAIL;TYPE=WORK:${e(d.courriel)}`);
  if (d.site) lignes.push(`URL:${e(d.site)}`);
  if (d.adresse) lignes.push(`ADR;TYPE=WORK:;;${e(d.adresse)};;;;`);
  lignes.push(`NOTE:${e([d.categorie, d.notes, d.rencontre ? 'Rencontré : ' + d.rencontre : ''].filter(Boolean).join(' · '))}`);
  lignes.push('END:VCARD');
  const blob = new Blob([lignes.join('\r\n')], { type: 'text/vcard' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (d.nom || 'contact').replace(/[\\/:*?"<>|]/g, '-') + '.vcf';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function planifier() {
  const s = $('#sauve-c'); if (s) s.textContent = 'Modifications…';
  clearTimeout(attente); attente = setTimeout(sauver, 700);
}
async function sauver() {
  attente = null;
  const c = etat.contactCourant; if (!c) return;
  const d = c.donnees;
  c.nom = d.nom || 'Sans nom'; c.entreprise = d.entreprise || ''; c.categorie = d.categorie || 'Autre';
  const { error } = await etat.sb.from('cr_contacts').update({ nom: c.nom, entreprise: c.entreprise, categorie: c.categorie, donnees: d }).eq('id', c.id);
  const s = $('#sauve-c');
  if (error) { if (s) s.textContent = 'Non enregistré'; toast('Enregistrement impossible : ' + error.message, 6000); return; }
  c.modifie_le = new Date().toISOString();
  if (s) s.textContent = 'Enregistré ✓';
}
export async function flushContacts() { if (attente) { clearTimeout(attente); await sauver(); } }
export function contactsEnAttente() { return !!attente; }
