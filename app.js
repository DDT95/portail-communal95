/*
 * Portail communal — fiche territoriale par commune.
 * Sources : geo.api.gouv.fr (contours/population/EPCI), RNE data.gouv.fr (élus, synchronisation août 2026),
 * Géorisques GASPAR + WMS PPRN/argiles (risques), data.geopf.fr (QPV), RNB beta.gouv.fr (bâtiments),
 * APICarto IGN — cadastre, RPG (agriculture95), nature (biodiversite95) —, data.education.gouv.fr (écoles),
 * Île-de-France Mobilités data.iledefrance-mobilites.fr (arrêts, comme bus-trains-95),
 * Cerema apidf (artificialisation-zan95), Hub'Eau (eau95), Agence ORE (transition-energetique95).
 */
'use strict';

const CFG = {
  communesApi: 'https://geo.api.gouv.fr',
  georisquesApi: 'https://www.georisques.gouv.fr/api/v1/gaspar/risques',
  georisquesWms: 'https://www.georisques.gouv.fr/services',
  rnbApi: 'https://rnb-api.beta.gouv.fr/api/alpha/ogc/collections/buildings/items',
  cadastreApi: 'https://apicarto.ign.fr/api/cadastre/parcelle',
  rpgApi: 'https://apicarto.ign.fr/api/rpg/v2',
  natureApi: 'https://apicarto.ign.fr/api/nature',
  educationApi: 'https://data.education.gouv.fr/api/records/1.0/search/',
  idfmArretsApi: 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/records',
  ceremaApi: 'https://apidf-preprod.cerema.fr/indicateurs/conso_espace/communes',
  hubeauApi: 'https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/communes_udi',
  odreApi: 'https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets/consommation-annuelle-d-electricite-et-gaz-par-commune/records',
  qpvFile: 'data/qpv_95.geojson',
  elusFile: 'data/elus_95.json',
  pdfBase: 'https://piece-jointe-carto.developpement-durable.gouv.fr/DEPT095A/DONNEE_GENERIQUE/N_BASE_COMMUNALE/OCTE/Fiches',
  zoomGated: 13
};

const state = {
  code: null, nom: null, contour: null, contourLayer: null,
  elus: null, risques: [], qpv: [], kpi: {}, zan: null, eau: null, energie: null,
  layers: {}, layerDefs: [],
  drawerMode: 'commune'
};

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '—').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
const formatNumber = n => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);

const map = L.map('map', { zoomControl: true, preferCanvas: true, zoomSnap: 0.25, zoomDelta: 1, minZoom: 10, maxZoom: 19 });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
map.createPane('riskTiles'); map.getPane('riskTiles').style.zIndex = 350; map.getPane('riskTiles').style.pointerEvents = 'none';
map.attributionControl.setPrefix('Leaflet');
map.setView([49.075, 2.105], 10);

function setLoading(on, detail) {
  const loader = $('map-loader');
  if (detail) $('loader-detail').textContent = detail;
  loader.classList.toggle('hidden', !on);
}

// ---------- Commune picker ----------
let communesIndex = [];
fetch(`${CFG.communesApi}/departements/95/communes?fields=nom,code`)
  .then(r => r.json())
  .then(list => {
    communesIndex = list.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    $('communes-list').innerHTML = communesIndex.map(c => `<option value="${escapeHtml(c.nom)}">`).join('');
  });

$('communeForm').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('communeSelect').value.trim().toLocaleLowerCase('fr');
  const match = communesIndex.find(c => c.nom.toLocaleLowerCase('fr') === query) || communesIndex.find(c => c.nom.toLocaleLowerCase('fr').startsWith(query));
  if (!match) return;
  const next = new URL(location.href);
  next.search = new URLSearchParams({ code: match.code, nom: match.nom }).toString();
  location.href = next.toString();
});

// ---------- Boot ----------
const params = new URLSearchParams(location.search);
const initialCode = params.get('code');
const initialNom = params.get('nom');
if (initialCode) {
  loadCommune(initialCode, initialNom);
} else {
  setLoading(false);
  $('communeSub').textContent = 'Choisissez une commune pour ouvrir sa fiche territoriale';
}

async function loadCommune(code, nomHint) {
  state.code = code;
  setLoading(true, 'Chargement du territoire');
  try {
    const commune = await fetch(`${CFG.communesApi}/communes/${code}?fields=nom,code,codeEpci,centre,contour,population,surface`).then(r => r.json());
    if (!commune.nom) throw new Error('Commune introuvable');
    state.nom = commune.nom || nomHint || code;
    state.contour = commune.contour;
    document.title = `${state.nom} · Portail communal · DDT 95`;
    $('communeTitle').textContent = state.nom;
    $('communeSub').textContent = `Fiche territoriale · code INSEE ${code}`;
    $('pageTitle').innerHTML = `${escapeHtml(state.nom)}.<br><span>Sa fiche territoriale.</span>`;
    $('communeSelect').value = state.nom;

    state.kpi = { population: commune.population || null, surface: commune.surface || null, epci: '…', code };
    if (commune.codeEpci) {
      fetch(`${CFG.communesApi}/epcis/${commune.codeEpci}?fields=nom`).then(r => r.json()).then(e => { state.kpi.epci = e.nom || '—'; renderFicheDrawer(); }).catch(() => { state.kpi.epci = '—'; renderFicheDrawer(); });
    } else {
      state.kpi.epci = '—';
    }

    $('showFiche').hidden = false;
    $('showFiche').onclick = () => renderFicheDrawer(true);

    drawContour(commune.contour);
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (state.contourLayer) map.fitBounds(state.contourLayer.getBounds(), { padding: [28, 28], animate: false });
    });

    await Promise.all([loadElus(code), loadRisques(code), loadZan(code), loadEau(code), loadEnergie(code), renderQpv(commune.contour)]);
    setupDynamicLayers();
    renderControls();
    renderFicheDrawer(true);

    setLoading(false);
  } catch (error) {
    console.error(error);
    setLoading(false);
    $('communeSub').textContent = 'Commune introuvable — vérifiez la sélection.';
  }
}

function drawContour(contour) {
  if (state.contourLayer) { map.removeLayer(state.contourLayer); state.contourLayer = null; }
  if (!contour) return;
  state.contourLayer = L.geoJSON(contour, { style: { color: '#000091', weight: 2.5, opacity: 0.9, fillColor: '#000091', fillOpacity: 0.04 } }).addTo(map);
}

// ---------- Données de synthèse (volet droit) ----------
function loadElus(code) {
  return fetch(CFG.elusFile).then(r => r.json()).then(all => { state.elus = all[code] || null; }).catch(() => { state.elus = null; });
}
function loadRisques(code) {
  return fetch(`${CFG.georisquesApi}?code_insee=${code}`).then(r => r.json()).then(d => { state.risques = d?.data?.[0]?.risques_detail || []; }).catch(() => { state.risques = []; });
}
function loadZan(code) {
  return fetch(`${CFG.ceremaApi}/${code}/`).then(r => r.json()).then(d => {
    const rows = (d.results || []).filter(r => r.annee >= 2011);
    const total = rows.reduce((sum, r) => sum + (r.naf_arti || 0), 0);
    const last = rows.sort((a, b) => b.annee - a.annee)[0];
    state.zan = rows.length ? { total, lastYear: last?.annee, lastValue: last?.naf_arti } : null;
  }).catch(() => { state.zan = null; });
}
function loadEau(code) {
  return fetch(`${CFG.hubeauApi}?code_commune=${code}&size=1`).then(r => r.json()).then(d => {
    state.eau = d.count ? { reseaux: d.count, reseau: d.data?.[0]?.nom_reseau } : null;
  }).catch(() => { state.eau = null; });
}
function loadEnergie(code) {
  const url = new URL(CFG.odreApi);
  url.searchParams.set('where', `code_commune="${code}" and filiere="Electricité" and code_grand_secteur="RESIDENTIEL"`);
  url.searchParams.set('order_by', 'annee desc');
  url.searchParams.set('limit', '1');
  return fetch(url).then(r => r.json()).then(d => {
    const row = d.results?.[0];
    state.energie = row ? { annee: row.annee, conso: row.conso_totale_mwh, sites: row.nb_sites } : null;
  }).catch(() => { state.energie = null; });
}

// ---------- Volet droit : fiche commune / fiche bâtiment ----------
function renderFicheDrawer(open) {
  if (state.drawerMode === 'batiment' && !open) return;
  state.drawerMode = 'commune';
  $('drawer-kicker').textContent = 'FICHE COMMUNALE';
  $('drawer-title').textContent = state.nom || 'Commune';
  $('drawer-sub').textContent = `Code INSEE ${state.code}`;

  const kpiRows = [
    ['Population', state.kpi.population ? `${formatNumber(state.kpi.population)} habitants` : null],
    ['Superficie', state.kpi.surface ? `${formatNumber(Math.round(state.kpi.surface / 100) / 10)} km²` : null],
    ['Intercommunalité', state.kpi.epci && state.kpi.epci !== '…' ? state.kpi.epci : null],
    ['Code INSEE', state.kpi.code]
  ].filter(([, v]) => v);

  const e = state.elus;
  const elusRows = e ? [
    ['Maire', e.maire ? `${e.maire.prenom} ${e.maire.nom}` : null],
    ['Canton', e.canton?.nom],
    ['Conseillers départementaux', e.canton?.conseillers?.length ? e.canton.conseillers.map(c => `${c.prenom} ${c.nom}`).join(' · ') : null],
    [`Député${e.circonscription?.label ? ' (' + e.circonscription.label + ')' : ''}`, e.circonscription?.depute ? `${e.circonscription.depute.prenom} ${e.circonscription.depute.nom}` : null],
    ['Sénateurs', e.senateurs?.length ? e.senateurs.map(s => `${s.prenom} ${s.nom}`).join(' · ') : null]
  ].filter(([, v]) => v) : [];

  const risquesHtml = state.risques.length
    ? state.risques.map(r => `<span class="risque-pill">${escapeHtml(r.libelle_risque_long)}</span>`).join('')
    : '<span class="risque-pill none">Aucun risque référencé à ce jour</span>';

  const territoireRows = [
    state.zan ? ['Surface artificialisée depuis 2011', `${formatNumber(Math.round(state.zan.total / 100) / 10)} ha`] : null,
    state.eau ? ['Réseaux de distribution (UDI) suivis', `${formatNumber(state.eau.reseaux)}${state.eau.reseau ? ' · ' + state.eau.reseau : ''}`] : null,
    state.energie ? [`Électricité résidentielle ${state.energie.annee}`, `${formatNumber(Math.round(state.energie.conso))} MWh · ${formatNumber(state.energie.sites)} sites`] : null
  ].filter(Boolean);

  $('drawer-body').innerHTML = `
    <section class="result-section"><h3>Chiffres clés</h3><dl class="data-grid">${kpiRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>
    ${elusRows.length ? `<section class="result-section"><h3>Élus et gouvernance</h3><dl class="data-grid">${elusRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>` : ''}
    <section class="result-section"><h3>Risques majeurs recensés</h3><div class="risque-pills">${risquesHtml}</div><p class="source-note">Géorisques · GASPAR — consulter <a href="https://www.georisques.gouv.fr/" target="_blank" rel="noreferrer">georisques.gouv.fr</a> pour le détail réglementaire.</p></section>
    ${territoireRows.length ? `<section class="result-section"><h3>Artificialisation, eau et énergie</h3><dl class="data-grid">${territoireRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Cerema · Hub’Eau · Agence ORE — voir les lectures <a href="https://ddt95.github.io/artificialisation-zan95/" target="_blank" rel="noreferrer">ZAN</a>, <a href="https://ddt95.github.io/eau95/" target="_blank" rel="noreferrer">Eau</a> et <a href="https://ddt95.github.io/transition-energetique95/" target="_blank" rel="noreferrer">Transition énergétique</a> pour le détail.</p></section>` : ''}
  `;
  $('drawer-actions').innerHTML = `<button id="drawer-pdf" type="button">Fiche officielle PDF (OCTE)</button>`;
  $('drawer-pdf').onclick = () => window.open(`${CFG.pdfBase}/${encodeURIComponent(state.nom)}.pdf`, '_blank', 'noopener,noreferrer');

  if (open) { $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); }
}
$('drawer-close').addEventListener('click', () => { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); });

// ---------- QPV (statique, filtré spatialement) ----------
async function renderQpv(contour) {
  state.qpv = [];
  if (!contour) return;
  try {
    const all = await fetch(CFG.qpvFile).then(r => r.json());
    state.qpv = all.features.filter(f => { try { return turf.booleanIntersects(f, contour); } catch { return false; } });
  } catch (error) { console.warn('QPV indisponible', error); }
}

// ---------- Couches, regroupées par thème (une par lecture de l'Atlas) ----------
function setupDynamicLayers() {
  state.layerDefs = [
    { id: 'qpv', group: 'Politique de la ville', label: 'Quartiers prioritaires (QPV)', description: `${state.qpv.length ? state.qpv.length + ' quartier(s) recensé(s)' : 'Aucun QPV recensé dans cette commune'} · ANCT`, color: '#c1443c', active: state.qpv.length > 0, disabled: state.qpv.length === 0, kind: 'static' },
    { id: 'ecoles', group: 'Services publics', label: 'Établissements scolaires', description: 'Écoles, collèges, lycées publics et privés sous contrat · data.education.gouv.fr', color: '#c76524', active: true, kind: 'commune' },
    { id: 'batiments', group: 'Urbanisme et bâti', label: 'Bâtiments (RNB)', description: 'Référentiel National des Bâtiments', color: '#18753c', active: false, kind: 'zoom' },
    { id: 'cadastre', group: 'Urbanisme et bâti', label: 'Parcelles cadastrales', description: 'APICarto IGN — cadastre', color: '#6a4c93', active: false, kind: 'zoom' },
    { id: 'rpg', group: 'Agriculture', label: 'Parcelles agricoles (RPG)', description: 'Registre parcellaire graphique · APICarto IGN', color: '#8a9a3b', active: false, kind: 'zoom' },
    { id: 'znieff1', group: 'Biodiversité', label: 'ZNIEFF de type I', description: 'Secteurs de grand intérêt biologique · APICarto IGN', color: '#e4792f', active: false, kind: 'commune' },
    { id: 'znieff2', group: 'Biodiversité', label: 'ZNIEFF de type II', description: 'Grands ensembles naturels riches · APICarto IGN', color: '#f2b37f', active: false, kind: 'commune' },
    { id: 'pnr', group: 'Biodiversité', label: 'Parcs naturels régionaux', description: 'Vexin français, Oise–Pays de France · APICarto IGN', color: '#2f6f3e', active: false, kind: 'commune' },
    { id: 'rnn', group: 'Biodiversité', label: 'Réserves naturelles', description: 'Réserves naturelles nationales · APICarto IGN', color: '#006a6f', active: false, kind: 'commune' },
    { id: 'busIdfm', group: 'Transports', label: 'Arrêts de bus', description: 'Île-de-France Mobilités', color: '#0063cb', active: false, kind: 'commune' },
    { id: 'railIdfm', group: 'Transports', label: 'Gares et stations (rail/tram)', description: 'Île-de-France Mobilités', color: '#000091', active: true, kind: 'commune' },
    { id: 'inondation', group: 'Risques naturels', label: 'Zonage inondation (PPRI)', description: 'Géorisques · plans de prévention approuvés', color: '#1479c9', active: false, kind: 'wms', wms: 'PPRN_ZONE_INOND' },
    { id: 'argiles', group: 'Risques naturels', label: 'Retrait-gonflement des argiles', description: 'Géorisques · aléa cartographié', color: '#e76f00', active: false, kind: 'wms', wms: 'ALEARG_REALISE' }
  ];

  buildQpvLayer();
  buildCommuneLayer('ecoles', buildEcoles);
  buildCommuneLayer('znieff1', () => buildNature('znieff1', 'znieff1'));
  buildCommuneLayer('znieff2', () => buildNature('znieff2', 'znieff2'));
  buildCommuneLayer('pnr', () => buildNature('pnr', 'pnr'));
  buildCommuneLayer('rnn', () => buildNature('rnn', 'rnn'));
  buildCommuneLayer('busIdfm', () => buildIdfmArrets('busIdfm', 'bus'));
  buildCommuneLayer('railIdfm', () => buildIdfmArrets('railIdfm', ['rail', 'tram']));
  buildWmsLayers();

  map.off('moveend', refreshDetailLayers);
  map.on('moveend', refreshDetailLayers);
  refreshDetailLayers();
}

function buildQpvLayer() {
  if (state.layers.qpv) { map.removeLayer(state.layers.qpv); }
  if (!state.qpv.length) { state.layers.qpv = null; return; }
  state.layers.qpv = L.geoJSON({ type: 'FeatureCollection', features: state.qpv }, {
    style: { color: '#c1443c', weight: 2, opacity: 0.9, fillColor: '#c1443c', fillOpacity: 0.22 },
    onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.libelle || 'Quartier prioritaire', { sticky: true })
  });
  if (state.layerDefs.find(l => l.id === 'qpv')?.active) state.layers.qpv.addTo(map);
}

function buildCommuneLayer(id, fetcher) {
  fetcher().then(layer => {
    state.layers[id] = layer;
    if (layer && state.layerDefs.find(l => l.id === id)?.active) layer.addTo(map);
    updateLegend();
  }).catch(error => { console.warn(id + ' indisponible', error); });
}

function buildEcoles() {
  return fetch(`${CFG.educationApi}?dataset=fr-en-annuaire-education&refine.code_commune=${state.code}&rows=200`).then(r => r.json()).then(d => {
    const records = (d.records || []).filter(r => r.fields.etat === 'OUVERT' && r.fields.latitude && r.fields.longitude);
    return L.layerGroup(records.map(r => {
      const f = r.fields;
      const isPriv = f.statut_public_prive === 'Privé';
      const icon = L.divIcon({ className: '', html: `<div class="theme-marker school${isPriv ? ' alt' : ''}">${(f.type_etablissement || 'É')[0]}</div>`, iconSize: [22, 22] });
      return L.marker([f.latitude, f.longitude], { icon }).bindPopup(`<strong>${escapeHtml(f.nom_etablissement)}</strong><br>${escapeHtml(f.type_etablissement)} · ${escapeHtml(f.statut_public_prive)}<br>${escapeHtml(f.adresse_1 || '')}`);
    }));
  });
}

function buildNature(id, endpoint) {
  return fetch(`${CFG.natureApi}/${endpoint}?code_insee=${state.code}`).then(r => r.ok ? r.json() : { features: [] }).then(d => {
    const features = d.features || [];
    if (!features.length) return null;
    const def = state.layerDefs.find(l => l.id === id);
    return L.geoJSON(d, {
      style: { color: def.color, weight: 1.5, opacity: 0.9, fillColor: def.color, fillOpacity: 0.2 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.nom || f.properties?.nom_site || def.label, { sticky: true })
    });
  });
}

function buildIdfmArrets(id, types) {
  const typeList = Array.isArray(types) ? types : [types];
  const whereType = typeList.map(t => `arrtype="${t}"`).join(' or ');
  const url = new URL(CFG.idfmArretsApi);
  url.searchParams.set('where', `arrtown="${state.nom}" and (${whereType})`);
  url.searchParams.set('limit', '100');
  return fetch(url).then(r => r.json()).then(d => {
    const records = d.results || [];
    if (!records.length) return null;
    const def = state.layerDefs.find(l => l.id === id);
    return L.layerGroup(records.filter(r => r.arrgeopoint).map(r => {
      const icon = L.divIcon({ className: '', html: `<div class="theme-marker ${id === 'busIdfm' ? 'bus' : 'gare'}">${id === 'busIdfm' ? 'B' : 'G'}</div>`, iconSize: id === 'busIdfm' ? [20, 20] : [22, 22] });
      return L.marker([r.arrgeopoint.lat, r.arrgeopoint.lon], { icon }).bindPopup(`<strong>${escapeHtml(r.arrname)}</strong><br>${escapeHtml(r.arrtype)} · ${escapeHtml(def.label)}`);
    }));
  });
}

function buildWmsLayers() {
  state.layerDefs.filter(l => l.wms).forEach(def => {
    const layer = L.tileLayer.wms(CFG.georisquesWms, { layers: def.wms, format: 'image/png', transparent: true, opacity: 0.75, version: '1.3.0', pane: 'riskTiles', attribution: 'Géorisques' });
    state.layers[def.id] = layer;
    if (def.active) layer.addTo(map);
  });
}

function refreshDetailLayers() {
  map.invalidateSize();
  updateZoomNotice();
  if (map.getZoom() < CFG.zoomGated) return;
  if (state.layerDefs.find(l => l.id === 'batiments')?.active) loadBatiments();
  if (state.layerDefs.find(l => l.id === 'cadastre')?.active) loadCadastre();
  if (state.layerDefs.find(l => l.id === 'rpg')?.active) loadRpg();
}

function updateZoomNotice() {
  const pending = state.layerDefs.filter(l => l.kind === 'zoom' && l.active).map(l => l.label);
  const el = $('map-intro');
  if (map.getZoom() < CFG.zoomGated && pending.length) {
    el.hidden = false;
    el.querySelector('span').textContent = `Zoomez pour afficher : ${pending.join(', ')}.`;
  } else {
    el.hidden = true;
  }
}

async function loadBatiments() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  try {
    const data = await fetch(`${CFG.rnbApi}?bbox=${bbox}&limit=100`).then(r => r.json());
    if (state.layers.batiments) map.removeLayer(state.layers.batiments);
    state.layers.batiments = L.geoJSON(data, {
      style: { color: '#18753c', weight: 1, opacity: 0.9, fillColor: '#18753c', fillOpacity: 0.35 },
      onEachFeature: (f, layer) => layer.on('click', e => { L.DomEvent.stopPropagation(e); openBuildingDrawer(f); })
    });
    if (state.layerDefs.find(l => l.id === 'batiments')?.active) state.layers.batiments.addTo(map);
  } catch (error) { console.warn('RNB indisponible', error); }
}

async function loadCadastre() {
  const b = map.getBounds();
  const geom = { type: 'Polygon', coordinates: [[[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]]] };
  try {
    let response;
    try {
      response = await fetch(`${CFG.cadastreApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    } catch {
      response = await fetch(CFG.cadastreApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geom }) }).then(r => r.json());
    }
    const features = response?.features || [];
    if (state.layers.cadastre) map.removeLayer(state.layers.cadastre);
    state.layers.cadastre = L.geoJSON(features, {
      style: { color: '#6a4c93', weight: 1, opacity: 0.85, fillOpacity: 0 },
      onEachFeature: (f, layer) => layer.bindTooltip(`Parcelle ${f.properties?.section || ''}${f.properties?.numero || ''}`, { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'cadastre')?.active) state.layers.cadastre.addTo(map);
  } catch (error) { console.warn('Cadastre indisponible', error); }
}

async function loadRpg() {
  const b = map.getBounds();
  const geom = { type: 'Polygon', coordinates: [[[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]]] };
  try {
    const data = await fetch(`${CFG.rpgApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    if (state.layers.rpg) map.removeLayer(state.layers.rpg);
    state.layers.rpg = L.geoJSON(data, {
      style: { color: '#8a9a3b', weight: 1, opacity: 0.9, fillColor: '#8a9a3b', fillOpacity: 0.3 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.code_cultu ? `Culture ${f.properties.code_cultu}` : 'Parcelle RPG', { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'rpg')?.active) state.layers.rpg.addTo(map);
  } catch (error) { console.warn('RPG indisponible', error); }
}

function openBuildingDrawer(feature) {
  state.drawerMode = 'batiment';
  const p = feature.properties || {};
  const addr = (p.addresses || [])[0];
  $('drawer-kicker').textContent = 'FICHE BÂTIMENT';
  $('drawer-title').textContent = addr ? `${addr.street_number || ''} ${addr.street || ''}`.trim() : 'Bâtiment';
  $('drawer-sub').textContent = feature.id ? `RNB ${feature.id}` : 'Référentiel National des Bâtiments';
  const rows = [
    ['Statut', p.status],
    ['Adresse', addr ? `${addr.street_number || ''} ${addr.street || ''}, ${addr.city_zipcode || ''} ${addr.city_name || ''}` : null],
    ['Identifiant RNB', feature.id]
  ].filter(([, v]) => v);
  $('drawer-body').innerHTML = `<section class="result-section"><h3>Bâtiment</h3><dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Pour le DPE, le RPLS et le détail énergétique : ouvrez ce bâtiment dans la lecture <a href="https://ddt95.github.io/observatoire_bati/" target="_blank" rel="noreferrer">Logement &amp; Habitat</a>.</p></section>`;
  $('drawer-actions').innerHTML = `<button id="drawer-back" type="button">← Retour à la fiche commune</button>`;
  $('drawer-back').onclick = () => renderFicheDrawer(true);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
}

// ---------- Panneau de couches, regroupé par thème ----------
function renderControls() {
  const root = $('layer-list');
  const groups = [...new Set(state.layerDefs.map(x => x.group))];
  root.innerHTML = groups.map(group => `<div class="layer-group"><strong>${group}</strong>${state.layerDefs.filter(x => x.group === group).map(x => `<div class="layer-row" data-layer-row="${x.id}" style="${x.disabled ? 'opacity:.5;pointer-events:none' : ''}"><button class="switch" type="button" data-layer="${x.id}" aria-label="Afficher ${x.label}" aria-pressed="${x.active}"></button><div class="layer-copy"><strong>${x.label}</strong><span>${x.description}${x.kind === 'zoom' ? ' · zoomez pour afficher' : ''}</span></div><i class="swatch" style="background:${x.color}"></i></div>`).join('')}</div>`).join('');
  root.querySelectorAll('[data-layer-row]').forEach(row => row.addEventListener('click', () => toggleLayer(row.dataset.layerRow)));
  updateLegend();
  updateZoomNotice();
}

function updateLegend() {
  const active = state.layerDefs.filter(x => x.active);
  $('legend-items').innerHTML = active.length ? active.map(x => `<div class="legend-row"><i style="background:${x.color}"></i><span>${x.label}</span></div>`).join('') : '<div class="legend-row">Aucune information affichée</div>';
}

function toggleLayer(id) {
  const def = state.layerDefs.find(x => x.id === id);
  if (!def || def.disabled) return;
  def.active = !def.active;
  const button = document.querySelector(`[data-layer="${id}"]`);
  if (button) button.setAttribute('aria-pressed', String(def.active));
  const layer = state.layers[id];
  if (def.active) {
    if (layer) layer.addTo(map);
    if (def.kind === 'zoom' && map.getZoom() >= CFG.zoomGated) {
      if (id === 'batiments') loadBatiments(); else if (id === 'cadastre') loadCadastre(); else if (id === 'rpg') loadRpg();
    }
  } else if (layer) {
    map.removeLayer(layer);
  }
  updateLegend();
  updateZoomNotice();
}

$('hide-all').addEventListener('click', () => { state.layerDefs.forEach(d => { if (d.active && !d.disabled) toggleLayer(d.id); }); });
$('mobile-panel').addEventListener('click', () => {
  const panel = $('panel');
  panel.classList.toggle('open');
  $('mobile-panel').setAttribute('aria-expanded', String(panel.classList.contains('open')));
});

// ---------- Export / impression ----------
const exportDialog = $('exportDialog');
$('openExport').addEventListener('click', () => exportDialog.showModal());
$('closeExport').addEventListener('click', () => exportDialog.close());
exportDialog.addEventListener('click', e => { if (e.target === exportDialog) exportDialog.close(); });
$('printProfile').addEventListener('click', () => { exportDialog.close(); window.print(); });
$('makePdf').addEventListener('click', async () => {
  exportDialog.close();
  renderFicheDrawer(true);
  document.body.classList.add('exporting');
  const pdfWindow = window.open('', '_blank');
  if (pdfWindow) pdfWindow.document.write('<title>Génération du PDF…</title><body style="font-family:sans-serif;padding:60px;color:#10104b">Génération de la fiche PDF en cours…</body>');
  try {
    const blob = await html2pdf().set({
      margin: 8,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(document.querySelector('.drawer')).outputPdf('blob');
    const url = URL.createObjectURL(blob);
    if (pdfWindow && !pdfWindow.closed) pdfWindow.location.href = url; else window.open(url, '_blank', 'noopener');
  } finally {
    document.body.classList.remove('exporting');
  }
});
