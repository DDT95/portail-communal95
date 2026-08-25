/*
 * Portail communal — fiche territoriale par commune.
 * Sources réutilisées telles quelles depuis les lectures existantes de l'Atlas :
 * geo.api.gouv.fr (contours/population/EPCI), RNE data.gouv.fr (élus),
 * Géorisques GASPAR + WMS PPRN/argiles (observatoire_risques_95), data.geopf.fr (QPV, forêts publiques),
 * RNB beta.gouv.fr (observatoire_bati), APICarto IGN — cadastre, RPG (agriculture95), nature (biodiversite95), GPU (urbanisme95),
 * data.education.gouv.fr (écoles), acces-services95 (services publics : mairies, CCAS, France Services, santé, sécurité...),
 * data.iledefrance-mobilites.fr (bus-trains-95), Cerema apidf (artificialisation-zan95),
 * Hub'Eau (eau95), Agence ORE (transition-energetique95), data.iledefrance.fr (biodiversite95 — jardins remarquables).
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
  gpuApi: 'https://apicarto.ign.fr/api/gpu/zone-urba',
  geopfWfs: 'https://data.geopf.fr/wfs/ows',
  educationApi: 'https://data.education.gouv.fr/api/records/1.0/search/',
  servicesApi: 'https://ddt95.github.io/acces-services95/data/services-95.json',
  jardinsApi: 'https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets/liste-des-jardins-remarquables/records',
  idfmArretsApi: 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/records',
  ceremaApi: 'https://apidf-preprod.cerema.fr/indicateurs/conso_espace/communes',
  hubeauApi: 'https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/communes_udi',
  odreApi: 'https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets/consommation-annuelle-d-electricite-et-gaz-par-commune/records',
  bdnbApi: 'https://api.bdnb.io/v1/bdnb',
  roadsFile: 'https://ddt95.github.io/transport95/roads95.js',
  mobilityFile: 'https://ddt95.github.io/transport95/mobility95.js',
  voInseeApi: 'https://ddt95.github.io/VO-Insee/data/processed/commune_profiles.json',
  dvfStatsFile: 'data/dvf_stats_95.json',
  cycleFile: 'https://ddt95.github.io/transport95/cycle95.js',
  icpeApi: 'https://www.georisques.gouv.fr/api/v1/installations_classees',
  sspApi: 'https://www.georisques.gouv.fr/api/v1/ssp',
  gpuSupApi: 'https://apicarto.ign.fr/api/gpu/assiette-sup-s',
  ocsgeWmts: 'https://data.geopf.fr/wmts',
  mosApi: 'https://geoweb.iau-idf.fr/agsmap1/rest/services/OPENDATA/OpendataIAU4/MapServer/25/query',
  foncierPublicFile: 'https://ddt95.github.io/urbanisme95/data/foncier-public-95.json',
  qpvFile: 'data/qpv_95.geojson',
  elusFile: 'data/elus_95.json',
  finessFile: 'data/finess_95.json',
  securiteFile: 'data/securite_95.json',
  pdfBase: 'https://piece-jointe-carto.developpement-durable.gouv.fr/DEPT095A/DONNEE_GENERIQUE/N_BASE_COMMUNALE/OCTE/Fiches',
  zoomGated: 13
};

const SERVICE_CATS = {
  france_services: { label: 'Maisons France Services', color: '#000091' },
  administration: { label: 'Mairie, CCAS & administration', color: '#3153a4' },
  securite: { label: 'Sécurité & secours', color: '#d65b2b' },
  quotidien: { label: 'Services du quotidien', color: '#b07800' },
  culture: { label: 'Culture & sport', color: '#33845b' }
};

const FINESS_CATS = {
  hopitaux: { label: 'Hôpitaux & cliniques', color: '#c1443c' },
  medecins: { label: 'Médecins & laboratoires', color: '#d33b63' },
  pharmacies: { label: 'Pharmacies', color: '#18753c' },
  ehpad: { label: 'EHPAD & personnes âgées', color: '#8146a1' },
  handicap: { label: 'Accueil handicap & enfance', color: '#0078f3' }
};

// Pictogrammes sobres et reconnaissables pour les marqueurs de la carte —
// pas de logos officiels reproduits (droits/usage), juste des symboles usuels.
const SERVICE_TYPE_GLYPHS = {
  gendarmerie: '🛡️', gendarmerie_moto: '🛡️', gendarmerie_departementale: '🛡️',
  police: '👮', commissariat_police: '👮', police_municipale: '👮',
  fire_station: '⛑️', centre_penitentiaire: '🔒'
};
const SERVICE_CAT_GLYPHS = { france_services: 'ℹ️', administration: '🏛️', securite: '🛡️', quotidien: '🛍️', culture: '🎭' };
const FINESS_CAT_GLYPHS = { hopitaux: '🏥', medecins: '🩺', pharmacies: '➕', ehpad: '🧓', handicap: '♿' };

const MOS_LABELS = {
  1: 'Bois ou forêts', 2: 'Coupes ou clairières en forêts', 3: 'Peupleraies', 4: 'Espaces ouverts à végétation arborée ou herbacée', 5: 'Berges', 6: 'Terres labourées', 7: 'Prairies', 8: 'Vergers, pépinières', 9: 'Maraîchage, horticulture', 10: 'Cultures intensives sous serres', 11: 'Eau fermée', 12: 'Cours d’eau', 13: 'Parcs ou jardins publics', 14: 'Autres espaces verts publics', 15: 'Jardins familiaux', 16: 'Jardins de l’habitat', 17: 'Terrains de sport en plein air', 18: 'Tennis découverts', 19: 'Baignade', 20: 'Golfs', 21: 'Hippodromes', 22: 'Camping, caravaning', 23: 'Parcs liés aux activités de loisirs', 24: 'Esplanades et places', 25: 'Cimetières', 26: 'Surfaces engazonnées avec ou sans arbustes', 27: 'Terrains vacants', 28: 'Habitat pavillonnaire', 29: 'Ensemble d’habitat pavillonnaire', 30: 'Habitat rural', 31: 'Habitat continu bas', 32: 'Habitat collectif continu haut', 33: 'Habitat collectif discontinu', 34: 'Prisons', 35: 'Habitat autre', 36: 'Activités en tissu urbain mixte', 37: 'Grandes emprises industrielles', 38: 'Zones d’activités économiques', 39: 'Entreposage à l’air libre', 40: 'Entrepôts logistiques', 41: 'Stockage de données', 42: 'Grandes surfaces commerciales', 43: 'Autres commerces', 44: 'Stations-services', 45: 'Bureaux', 46: 'Production d’eau', 47: 'Assainissement', 48: 'Électricité', 49: 'Gaz', 50: 'Pétrole', 51: 'Chaleur', 52: 'Extraction de matériaux', 53: 'Tri et valorisation des déchets', 54: 'Stockage de déchets', 55: 'Installations sportives couvertes', 56: 'Centres équestres', 57: 'Piscines couvertes', 58: 'Piscines de plein air', 59: 'Circuits sportifs', 60: 'Enseignement du premier degré', 61: 'Enseignement secondaire', 62: 'Enseignement supérieur', 63: 'Centre de formation professionnelle', 64: 'Hôpitaux, cliniques', 65: 'Autres équipements de santé', 66: 'Grands centres de congrès et d’exposition', 67: 'Équipements culturels et de loisirs', 68: 'Sièges de grandes administrations', 69: 'Équipements de sécurité civile', 70: 'Équipements à accès public limité', 71: 'Lieux de culte', 72: 'Autres équipements de proximité', 73: 'Emprise ferrée', 74: 'Voies routières', 75: 'Parkings de surface', 76: 'Parkings en étages', 77: 'Gares routières, dépôts de bus', 78: 'Installations aéroportuaires', 79: 'Chantiers'
};
function mosColor(code) {
  if (code <= 5) return '#18753c';
  if (code <= 10) return '#e3b341';
  if (code <= 12) return '#0098d8';
  if (code <= 27) return '#62b467';
  if (code <= 35) return '#e07a9a';
  if (code <= 54) return '#a05a9c';
  if (code <= 72) return '#5576b9';
  if (code <= 78) return '#737b87';
  return '#e1000f';
}
const PUBLIC_LAND_COLORS = { '1': '#e1000f', '2': '#6f4c9b', '3': '#000091', '4': '#18753c', '5': '#0098d8', '6': '#e3b341', '9': '#7b61a8' };

const state = {
  code: null, nom: null, contour: null, contourLayer: null,
  elus: null, risques: [], qpv: [], kpi: {}, zan: null, eau: null, energie: null, services: [], finess: [], insee: null, dvf: null, mosSummary: null, securite: null, mobilitySummary: null,
  layers: {}, layerDefs: [], layerLoading: new Set(),
  drawerMode: 'commune'
};
const compareSelection = new Map();
let refreshCommuneList = () => {};
// Déclarés ici (avant le boot) car loadCommune() les appelle avant son
// premier await : à ce point le script n'a pas fini de s'évaluer, donc
// une const/let déclarée plus bas provoquerait une TDZ ReferenceError.
let inseeProfilesCache = null;
let dvfStatsCache = null;
let securiteCache = null;

const $ = id => document.getElementById(id);
// Certaines API publiques (Géorisques, Cerema, Hub'Eau...) peuvent rester
// muettes sans jamais répondre ni erreur ni timeout — sans limite, un seul
// appel bloqué gèle toute la fiche communale indéfiniment (Promise.all).
function fetchTimeout(url, opts, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}
const escapeHtml = value => String(value ?? '—').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
const formatNumber = n => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
const toTitleCase = s => String(s || '').toLocaleLowerCase('fr').replace(/(^|[\s'’-])\p{L}/gu, c => c.toLocaleUpperCase('fr'));

const map = L.map('map', { zoomControl: true, preferCanvas: true, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 6, maxZoom: 19 });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
map.createPane('riskTiles'); map.getPane('riskTiles').style.zIndex = 350; map.getPane('riskTiles').style.pointerEvents = 'none';
map.attributionControl.setPrefix('Leaflet');
map.fitBounds([[48.89, 1.60], [49.25, 2.60]], { padding: [8, 8] });

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
  buildLandingMap();
}

function goToCommune(code, nom) { window.open(`?${new URLSearchParams({ code, nom })}`, '_blank', 'noopener'); }

function updateCompareBar() {
  const bar = $('compareBar'), text = $('compareBarText'), openBtn = $('compareOpen');
  if (!bar) return;
  const n = compareSelection.size;
  bar.hidden = n === 0;
  text.textContent = n === 0 ? '' : `${n} commune${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''} sur 3`;
  openBtn.disabled = n < 2;
  const listClear = $('compareClearList');
  if (listClear) listClear.hidden = n === 0;
}
$('compareOpen')?.addEventListener('click', openCompareDialog);
function clearCompareSelection() { compareSelection.clear(); refreshCommuneList(); updateCompareBar(); }
$('compareClear')?.addEventListener('click', clearCompareSelection);
$('compareClearList')?.addEventListener('click', clearCompareSelection);
$('closeCompare')?.addEventListener('click', () => $('compareDialog').close());
$('compareDialog')?.addEventListener('click', e => { if (e.target === $('compareDialog')) $('compareDialog').close(); });

async function openCompareDialog() {
  const entries = [...compareSelection.entries()];
  $('compareBody').style.setProperty('--cols', entries.length);
  $('compareBody').innerHTML = entries.map(([, nom]) => `<div class="compare-col"><h3>${escapeHtml(nom)}</h3><p class="source-note">Chargement…</p></div>`).join('');
  $('compareDialog').showModal();
  try {
    const profiles = await fetch(CFG.voInseeApi).then(r => r.json());
    $('compareBody').innerHTML = entries.map(([code, nom]) => renderCompareColumn(code, nom, profiles[code])).join('');
  } catch (error) {
    $('compareBody').innerHTML = '<p class="source-note">Données Insee indisponibles pour le moment.</p>';
  }
}

function donutChart(segments) {
  let cum = 0;
  const stops = segments.map(s => { const start = cum; cum += s.pct; return `${s.color} ${start}% ${cum}%`; }).join(',');
  const legend = segments.map(s => `<div class="donut-legend-row"><i style="background:${s.color}"></i><span>${escapeHtml(s.label)}${s.count != null ? ' · ' + formatNumber(Math.round(s.count)) : ''}</span><b>${s.pct.toFixed(1)}%</b></div>`).join('');
  return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops})"></div><div class="donut-legend">${legend}</div></div>`;
}
function barList(rows) {
  return `<div class="compare-bars">${rows.map(([label, pct, color]) => `<div class="compare-bar-row"><div><span>${escapeHtml(label)}</span><span>${pct.toFixed(1)}%</span></div><div class="compare-bar-track"><div class="compare-bar-fill" style="width:${pct}%;background:${color}"></div></div></div>`).join('')}</div>`;
}

function renderCompareColumn(code, nom, profile) {
  if (!profile) return `<div class="compare-col"><h3>${escapeHtml(nom)}</h3><p class="source-note">Aucune donnée Insee disponible.</p></div>`;
  const t = profile.themes || {};
  const pop = t.habitants?.population_totale?.value;
  const pyramide = t.habitants?.pyramide_ages?.tranches || [];
  const chomage = t.emploi_mobilites?.chomage_rp?.taux_chomage_15_64?.value;
  const revenus = t.habitants?.revenus_pauvrete || {};
  const occ = t.logement?.occupation || {};
  const rp = occ.proprietaires?.denominator || null;
  const proprietaires = occ.proprietaires?.value, locPrive = occ.locataires_prive?.value, locSocial = occ.locataires_social?.value;
  const partSocial = t.logement?.social?.part_rpls_residences_principales?.value;
  const parc = t.logement?.parc || {};
  const vacance = t.logement?.vacance?.taux_vacance_rp?.value;
  const familles = t.habitants?.structure_familles?.repartition || [];
  const diplomes = t.habitants?.diplomes?.repartition || [];
  const transport = t.emploi_mobilites?.transport || [];
  const eco = t.economie_equipements?.entreprises || {};
  const creations = t.economie_equipements?.creations || {};
  const construction = t.logement?.construction || {};
  const renovation = t.logement?.renovation || {};
  const chauffage = t.logement?.energie_chauffage?.repartition || [];
  const dvf = state.dvf;
  const pctOf = (v, d) => v != null && d ? (v / d) * 100 : null;

  const kpiRows = [
    ['Population', pop ? formatNumber(Math.round(pop)) + ' hab.' : null],
    ['Niveau de vie médian', revenus.niveau_vie_median?.value ? formatNumber(revenus.niveau_vie_median.value) + ' €/an' : null],
    ['Taux de pauvreté', revenus.taux_pauvrete?.value != null ? revenus.taux_pauvrete.value.toFixed(1) + ' %' : null],
    ['Taux de chômage (15-64 ans)', chomage != null ? chomage.toFixed(1) + ' %' : null],
    ['Logement social', partSocial != null ? partSocial.toFixed(1) + ' %' : null],
    ['Logements vacants', vacance != null ? vacance.toFixed(1) + ' %' : null],
    ['Établissements actifs', eco.etablissements_actifs?.value ? formatNumber(Math.round(eco.etablissements_actifs.value)) : null],
    ['Emplois salariés', eco.emplois_salaries?.value ? formatNumber(Math.round(eco.emplois_salaries.value)) : null]
  ].filter(([, v]) => v);

  const ageDonut = pyramide.length ? donutChart(pyramide.map((tr, i) => ({ label: tr.label, pct: tr.pct, count: tr.value, color: ['#c76524', '#e4a86a', '#f2d0a8'][i] || '#c76524' }))) : '';

  const occSegs = [
    proprietaires != null ? { label: 'Propriétaires', pct: pctOf(proprietaires, rp), count: proprietaires, color: '#18753c' } : null,
    locPrive != null ? { label: 'Locataires (privé)', pct: pctOf(locPrive, rp), count: locPrive, color: '#0063cb' } : null,
    locSocial != null ? { label: 'Locataires (social)', pct: pctOf(locSocial, rp), count: locSocial, color: '#6a4c93' } : null
  ].filter(Boolean);
  const occDonut = occSegs.length ? donutChart(occSegs) : '';

  const famColors = ['#0d5c63', '#4fa5ac', '#8fc7cb', '#c8e6e8'];
  const famDonut = familles.length ? donutChart(familles.map((f, i) => ({ label: f.label, pct: f.pct, count: f.value, color: famColors[i] || '#0d5c63' }))) : '';

  const parcRows = [
    ['Maisons', pctOf(parc.maisons?.value, parc.residences_principales?.value), '#18753c'],
    ['Appartements', pctOf(parc.appartements?.value, parc.residences_principales?.value), '#6a4c93']
  ].filter(([, pct]) => pct != null);

  const diplomeRows = diplomes.map((d, i) => [d.label, d.pct, ['#000091', '#3153a4', '#5a75c4', '#8296d6', '#a9b7e6', '#d0d8f2'][i] || '#000091']);
  const transportSorted = [...transport].sort((a, b) => b.pct - a.pct).slice(0, 5);
  const transportRows = transportSorted.map((tr, i) => [tr.label, tr.pct, ['#c76524', '#d68a4f', '#e4a86a', '#efc38f', '#f7ddb8'][i] || '#c76524']);

  return `<div class="compare-col">
    <h3>${escapeHtml(nom)}</h3>
    ${kpiRows.length ? `<div class="compare-block"><h4>Chiffres clés</h4>${kpiRows.map(([l, v]) => `<div class="compare-stat"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong></div>`).join('')}</div>` : ''}
    ${ageDonut ? `<div class="compare-block"><h4>Pyramide des âges</h4>${ageDonut}</div>` : ''}
    ${occDonut ? `<div class="compare-block"><h4>Statut d’occupation des logements</h4>${occDonut}</div>` : ''}
    ${parcRows.length ? `<div class="compare-block"><h4>Type de logement</h4>${barList(parcRows)}</div>` : ''}
    ${famDonut ? `<div class="compare-block"><h4>Structure des familles</h4>${famDonut}</div>` : ''}
    ${diplomeRows.length ? `<div class="compare-block"><h4>Diplômes (actifs occupés)</h4>${barList(diplomeRows)}</div>` : ''}
    ${transportRows.length ? `<div class="compare-block"><h4>Mode de transport domicile-travail</h4>${barList(transportRows)}</div>` : ''}
    <p class="source-note">Insee · RP2023, Filosofi, REE 2024 — <a href="https://ddt95.github.io/VO-Insee/?type=commune&id=${code}" target="_blank" rel="noreferrer">Portrait Insee complet ↗</a></p>
  </div>`;
}

const SORT_FNS = {
  nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
  pop_desc: (a, b) => (b.population || 0) - (a.population || 0),
  pop_asc: (a, b) => (a.population || 0) - (b.population || 0),
  surf_desc: (a, b) => (b.surface || 0) - (a.surface || 0),
  surf_asc: (a, b) => (a.surface || 0) - (b.surface || 0)
};

function buildLandingMap() {
  map.dragging.disable(); map.scrollWheelZoom.disable(); map.doubleClickZoom.disable();
  $('layers-title').textContent = 'Communes du Val-d’Oise';
  $('hide-all').hidden = true;
  $('communeFilters').hidden = false;
  let communesData = [];

  fetch(`${CFG.communesApi}/departements/95/communes?fields=nom,code,population,surface`).then(r => r.json()).then(list => {
    communesData = list;
    renderCommuneList();
  });
  refreshCommuneList = () => renderCommuneList();

  function renderCommuneList() {
    const sortKey = $('communeSort').value;
    const popMin = parseFloat($('popMin').value), popMax = parseFloat($('popMax').value);
    const surfMin = parseFloat($('surfMin').value), surfMax = parseFloat($('surfMax').value);
    const filtered = communesData.filter(c => {
      const surfKm2 = c.surface ? c.surface / 100 : null;
      if (!isNaN(popMin) && (c.population || 0) < popMin) return false;
      if (!isNaN(popMax) && (c.population || 0) > popMax) return false;
      if (!isNaN(surfMin) && (surfKm2 == null || surfKm2 < surfMin)) return false;
      if (!isNaN(surfMax) && (surfKm2 == null || surfKm2 > surfMax)) return false;
      return true;
    });
    const sorted = filtered.sort(SORT_FNS[sortKey] || SORT_FNS.nom);
    $('layer-list').innerHTML = sorted.length ? sorted.map(c => {
      const checked = compareSelection.has(c.code);
      const disabled = !checked && compareSelection.size >= 3;
      const surfLabel = c.surface ? `${formatNumber(Math.round(c.surface / 10) / 10)} km²` : null;
      return `<div class="commune-row" style="${disabled ? 'opacity:.45' : ''}"><button class="switch" type="button" data-compare="${c.code}" data-nom="${escapeHtml(c.nom)}" aria-label="Sélectionner ${escapeHtml(c.nom)} pour comparer" aria-pressed="${checked}" ${disabled ? 'disabled' : ''}></button><div class="commune-row-body" data-code="${c.code}" data-nom="${escapeHtml(c.nom)}"><strong>${escapeHtml(c.nom)}</strong><span>${c.population ? formatNumber(c.population) + ' hab.' : '—'}${surfLabel ? ' · ' + surfLabel : ''}</span></div></div>`;
    }).join('') : '<p class="source-note">Aucune commune ne correspond à ces filtres.</p>';
    $('layer-list').querySelectorAll('.commune-row-body').forEach(row => row.addEventListener('click', () => goToCommune(row.dataset.code, row.dataset.nom)));
    $('layer-list').querySelectorAll('[data-compare]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const code = btn.dataset.compare, nom = btn.dataset.nom;
      if (compareSelection.has(code)) compareSelection.delete(code);
      else if (compareSelection.size < 3) compareSelection.set(code, nom);
      renderCommuneList();
      updateCompareBar();
    }));
  }
  $('communeSort').addEventListener('change', renderCommuneList);
  ['popMin', 'popMax', 'surfMin', 'surfMax'].forEach(id => $(id).addEventListener('input', renderCommuneList));
  $('clearFilters').addEventListener('click', () => {
    ['popMin', 'popMax', 'surfMin', 'surfMax'].forEach(id => { $(id).value = ''; });
    $('communeSort').value = 'nom';
    renderCommuneList();
  });
  updateCompareBar();

  map.createPane('deptMaskPane'); map.getPane('deptMaskPane').style.zIndex = 410; map.getPane('deptMaskPane').style.pointerEvents = 'none';
  fetch(`${CFG.communesApi}/departements/95/communes?fields=nom,code,contour&format=geojson&geometry=contour`).then(r => r.json()).then(fc => {
    // Estompe tout ce qui dépasse du Val-d’Oise pour que le département
    // ressorte nettement, plutôt que de laisser les départements voisins
    // se mêler visuellement au fond de carte.
    const holes = fc.features.flatMap(f => {
      const g = f.geometry;
      return g.type === 'Polygon' ? [g.coordinates[0]] : (g.coordinates || []).map(p => p[0]);
    });
    L.geoJSON({
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes] }
    }, { pane: 'deptMaskPane', interactive: false, style: { stroke: false, fillColor: '#eef1f5', fillOpacity: 0.82, fillRule: 'evenodd' } }).addTo(map);

    const layer = L.geoJSON(fc, {
      style: { color: '#000091', weight: 1.3, opacity: 0.6, fillColor: '#e8eaf7', fillOpacity: 0.75 },
      onEachFeature: (f, l) => {
        l.bindTooltip(f.properties.nom, { sticky: true, direction: 'top' });
        l.on({
          mouseover: () => l.setStyle({ color: '#000091', weight: 1.4, fillColor: '#e6e6fb', fillOpacity: 0.7 }),
          mouseout: () => layer.resetStyle(l),
          click: () => goToCommune(f.properties.code, f.properties.nom)
        });
      }
    }).addTo(map);
    requestAnimationFrame(() => { map.invalidateSize(); map.fitBounds(layer.getBounds(), { padding: [55, 55], maxZoom: 11, animate: false }); });
  });
}

async function loadCommune(code, nomHint) {
  state.code = code;
  setLoading(true, 'Chargement du territoire');
  $('compareBar').hidden = true;
  $('communeForm').hidden = true;
  $('communeFilters').hidden = true;
  try {
    // Ces appels ne dépendent que du code Insee (pas du contour) : on les
    // lance en parallèle de la fiche commune elle-même plutôt qu'après,
    // pour ne pas payer leur latence deux fois.
    const early = [loadElus(code), loadRisques(code), loadZan(code), loadEau(code), loadEnergie(code), loadInsee(code), loadDvfStats(code), loadSecurite(code)];
    const commune = await fetchTimeout(`${CFG.communesApi}/communes/${code}?fields=nom,code,codeEpci,centre,contour,population,surface`).then(r => r.json());
    if (!commune.nom) throw new Error('Commune introuvable');
    state.nom = commune.nom || nomHint || code;
    state.contour = commune.contour;
    document.title = `${state.nom} · Portail communal · DDT 95`;
    $('communeTitle').textContent = state.nom;
    $('communeSub').textContent = `Fiche territoriale · code INSEE ${code}`;
    $('pageTitle').innerHTML = `${escapeHtml(state.nom)}<br><span>Fiche territoriale</span>`;
    $('communeSelect').value = state.nom;

    state.kpi = { population: commune.population || null, surface: commune.surface || null, epci: '…', code };
    if (commune.codeEpci) {
      fetchTimeout(`${CFG.communesApi}/epcis/${commune.codeEpci}?fields=nom`).then(r => r.json()).then(e => { state.kpi.epci = e.nom || '—'; renderFicheDrawer(); }).catch(() => { state.kpi.epci = '—'; renderFicheDrawer(); });
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

    await Promise.all([...early, loadServices(state.nom, commune.contour), loadFiness(commune.contour), renderQpv(commune.contour), loadMobilitySummary(commune.contour)]);
    state.mosPromise = loadMosSummary(commune.contour).then(() => { if (state.code === code) renderFicheDrawer(); });
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
  return fetchTimeout(CFG.elusFile).then(r => r.json()).then(all => { state.elus = all[code] || null; }).catch(() => { state.elus = null; });
}
function loadRisques(code) {
  return fetchTimeout(`${CFG.georisquesApi}?code_insee=${code}`).then(r => r.json()).then(d => { state.risques = d?.data?.[0]?.risques_detail || []; }).catch(() => { state.risques = []; });
}
function loadZan(code) {
  return fetchTimeout(`${CFG.ceremaApi}/${code}/`).then(r => r.json()).then(d => {
    const rows = (d.results || []).filter(r => r.annee >= 2011);
    const total = rows.reduce((sum, r) => sum + (r.naf_arti || 0), 0);
    const last = rows.sort((a, b) => b.annee - a.annee)[0];
    state.zan = rows.length ? { total, lastYear: last?.annee, lastValue: last?.naf_arti } : null;
  }).catch(() => { state.zan = null; });
}
function loadEau(code) {
  return fetchTimeout(`${CFG.hubeauApi}?code_commune=${code}&size=1`).then(r => r.json()).then(d => {
    state.eau = d.count ? { reseaux: d.count, reseau: d.data?.[0]?.nom_reseau } : null;
  }).catch(() => { state.eau = null; });
}
function loadEnergie(code) {
  const url = new URL(CFG.odreApi);
  url.searchParams.set('where', `code_commune="${code}" and filiere="Electricité" and code_grand_secteur="RESIDENTIEL"`);
  url.searchParams.set('order_by', 'annee desc');
  url.searchParams.set('limit', '1');
  return fetchTimeout(url).then(r => r.json()).then(d => {
    const row = d.results?.[0];
    state.energie = row ? { annee: row.annee, conso: row.conso_totale_mwh, sites: row.nb_sites } : null;
  }).catch(() => { state.energie = null; });
}
function loadServices(nom, contour) {
  return fetchTimeout(CFG.servicesApi).then(r => r.json()).then(d => {
    state.services = (d.records || []).filter(r => {
      if (r.category === 'education' || r.category === 'mobilite' || !r.lat || !r.lon) return false;
      if (r.city === nom) return true;
      try { return turf.booleanPointInPolygon(turf.point([r.lon, r.lat]), contour); } catch { return false; }
    });
  }).catch(() => { state.services = []; });
}
function loadFiness(contour) {
  return fetchTimeout(CFG.finessFile).then(r => r.json()).then(all => {
    state.finess = all.filter(r => { try { return turf.booleanPointInPolygon(turf.point([r.lon, r.lat]), contour); } catch { return false; } });
  }).catch(() => { state.finess = []; });
}

function loadInsee(code) {
  inseeProfilesCache = inseeProfilesCache || fetchTimeout(CFG.voInseeApi).then(r => r.json());
  return inseeProfilesCache.then(profiles => { state.insee = profiles[code] || null; }).catch(() => { state.insee = null; });
}

function loadDvfStats(code) {
  dvfStatsCache = dvfStatsCache || fetchTimeout(CFG.dvfStatsFile).then(r => r.json());
  return dvfStatsCache.then(all => { state.dvf = all[code] || null; }).catch(() => { state.dvf = null; });
}

function loadSecurite(code) {
  securiteCache = securiteCache || fetchTimeout(CFG.securiteFile).then(r => r.json());
  return securiteCache.then(all => { state.securite = all[code] || null; }).catch(() => { state.securite = null; });
}

async function loadMosSummary(contour) {
  if (!contour) return null;
  const b = L.geoJSON(contour).getBounds();
  const geometry = JSON.stringify({ xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth(), spatialReference: { wkid: 4326 } });
  const contourFeature = { type: 'Feature', properties: {}, geometry: contour };
  const groups = { naturel: 0, ouvert: 0, construit: 0 };
  let total = 0;
  try {
    for (let offset = 0, page = 0; page < 12; page++) {
      const url = new URL(CFG.mosApi);
      url.searchParams.set('f', 'geojson');
      url.searchParams.set('geometry', geometry);
      url.searchParams.set('geometryType', 'esriGeometryEnvelope');
      url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
      url.searchParams.set('outFields', 'mos2025');
      url.searchParams.set('inSR', '4326');
      url.searchParams.set('outSR', '4326');
      url.searchParams.set('resultOffset', String(offset));
      const data = await fetchTimeout(url).then(r => r.json());
      (data.features || []).forEach(f => {
        let area = 0;
        try { area = turf.area(turf.intersect(turf.featureCollection([f, contourFeature]))) || 0; } catch { area = 0; }
        if (!area) return;
        const code = f.properties?.mos2025;
        total += area;
        if (code <= 12) groups.naturel += area; else if (code <= 27) groups.ouvert += area; else groups.construit += area;
      });
      if (!data.exceededTransferLimit) break;
      offset += (data.features || []).length || 1000;
    }
    state.mosSummary = total ? { total, ...groups } : null;
  } catch { state.mosSummary = null; }
  return state.mosSummary;
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
    ['Superficie', state.kpi.surface ? `${formatNumber(Math.round(state.kpi.surface / 10) / 10)} km²` : null],
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

  // ---- Démographie, économie et logement (Insee) ----
  const t = state.insee?.themes || {};
  const pop = t.habitants?.population_totale?.value;
  const pyramide = t.habitants?.pyramide_ages?.tranches || [];
  const chomage = t.emploi_mobilites?.chomage_rp?.taux_chomage_15_64?.value;
  const revenus = t.habitants?.revenus_pauvrete || {};
  const occ = t.logement?.occupation || {};
  const rp = occ.proprietaires?.denominator || null;
  const partSocial = t.logement?.social?.part_rpls_residences_principales?.value;
  const parc = t.logement?.parc || {};
  const vacance = t.logement?.vacance?.taux_vacance_rp?.value;
  const eco = t.economie_equipements?.entreprises || {};
  const creations = t.economie_equipements?.creations || {};
  const construction = t.logement?.construction || {};
  const renovation = t.logement?.renovation || {};
  const chauffage = t.logement?.energie_chauffage?.repartition || [];
  const dvf = state.dvf;
  const transport = t.emploi_mobilites?.transport || [];
  const familles = t.habitants?.structure_familles?.repartition || [];
  const diplomes = t.habitants?.diplomes?.repartition || [];
  const categoriesSocio = t.habitants?.categorie_socioprofessionnelle?.repartition || [];
  const pctOf = (v, d) => v != null && d ? (v / d) * 100 : null;

  const demoRows = [
    ['Population (RP Insee)', pop ? formatNumber(Math.round(pop)) + ' hab.' : null],
    ['Niveau de vie médian', revenus.niveau_vie_median?.value ? formatNumber(revenus.niveau_vie_median.value) + ' €/an' : null],
    ['Taux de pauvreté', revenus.taux_pauvrete?.value != null ? revenus.taux_pauvrete.value.toFixed(1) + ' %' : null],
    ['Moins de 20 ans', pyramide[0]?.pct != null ? pyramide[0].pct.toFixed(1) + ' %' : null],
    ['65 ans ou plus', pyramide[2]?.pct != null ? pyramide[2].pct.toFixed(1) + ' %' : null],
    ['Familles avec enfant(s)', familles.length ? familles.filter(f => /avec enfant/i.test(f.label)).reduce((sum, f) => sum + (f.pct || 0), 0).toFixed(1) + ' %' : null]
  ].filter(([, v]) => v);
  const economyRows = [
    ['Établissements actifs', eco.etablissements_actifs?.value ? formatNumber(Math.round(eco.etablissements_actifs.value)) : null],
    ['Emplois salariés', eco.emplois_salaries?.value ? formatNumber(Math.round(eco.emplois_salaries.value)) : null],
    ['Taux de chômage des 15-64 ans', chomage != null ? chomage.toFixed(1) + ' %' : null],
    ['Niveau de vie médian', revenus.niveau_vie_median?.value ? formatNumber(revenus.niveau_vie_median.value) + ' €/an' : null],
    ['Taux de pauvreté', revenus.taux_pauvrete?.value != null ? revenus.taux_pauvrete.value.toFixed(1) + ' %' : null],
    ['Emplois salariés pour 100 habitants', eco.emplois_salaries?.value && pop ? (eco.emplois_salaries.value / pop * 100).toFixed(1) : null],
    ['Emplois salariés par établissement', eco.emplois_salaries?.value && eco.etablissements_actifs?.value ? (eco.emplois_salaries.value / eco.etablissements_actifs.value).toFixed(1) : null]
  ].filter(([, v]) => v);
  const economySectors = (eco.secteurs || []).filter(item => item.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 6);
  const economySizes = (eco.par_taille || []).filter(item => item.pct > 0);
  const economyExtra = [
    ['Créations d’entreprises', creations.entreprises_2025?.value != null ? formatNumber(creations.entreprises_2025.value) : null],
    ['Créations d’établissements', creations.etablissements_2025?.value != null ? formatNumber(creations.etablissements_2025.value) : null]
  ].filter(([, value]) => value);
  const ageDonut = pyramide.length ? donutChart(pyramide.map((tr, i) => ({ label: tr.label, pct: tr.pct, count: tr.value, color: ['#c76524', '#e4a86a', '#f2d0a8'][i] || '#c76524' }))) : '';
  const familySegments = familles.filter(f => f.pct > 0).map((f, i) => ({ label: f.label, pct: f.pct, count: f.value, color: ['#0d5c63', '#4fa5ac', '#8fc7cb', '#c8e6e8'][i] || '#0d5c63' }));
  const familyDonut = familySegments.length ? donutChart(familySegments) : '';
  const diplomeTop = diplomes.filter(item => item.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 5);
  const diplomaHtml = diplomeTop.length ? `<div class="territory-profile education-profile"><h4>Niveau de diplôme des 15 ans ou plus</h4>${diplomeTop.map(item => `<div><span>${escapeHtml(item.label)}</span><i><em style="width:${item.pct}%"></em></i><b>${item.pct.toFixed(1)} %</b></div>`).join('')}</div>` : '';
  const transportTop = [...transport].filter(item => item.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 4);
  const commuteHtml = transportTop.length ? `<div class="territory-profile commute-profile"><h4>Déplacements domicile–travail</h4>${transportTop.map(item => `<div><span>${escapeHtml(item.label)}</span><i><em style="width:${item.pct}%"></em></i><b>${item.pct.toFixed(1)} %</b></div>`).join('')}</div>` : '';
  const socioTop = categoriesSocio.filter(item => item.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 4);
  const socioHtml = socioTop.length ? `<div class="territory-profile socio-profile"><h4>Catégories socioprofessionnelles</h4>${socioTop.map(item => `<div><span>${escapeHtml(item.label)}</span><i><em style="width:${item.pct}%"></em></i><b>${item.pct.toFixed(1)} %</b></div>`).join('')}</div>` : '';

  const occSegs = [
    occ.proprietaires?.value != null ? { label: 'Propriétaires', pct: pctOf(occ.proprietaires.value, rp), count: occ.proprietaires.value, color: '#18753c' } : null,
    occ.locataires_prive?.value != null ? { label: 'Locataires (privé)', pct: pctOf(occ.locataires_prive.value, rp), count: occ.locataires_prive.value, color: '#0063cb' } : null,
    occ.locataires_social?.value != null ? { label: 'Locataires (social)', pct: pctOf(occ.locataires_social.value, rp), count: occ.locataires_social.value, color: '#6a4c93' } : null
  ].filter(segment => segment && segment.pct > 0);
  const occDonut = occSegs.length ? donutChart(occSegs) : '';
  const logementRows = [
    ['Parc total', parc.total?.value != null ? formatNumber(Math.round(parc.total.value)) : null],
    ['Résidences principales', rp ? formatNumber(Math.round(rp)) : null],
    ['Résidences secondaires', parc.residences_secondaires?.value != null ? formatNumber(Math.round(parc.residences_secondaires.value)) : null],
    ['Part de logement social (RPLS)', partSocial != null ? partSocial.toFixed(1) + ' %' : null],
    ['Logements vacants', vacance != null ? vacance.toFixed(1) + ' %' : null],
    ['Construits avant 1971', parc.part_avant_1971?.value != null ? parc.part_avant_1971.value.toFixed(1) + ' %' : null],
    ['Passoires énergétiques DPE F-G', renovation.dpe_fg_part?.value != null ? renovation.dpe_fg_part.value.toFixed(1) + ' %' : null],
    ['Maisons', parc.maisons?.value != null ? pctOf(parc.maisons.value, parc.residences_principales?.value)?.toFixed(1) + ' %' : null],
    ['Appartements', parc.appartements?.value != null ? pctOf(parc.appartements.value, parc.residences_principales?.value)?.toFixed(1) + ' %' : null]
  ].filter(([, v]) => v);
  const priceMarketHtml = dvf ? `<div class="housing-market"><h4>Marché immobilier · cinq dernières années</h4><div>${[
    ['Prix médian', dvf.ensemble], ['Appartements', dvf.appartements], ['Maisons', dvf.maisons]
  ].filter(([, item]) => item?.prix_m2_median).map(([label, item]) => `<article><span>${label}</span><b>${formatNumber(item.prix_m2_median)} €/m²</b><small>${formatNumber(item.ventes)} ventes analysées</small></article>`).join('')}</div><p>Source : DGFiP · statistiques DVF data.gouv.fr, période disponible 2021–2025.</p></div>` : '';
  const constructionHtml = construction.serie_annuelle?.length ? `<div class="housing-production"><h4>Construction neuve</h4><div class="production-bars">${construction.serie_annuelle.map(item => { const max = Math.max(...construction.serie_annuelle.flatMap(row => [row.autorises || 0, row.commences || 0]), 1); return `<article><span>${item.annee}</span><i><em style="height:${(item.autorises || 0) / max * 100}%"></em><strong style="height:${(item.commences || 0) / max * 100}%"></strong></i><small>${formatNumber(item.autorises || 0)} autorisés · ${formatNumber(item.commences || 0)} commencés</small></article>`; }).join('')}</div><p><i></i> autorisés <b></b> commencés · Sitadel3</p></div>` : '';
  const heatingHtml = chauffage.length ? `<div class="housing-heating"><h4>Énergie principale de chauffage</h4>${chauffage.slice(0, 5).map(item => `<div><span>${escapeHtml(item.label)}</span><i><em style="width:${item.pct}%"></em></i><b>${item.pct.toFixed(1)} %</b></div>`).join('')}</div>` : '';
  const economyDetailHtml = economySectors.length ? `<div class="economy-detail"><div class="sector-viz"><h4>Répartition des établissements par secteur</h4>${economySectors.map(item => `<div><span>${escapeHtml(item.label)}</span><i><em style="width:${item.pct}%"></em></i><b>${item.pct.toFixed(1)} %</b></div>`).join('')}</div>${economySizes.length ? `<div class="size-viz"><h4>Taille des établissements employeurs</h4><div class="size-band">${economySizes.map((item, index) => `<i style="width:${item.pct}%;--c:${['#743b00','#a6570b','#c87825','#e29a50','#efbd86','#f7dfc2'][index]}"></i>`).join('')}</div>${economySizes.map((item, index) => `<p><i style="--c:${['#743b00','#a6570b','#c87825','#e29a50','#efbd86','#f7dfc2'][index]}"></i><span>${escapeHtml(item.label)}</span><b>${item.pct.toFixed(1)} %</b></p>`).join('')}</div>` : ''}</div>` : '';

  // ---- Occupation du sol (MOS 2025, IAU Île-de-France) ----
  const mos = state.mosSummary;
  const mosSegs = mos ? [
    { label: 'Espaces construits', pct: mos.construit / mos.total * 100, color: '#a05a9c' },
    { label: 'Espaces ouverts', pct: mos.ouvert / mos.total * 100, color: '#62b467' },
    { label: 'Espaces agricoles, forestiers et naturels', pct: mos.naturel / mos.total * 100, color: '#18753c' }
  ].filter(s => s.pct > 0) : [];
  const mosRows = mos ? [
    ['Superficie communale estimée', formatNumber(Math.round(mos.total / 10000 * 10) / 10) + ' ha'],
    ['Espaces construits', formatNumber(Math.round(mos.construit / 10000 * 10) / 10) + ' ha · ' + (mos.construit / mos.total * 100).toFixed(1) + ' %'],
    ['Espaces ouverts', formatNumber(Math.round(mos.ouvert / 10000 * 10) / 10) + ' ha · ' + (mos.ouvert / mos.total * 100).toFixed(1) + ' %'],
    ['Espaces agricoles, forestiers et naturels', formatNumber(Math.round(mos.naturel / 10000 * 10) / 10) + ' ha · ' + (mos.naturel / mos.total * 100).toFixed(1) + ' %']
  ] : [];

  // ---- Politique de la ville et foncier ----
  const villeRows = [
    ['Quartiers prioritaires (QPV)', state.qpv.length ? state.qpv.length + ' quartier(s)' : 'Aucun QPV recensé'],
  ];

  // ---- Sécurité (compétence police / gendarmerie) ----
  const sec = state.securite;
  const secRows = sec ? [
    ['Force compétente', sec.institution === 'GN' ? 'Gendarmerie nationale' : 'Police nationale'],
    ['Unité de secteur', sec.service],
    ['Adresse', sec.adresse],
    ['Téléphone', sec.telephone],
    ['Horaires', sec.horaires ? sec.horaires.replace(/;\s*/g, ' · ') : null]
  ].filter(([, v]) => v) : [];
  const mobility = state.mobilitySummary;
  const readableTransitTime = value => {
    if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return value || '—';
    const [rawHour, minute] = value.split(':').map(Number); const day = Math.floor(rawHour / 24); const hour = rawHour % 24;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${day ? ` (J+${day})` : ''}`;
  };
  const mobilityHtml = mobility ? `<section class="result-section mobility-section"><h3>Offre de mobilité</h3>${mobility.stops ? `<div class="mobility-kpis"><div><b>${formatNumber(mobility.stops)}</b><span>arrêts dans la commune</span></div><div><b>${formatNumber(mobility.lines)}</b><span>lignes desservantes</span></div><div><b>${formatNumber(mobility.dailyServices)}</b><span>départs programmés par jour</span></div></div><div class="service-timeline"><b>${escapeHtml(readableTransitTime(mobility.first))}</b><i></i><b>${escapeHtml(readableTransitTime(mobility.last))}</b><span>Premier départ · dernier départ le lendemain si indiqué J+1</span></div>${mobility.routes.length ? `<div class="mobility-lines">${mobility.routes.map(route => `<div><span>${escapeHtml(route.label)}</span><section><b>${route.passages} départs programmés</b><small>${route.interval ? `Intervalle moyen : ${route.interval} min` : 'Un seul départ recensé'}${route.first && route.last ? ` · ${readableTransitTime(route.first)}–${readableTransitTime(route.last)}` : ''}</small></section></div>`).join('')}</div>` : ''}` : `<div class="nearest-stops"><strong>Aucun arrêt dans la commune</strong><span>Points d’accès les plus proches</span>${mobility.nearest.map(stop => `<div><b>${escapeHtml(stop.name)}</b><small>${stop.distance.toFixed(1)} km · ${stop.lines} ligne(s)</small></div>`).join('')}</div>`}<p class="source-note">Source : Île-de-France Mobilités · horaires GTFS du réseau publié.</p></section>` : '';

  $('drawer-body').innerHTML = `
    <section class="result-section"><h3>Chiffres clés</h3><dl class="data-grid">${kpiRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>
    ${elusRows.length ? `<section class="result-section"><h3>Élus et gouvernance</h3><dl class="data-grid">${elusRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>` : ''}
    ${secRows.length ? `<section class="result-section"><h3>Sécurité</h3><dl class="data-grid">${secRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${l === 'Téléphone' ? `<a href="tel:${escapeHtml(v.replace(/\s/g, ''))}">${escapeHtml(v)}</a>` : escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">SSMSI · OpenStreetMap — voir <a href="https://ddt95.github.io/val-doise-securite/" target="_blank" rel="noreferrer">Sécurité et prévention</a> pour la carte complète.</p></section>` : ''}
    ${demoRows.length || ageDonut ? `<section class="result-section"><h3>Population et dynamiques sociales</h3>${demoRows.length ? `<dl class="data-grid">${demoRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>` : ''}${ageDonut ? `<p class="fiche-subhead">Structure par âge</p>${ageDonut}` : ''}${familyDonut ? `<p class="fiche-subhead">Structure des ménages</p>${familyDonut}` : ''}<div class="territory-profile-grid">${diplomaHtml}${socioHtml}${commuteHtml}</div><p class="source-note">Insee · RP2023, Filosofi, REE 2024 — <a href="https://ddt95.github.io/VO-Insee/?type=commune&id=${state.code}" target="_blank" rel="noreferrer">Portrait Insee complet ↗</a></p></section>` : ''}
    ${economyRows.length ? `<section class="result-section"><h3>Économie locale</h3><dl class="data-grid">${[...economyRows, ...economyExtra].map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>${economyDetailHtml}<p class="source-note">Insee · RP2023, Filosofi, REE 2024–2025.</p></section>` : ''}
    ${logementRows.length || occDonut ? `<section class="result-section"><h3>Logement</h3>${priceMarketHtml}${occDonut ? `<p class="fiche-subhead">Statut d’occupation</p>${occDonut}` : ''}${logementRows.length ? `<dl class="data-grid">${logementRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>` : ''}${constructionHtml}${heatingHtml}<p class="source-note">Insee · RPLS · Sitadel3 · ADEME · DGFiP/DVF — voir <a href="https://ddt95.github.io/observatoire_bati/" target="_blank" rel="noreferrer">Logement &amp; Habitat</a> pour le détail.</p></section>` : ''}
    ${mosRows.length ? `<section class="result-section"><h3>Occupation du sol (MOS 2025)</h3>${mosSegs.length ? donutChart(mosSegs) : ''}<dl class="data-grid">${mosRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Institut Paris Region — millésime 2025 · estimation sur l’emprise communale.</p></section>` : ''}
    ${mobilityHtml}
    <section class="result-section"><h3>Risques majeurs recensés</h3><div class="risque-pills">${risquesHtml}</div><p class="source-note">Géorisques · GASPAR — consulter <a href="https://www.georisques.gouv.fr/" target="_blank" rel="noreferrer">georisques.gouv.fr</a> pour le détail réglementaire.</p></section>
    ${territoireRows.length ? `<section class="result-section"><h3>Artificialisation, eau et énergie</h3><dl class="data-grid">${territoireRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">Cerema · Hub’Eau · Agence ORE — voir les lectures <a href="https://ddt95.github.io/artificialisation-zan95/" target="_blank" rel="noreferrer">ZAN</a>, <a href="https://ddt95.github.io/eau95/" target="_blank" rel="noreferrer">Eau</a> et <a href="https://ddt95.github.io/transition-energetique95/" target="_blank" rel="noreferrer">Transition énergétique</a> pour le détail.</p></section>` : ''}
    <section class="result-section"><h3>Politique de la ville</h3><dl class="data-grid">${villeRows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl><p class="source-note">ANCT — quartiers prioritaires de la politique de la ville.</p></section>
  `;
  $('drawer-actions').innerHTML = `<button id="drawer-pdf" type="button">Exporter la fiche communale</button>`;
  $('drawer-pdf').onclick = () => $('exportDialog').showModal();

  if (open) { $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); }
}
$('drawer-close').addEventListener('click', () => { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); });

// ---------- QPV (statique, filtré spatialement) ----------
async function renderQpv(contour) {
  state.qpv = [];
  if (!contour) return;
  try {
    const all = await fetchTimeout(CFG.qpvFile).then(r => r.json());
    state.qpv = all.features.filter(f => { try { return turf.booleanIntersects(f, contour); } catch { return false; } });
  } catch (error) { console.warn('QPV indisponible', error); }
}

// ---------- Couches, regroupées par thème (une par lecture de l'Atlas) ----------
function setupDynamicLayers() {
  state.layerDefs = [
    { id: 'qpv', group: 'Politique de la ville', label: 'Quartiers prioritaires (QPV)', description: `${state.qpv.length ? state.qpv.length + ' quartier(s) recensé(s)' : 'Aucun QPV recensé dans cette commune'} · ANCT`, color: '#c1443c', active: state.qpv.length > 0, disabled: state.qpv.length === 0, kind: 'static' },
    { id: 'ecoles', group: 'Services publics', label: 'Établissements scolaires', description: 'Écoles, collèges, lycées publics et privés sous contrat · data.education.gouv.fr', color: '#c76524', active: true, kind: 'commune' },
    ...Object.entries(SERVICE_CATS).map(([cat, meta]) => ({ id: 'svc_' + cat, group: 'Services publics', label: meta.label, description: 'Service-Public.gouv.fr / OpenStreetMap · acces-services95', color: meta.color, active: cat === 'france_services' || cat === 'administration', kind: 'commune' })),
    ...Object.entries(FINESS_CATS).map(([cat, meta]) => ({ id: 'san_' + cat, group: 'Santé & solidarité', label: meta.label, description: 'Répertoire FINESS · ministère de la Santé', color: meta.color, active: cat === 'hopitaux' || cat === 'medecins', kind: 'commune' })),
    { id: 'batiments', group: 'Urbanisme et bâti', label: 'Bâtiments', description: 'Référentiel National des Bâtiments — tous bâtiments recensés', color: '#18753c', active: false, kind: 'zoom' },
    { id: 'cadastre', group: 'Urbanisme et bâti', label: 'Parcelles cadastrales', description: 'APICarto IGN — cadastre', color: '#6a4c93', active: false, kind: 'zoom' },
    { id: 'gpu', group: 'Urbanisme et bâti', label: 'Zonage PLU', description: 'Géoportail de l’urbanisme — zones du document d’urbanisme', color: '#0d5c63', active: false, kind: 'zoom' },
    { id: 'sup', group: 'Urbanisme et bâti', label: 'Servitudes d’utilité publique', description: 'Géoportail de l’urbanisme — SUP', color: '#a15c9e', active: false, kind: 'zoom' },
    { id: 'foncierPublic', group: 'Urbanisme et bâti', label: 'Foncier public', description: 'urbanisme95 · propriétaires publics par parcelle', color: '#000091', active: false, kind: 'zoom' },
    { id: 'mos', group: 'Urbanisme et bâti', label: 'Mode d’occupation du sol (MOS)', description: 'Institut Paris Region · millésime 2025', color: '#62b467', active: false, kind: 'zoom' },
    { id: 'rpg', group: 'Agriculture', label: 'Parcelles agricoles (RPG)', description: 'Registre parcellaire graphique · APICarto IGN', color: '#8a9a3b', active: false, kind: 'zoom' },
    { id: 'ocsge', group: 'Artificialisation & ZAN', label: 'Occupation du sol (OCS GE)', description: 'IGN · artificialisation 2024-2026', color: '#c76524', active: false, kind: 'raster' },
    { id: 'znieff1', group: 'Biodiversité', label: 'ZNIEFF de type I', description: 'Secteurs de grand intérêt biologique · APICarto IGN', color: '#e4792f', active: false, kind: 'commune' },
    { id: 'znieff2', group: 'Biodiversité', label: 'ZNIEFF de type II', description: 'Grands ensembles naturels riches · APICarto IGN', color: '#f2b37f', active: false, kind: 'commune' },
    { id: 'pnr', group: 'Biodiversité', label: 'Parcs naturels régionaux', description: 'Vexin français, Oise–Pays de France · APICarto IGN', color: '#2f6f3e', active: false, kind: 'commune' },
    { id: 'rnn', group: 'Biodiversité', label: 'Réserves naturelles', description: 'Réserves naturelles nationales · APICarto IGN', color: '#006a6f', active: false, kind: 'commune' },
    { id: 'foretsPubliques', group: 'Biodiversité', label: 'Forêts publiques', description: 'IGN BD TOPO · ONF', color: '#174f2d', active: false, kind: 'commune' },
    { id: 'jardins', group: 'Biodiversité', label: 'Jardins remarquables', description: 'Ministère de la Culture · Région Île-de-France', color: '#95c11f', active: false, kind: 'commune' },
    { id: 'busLignes', group: 'Transports', label: 'Lignes de bus (tracés)', description: 'Île-de-France Mobilités · GTFS', color: '#e4794a', active: false, kind: 'commune' },
    { id: 'railLignes', group: 'Transports', label: 'Voies ferrées (tracés)', description: 'RER, Transilien, tramway · Île-de-France Mobilités · GTFS', color: '#e1000f', active: false, kind: 'commune' },
    { id: 'busIdfm', group: 'Transports', label: 'Arrêts de bus', description: 'Île-de-France Mobilités', color: '#0063cb', active: false, kind: 'commune' },
    { id: 'railIdfm', group: 'Transports', label: 'Gares et stations (rail/tram)', description: 'Île-de-France Mobilités', color: '#7a1fa2', active: true, kind: 'commune' },
    { id: 'routes', group: 'Transports', label: 'Réseau routier (autoroute, nationale, départementale)', description: 'DDT 95 · réseau routier — code couleur IGN', color: '#e3572a', active: false, kind: 'commune' },
    { id: 'cyclable', group: 'Transports', label: 'Pistes cyclables', description: 'DDT 95 · itinéraires cyclables', color: '#18753c', active: false, kind: 'commune' },
    { id: 'inondation', group: 'Risques naturels', label: 'Zonage inondation (PPRI)', description: 'Géorisques · plans de prévention approuvés', color: '#1479c9', active: false, kind: 'wms', wms: 'PPRN_ZONE_INOND' },
    { id: 'mvt', group: 'Risques naturels', label: 'Mouvement de terrain (PPRN)', description: 'Géorisques · plans de prévention approuvés', color: '#7a4a1e', active: false, kind: 'wms', wms: 'PPRN_ZONE_MVT' },
    { id: 'argiles', group: 'Risques naturels', label: 'Retrait-gonflement des argiles', description: 'Géorisques · aléa cartographié', color: '#e76f00', active: false, kind: 'wms', wms: 'ALEARG_REALISE' },
    { id: 'icpe', group: 'Risques technologiques', label: 'Installations classées (ICPE)', description: 'Géorisques', color: '#8a3a12', active: false, kind: 'commune' },
    { id: 'ssp', group: 'Risques technologiques', label: 'Sites et sols pollués', description: 'Géorisques · BASOL/BASIAS', color: '#5c4033', active: false, kind: 'commune' }
  ];

  buildQpvLayer();
  buildCommuneLayer('ecoles', buildEcoles);
  Object.keys(SERVICE_CATS).forEach(cat => buildCommuneLayer('svc_' + cat, () => buildServiceLayer(cat)));
  Object.keys(FINESS_CATS).forEach(cat => buildCommuneLayer('san_' + cat, () => buildFinessLayer(cat)));
  buildCommuneLayer('znieff1', () => buildNature('znieff1', 'znieff1'));
  buildCommuneLayer('znieff2', () => buildNature('znieff2', 'znieff2'));
  buildCommuneLayer('pnr', () => buildNature('pnr', 'pnr'));
  buildCommuneLayer('rnn', () => buildNature('rnn', 'rnn'));
  buildCommuneLayer('foretsPubliques', buildForetsPubliques);
  buildCommuneLayer('jardins', buildJardins);
  buildCommuneLayer('busLignes', buildBusLignes);
  buildCommuneLayer('railLignes', buildRailLignes);
  buildCommuneLayer('busIdfm', () => buildIdfmArrets('busIdfm', 'bus'));
  buildCommuneLayer('railIdfm', () => buildIdfmArrets('railIdfm', ['rail', 'tram']));
  buildCommuneLayer('routes', buildRoutes);
  buildCommuneLayer('cyclable', buildCyclable);
  buildCommuneLayer('icpe', buildIcpe);
  buildCommuneLayer('ssp', buildSsp);
  buildOcsgeLayer();
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
    if (!records.length) return null;
    return L.layerGroup(records.map(r => {
      const f = r.fields;
      const isPriv = f.statut_public_prive === 'Privé';
      const icon = L.divIcon({ className: '', html: `<div class="theme-marker glyph school${isPriv ? ' alt' : ''}">🏫</div>`, iconSize: [22, 22] });
      return L.marker([f.latitude, f.longitude], { icon }).bindPopup(`<strong>${escapeHtml(f.nom_etablissement)}</strong><br>${escapeHtml(f.type_etablissement)} · ${escapeHtml(f.statut_public_prive)}<br>${escapeHtml(f.adresse_1 || '')}`);
    }));
  });
}

function buildServiceLayer(category) {
  const records = state.services.filter(r => r.category === category);
  if (!records.length) return Promise.resolve(null);
  const meta = SERVICE_CATS[category];
  return Promise.resolve(L.layerGroup(records.map(r => {
    const glyph = SERVICE_TYPE_GLYPHS[r.type] || SERVICE_CAT_GLYPHS[category] || meta.label[0];
    const icon = L.divIcon({ className: '', html: `<div class="theme-marker glyph svc" style="background:${meta.color}">${glyph}</div>`, iconSize: [22, 22] });
    return L.marker([r.lat, r.lon], { icon }).bindPopup(`<strong>${escapeHtml(r.name)}</strong><br>${escapeHtml(r.typeLabel || meta.label)}<br>${escapeHtml(r.address || '')}`);
  })));
}

function buildFinessLayer(category) {
  const records = state.finess.filter(r => r.cat === category);
  if (!records.length) return Promise.resolve(null);
  const meta = FINESS_CATS[category];
  return Promise.resolve(L.layerGroup(records.map(r => {
    const glyph = r.urgences ? '🚑' : (FINESS_CAT_GLYPHS[category] || meta.label[0]);
    const icon = L.divIcon({ className: '', html: `<div class="theme-marker glyph svc" style="background:${meta.color}">${glyph}</div>`, iconSize: [22, 22] });
    return L.marker([r.lat, r.lon], { icon }).bindPopup(`<strong>${escapeHtml(r.nom)}</strong><br>${escapeHtml(meta.label)}${r.urgences ? ' · Urgences' : ''}<br>${escapeHtml(r.adresse)}${r.tel ? '<br>' + escapeHtml(r.tel) : ''}`);
  })));
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

function buildForetsPubliques() {
  if (!state.contour) return Promise.resolve(null);
  const b = L.geoJSON(state.contour).getBounds();
  const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()},EPSG:4326`;
  const url = `${CFG.geopfWfs}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:foret_publique&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&BBOX=${encodeURIComponent(bbox)}`;
  return fetch(url).then(r => r.ok ? r.json() : { features: [] }).then(d => {
    if (!d.features?.length) return null;
    return L.geoJSON(d, {
      style: { color: '#174f2d', weight: 2, opacity: 1, fillColor: '#174f2d', fillOpacity: 0.15 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.toponyme || 'Forêt publique', { sticky: true })
    });
  }).catch(() => null);
}

function buildJardins() {
  const url = new URL(CFG.jardinsApi);
  url.searchParams.set('where', `code_commune="${state.code}"`);
  url.searchParams.set('limit', '50');
  return fetch(url).then(r => r.json()).then(d => {
    const records = d.results || [];
    if (!records.length) return null;
    return L.layerGroup(records.filter(r => r.latitude && r.longitude).map(r => {
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker" style="background:#95c11f">J</div>', iconSize: [22, 22] });
      return L.marker([r.latitude, r.longitude], { icon }).bindPopup(`<strong>${escapeHtml(r.nom_du_jardin)}</strong><br>${escapeHtml(r.adresse_complete || '')}`);
    }));
  });
}

function parseWindowJson(text) {
  const start = text.indexOf('{');
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return JSON.parse(text.slice(start, i + 1)); }
  }
  throw new Error('JSON introuvable');
}

let roadsCache = null;
const ROAD_STYLES = {
  Autoroute: { color: '#c1121f', weight: 4.5, opacity: 0.95 },
  Nationale: { color: '#e3572a', weight: 3.2, opacity: 0.95 },
  Départementale: { color: '#f2a900', weight: 2.2, opacity: 0.9 },
  Bretelle: { color: '#c1121f', weight: 1.8, opacity: 0.7 }
};
const ROAD_DEFAULT_STYLE = { color: '#3d434b', weight: 1.3, opacity: 0.8 };
function roadStyle(f) { return ROAD_STYLES[f.properties?.classement] || ROAD_DEFAULT_STYLE; }
function roadLabel(f) {
  const c = f.properties?.classement;
  const kind = c === 'Autoroute' ? 'Autoroute' : c === 'Nationale' ? 'Route nationale' : c === 'Départementale' ? 'Route départementale' : c === 'Bretelle' ? 'Bretelle d’accès' : 'Voirie locale';
  return `${kind}${f.properties?.numero ? ' ' + f.properties.numero : ''}${f.properties?.toponyme ? ' — ' + f.properties.toponyme : ''}`;
}
function buildRoutes() {
  if (!state.contour) return Promise.resolve(null);
  const loadRoads = roadsCache || fetch(CFG.roadsFile).then(r => r.text()).then(parseWindowJson);
  roadsCache = loadRoads;
  return loadRoads.then(fc => {
    const features = (fc.features || []).filter(f => { try { return turf.booleanIntersects(f, state.contour); } catch { return false; } });
    if (!features.length) return null;
    // Les routes principales sont dessinées en dernier pour rester lisibles
    // au-dessus des petites voiries, comme sur les cartes IGN.
    const order = { Autoroute: 3, Nationale: 2, Départementale: 1 };
    features.sort((a, b) => (order[a.properties?.classement] || 0) - (order[b.properties?.classement] || 0));
    return L.geoJSON({ type: 'FeatureCollection', features }, {
      style: roadStyle,
      onEachFeature: (f, layer) => layer.bindTooltip(roadLabel(f), { sticky: true })
    });
  }).catch(() => null);
}

let cycleCache = null;
function buildCyclable() {
  if (!state.contour) return Promise.resolve(null);
  const loadCycle = cycleCache || fetch(CFG.cycleFile).then(r => r.text()).then(parseWindowJson);
  cycleCache = loadCycle;
  return loadCycle.then(fc => {
    const features = (fc.features || []).filter(f => { try { return turf.booleanIntersects(f, state.contour); } catch { return false; } });
    if (!features.length) return null;
    return L.geoJSON({ type: 'FeatureCollection', features }, {
      style: { color: '#18753c', weight: 2.5, opacity: 0.85 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.ame_d || 'Aménagement cyclable', { sticky: true })
    });
  }).catch(() => null);
}

function buildIcpe() {
  const url = new URL(CFG.icpeApi);
  url.searchParams.set('code_insee', state.code);
  url.searchParams.set('page_size', '100');
  return fetch(url).then(r => r.json()).then(d => {
    const records = d.data || [];
    if (!records.length) return null;
    return L.layerGroup(records.filter(r => r.latitude && r.longitude).map(r => {
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker" style="background:#8a3a12">I</div>', iconSize: [22, 22] });
      return L.marker([r.latitude, r.longitude], { icon }).bindPopup(`<strong>${escapeHtml(r.raisonSociale)}</strong><br>${escapeHtml(r.adresse1 || '')}<br>${escapeHtml(r.statutSeveso || '')} · ${escapeHtml(r.etatActivite || '')}`);
    }));
  }).catch(() => null);
}

function buildSsp() {
  const url = new URL(CFG.sspApi);
  url.searchParams.set('code_insee', state.code);
  url.searchParams.set('page_size', '100');
  return fetch(url).then(r => r.json()).then(d => {
    const records = d.casias?.data || [];
    if (!records.length) return null;
    return L.layerGroup(records.filter(r => r.geom?.coordinates).map(r => {
      const [lon, lat] = r.geom.coordinates;
      const icon = L.divIcon({ className: '', html: '<div class="theme-marker" style="background:#5c4033">S</div>', iconSize: [22, 22] });
      return L.marker([lat, lon], { icon }).bindPopup(`<strong>${escapeHtml(r.nom_etablissement || 'Site')}</strong><br>${escapeHtml(r.adresse || '')}<br>${escapeHtml(r.statut || '')}`);
    }));
  }).catch(() => null);
}

function buildOcsgeLayer() {
  const layer = L.tileLayer(`${CFG.ocsgeWmts}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OCSGE.ARTIF.2024-2026&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`, { opacity: 0.65, attribution: 'IGN OCS GE' });
  state.layers.ocsge = layer;
  if (state.layerDefs.find(l => l.id === 'ocsge')?.active) layer.addTo(map);
}

async function loadSup() {
  const b = map.getBounds();
  const geom = bboxGeom(b);
  try {
    const data = await fetchTimeout(CFG.gpuSupApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geom }) }).then(r => r.ok ? r.json() : { features: [] });
    if (state.layers.sup) map.removeLayer(state.layers.sup);
    state.layers.sup = L.geoJSON(data, {
      style: { color: '#a15c9e', weight: 1.5, opacity: 0.9, fillColor: '#a15c9e', fillOpacity: 0.15 },
      onEachFeature: (f, layer) => {
        layer.bindTooltip(f.properties?.nomass || f.properties?.suptype || 'Servitude', { sticky: true });
        layer.on('click', e => { L.DomEvent.stopPropagation(e); openSupDrawer(f); });
      }
    });
    if (state.layerDefs.find(l => l.id === 'sup')?.active) state.layers.sup.addTo(map);
  } catch (error) { console.warn('SUP indisponible', error); }
}

let foncierPublicCache = null;
async function loadFoncierPublic() {
  const b = map.getBounds();
  const geom = bboxGeom(b);
  try {
    foncierPublicCache = foncierPublicCache || fetchTimeout(CFG.foncierPublicFile).then(r => r.json());
    const [publicData, response] = await Promise.all([
      foncierPublicCache,
      fetchTimeout(`${CFG.cadastreApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json()).catch(() => fetchTimeout(CFG.cadastreApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geom }) }).then(r => r.json()))
    ]);
    const features = (response?.features || []).filter(f => publicData[f.properties?.idu || f.id]);
    if (state.layers.foncierPublic) map.removeLayer(state.layers.foncierPublic);
    state.layers.foncierPublic = L.geoJSON(features, {
      style: f => { const info = publicData[f.properties?.idu || f.id]; const color = PUBLIC_LAND_COLORS[info?.[0]] || '#687787'; return { color, weight: 2, opacity: 1, fillColor: color, fillOpacity: 0.5 }; },
      onEachFeature: (f, layer) => {
        const info = publicData[f.properties?.idu || f.id];
        layer.bindTooltip(`<strong>${escapeHtml(info?.[2] || 'Propriétaire public')}</strong><br>${escapeHtml(info?.[1] || '')}`, { sticky: true });
        layer.on('click', e => { L.DomEvent.stopPropagation(e); openFoncierPublicDrawer(f, info); });
      }
    });
    if (state.layerDefs.find(l => l.id === 'foncierPublic')?.active) state.layers.foncierPublic.addTo(map);
  } catch (error) { console.warn('Foncier public indisponible', error); }
}

async function loadMos() {
  if (!state.contour) return;
  // Utilise l’emprise de la commune, pas la fenêtre courante de la carte :
  // celle-ci peut encore être en train de se recentrer sur la commune au
  // moment de l’appel et renvoyait des données d’une zone sans rapport.
  const b = L.geoJSON(state.contour).getBounds();
  const geometry = JSON.stringify({ xmin: b.getWest(), ymin: b.getSouth(), xmax: b.getEast(), ymax: b.getNorth(), spatialReference: { wkid: 4326 } });
  try {
    let features = [];
    for (let offset = 0, page = 0; page < 12; page++) {
      const url = new URL(CFG.mosApi);
      url.searchParams.set('f', 'geojson');
      url.searchParams.set('geometry', geometry);
      url.searchParams.set('geometryType', 'esriGeometryEnvelope');
      url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
      url.searchParams.set('outFields', '*');
      url.searchParams.set('inSR', '4326');
      url.searchParams.set('outSR', '4326');
      url.searchParams.set('resultOffset', String(offset));
      const data = await fetchTimeout(url).then(r => r.json());
      features = features.concat(data.features || []);
      if (!data.exceededTransferLimit) break;
      offset += (data.features || []).length || 1000;
    }
    if (state.layers.mos) map.removeLayer(state.layers.mos);
    state.layers.mos = L.geoJSON({ type: 'FeatureCollection', features }, {
      style: f => { const code = f.properties?.mos2025; const color = mosColor(code); return { color, weight: 0.5, opacity: 0.6, fillColor: color, fillOpacity: 0.55 }; },
      onEachFeature: (f, layer) => layer.bindTooltip(MOS_LABELS[f.properties?.mos2025] || 'Occupation du sol', { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'mos')?.active) state.layers.mos.addTo(map);
  } catch (error) { console.warn('MOS indisponible', error); }
}

let mobilityCache = null;
const RAIL_GTFS_TYPES = ['0', '1', '2', '7']; // tram, métro, rail, funiculaire
async function loadMobilitySummary(contour) {
  try {
    const loadMobility = mobilityCache || fetch(CFG.mobilityFile).then(r => r.text()).then(parseWindowJson);
    mobilityCache = loadMobility;
    const data = await loadMobility;
    const stops = (data.stops || []).filter(stop => {
      try { return turf.booleanPointInPolygon(turf.point([stop.lon, stop.lat]), contour); } catch { return false; }
    });
    const centre = turf.centroid(contour);
    const nearest = [];
    const seenNearest = new Set();
    (data.stops || []).map(stop => ({ ...stop, distance: turf.distance(centre, turf.point([stop.lon, stop.lat]), { units: 'kilometers' }) })).sort((a, b) => a.distance - b.distance).forEach(stop => {
      if (nearest.length >= 3 || seenNearest.has(stop.name)) return;
      seenNearest.add(stop.name);
      nearest.push({ name: stop.name, distance: stop.distance, lines: (stop.routes || []).length });
    });
    const routeIds = [...new Set(stops.flatMap(stop => stop.routes || []))];
    const routeStats = routeIds.map(id => {
      const route = data.routes?.[id] || {};
      const samples = stops.map(stop => stop.times?.[id] || []).filter(times => times.length);
      const times = samples.sort((a, b) => b.length - a.length)[0] || [];
      const minutes = times.map(time => { const [h, m] = time.split(':').map(Number); return h * 60 + m; }).filter(Number.isFinite).sort((a, b) => a - b);
      const span = minutes.length > 1 ? minutes.at(-1) - minutes[0] : 0;
      const interval = minutes.length > 1 ? Math.round(span / (minutes.length - 1)) : null;
      return { id, label: route.short || route.long || 'Ligne', passages: minutes.length, interval, first: times[0] || null, last: times.at(-1) || null, rail: RAIL_GTFS_TYPES.includes(String(route.type)) };
    }).sort((a, b) => b.passages - a.passages);
    const active = routeStats.filter(route => route.passages > 0);
    state.mobilitySummary = {
      stops: new Set(stops.map(stop => stop.name)).size,
      lines: routeStats.length,
      busLines: routeStats.filter(route => !route.rail).length,
      railLines: routeStats.filter(route => route.rail).length,
      dailyServices: active.reduce((sum, route) => sum + route.passages, 0),
      first: active.map(route => route.first).filter(Boolean).sort()[0] || null,
      last: active.map(route => route.last).filter(Boolean).sort().at(-1) || null,
      routes: active.slice(0, 6), nearest
    };
  } catch (error) {
    console.warn('Synthèse mobilités indisponible', error);
    state.mobilitySummary = null;
  }
}
function buildTransportLignes(isRail) {
  if (!state.contour) return Promise.resolve(null);
  const loadMobility = mobilityCache || fetch(CFG.mobilityFile).then(r => r.text()).then(parseWindowJson);
  mobilityCache = loadMobility;
  return loadMobility.then(d => {
    const routes = d.routes || {};
    const layers = [];
    Object.values(routes).forEach(route => {
      if (!route.geometry?.length) return;
      if (RAIL_GTFS_TYPES.includes(String(route.type)) !== isRail) return;
      const inside = route.geometry.some(([lat, lon]) => { try { return turf.booleanPointInPolygon(turf.point([lon, lat]), state.contour); } catch { return false; } });
      if (!inside) return;
      const color = '#' + (route.color || (isRail ? 'e1000f' : '0063cb'));
      const label = `${route.short || route.long || 'Ligne'}${route.long && route.short !== route.long ? ' · ' + route.long : ''}`;
      layers.push(L.polyline(route.geometry, { color, weight: isRail ? 3.6 : 3, opacity: 0.9, dashArray: isRail ? '1,6' : null }).bindTooltip(label, { sticky: true }));
    });
    return layers.length ? L.layerGroup(layers) : null;
  }).catch(() => null);
}
function buildBusLignes() { return buildTransportLignes(false); }
function buildRailLignes() { return buildTransportLignes(true); }

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

const ZOOM_LAYER_LOADERS = { batiments: loadBatiments, cadastre: loadCadastre, rpg: loadRpg, gpu: loadGpu, sup: loadSup, foncierPublic: loadFoncierPublic, mos: loadMos };
function runZoomLayerLoader(id) {
  state.layerLoading.add(id);
  document.querySelector(`[data-layer-row="${id}"]`)?.classList.add('loading');
  Promise.resolve(ZOOM_LAYER_LOADERS[id]()).finally(() => {
    state.layerLoading.delete(id);
    document.querySelector(`[data-layer-row="${id}"]`)?.classList.remove('loading');
  });
}

function refreshDetailLayers() {
  map.invalidateSize();
  updateZoomNotice();
  if (map.getZoom() < CFG.zoomGated) return;
  Object.keys(ZOOM_LAYER_LOADERS).forEach(id => { if (state.layerDefs.find(l => l.id === id)?.active) runZoomLayerLoader(id); });
}

function updateZoomNotice() {
  const pending = state.layerDefs.filter(l => l.kind === 'zoom' && l.active).map(l => l.label);
  const el = $('map-intro');
  if (map.getZoom() < CFG.zoomGated && pending.length) {
    el.hidden = false;
    el.querySelector('strong').textContent = 'Zoomez pour afficher';
    el.querySelector('span').textContent = `${pending.join(', ')}. Ces couches se chargent uniquement à l’échelle de la rue.`;
  } else {
    el.hidden = true;
  }
}

function bboxGeom(b) {
  return { type: 'Polygon', coordinates: [[[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]]] };
}

async function loadBatiments() {
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  try {
    let url = `${CFG.rnbApi}?bbox=${bbox}&limit=100`;
    let all = [];
    for (let page = 0; page < 8 && url; page++) {
      const data = await fetchTimeout(url).then(r => r.json());
      all = all.concat(data.features || []);
      url = (data.links || []).find(l => l.rel === 'next')?.href || null;
    }
    if (state.layers.batiments) map.removeLayer(state.layers.batiments);
    state.layers.batiments = L.geoJSON({ type: 'FeatureCollection', features: all }, {
      style: { color: '#18753c', weight: 1, opacity: 0.9, fillColor: '#18753c', fillOpacity: 0.35 },
      pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 5, color: '#18753c', weight: 1, fillColor: '#18753c', fillOpacity: 0.7 }),
      onEachFeature: (f, layer) => layer.on('click', e => { L.DomEvent.stopPropagation(e); openBuildingDrawer(f); })
    });
    if (state.layerDefs.find(l => l.id === 'batiments')?.active) state.layers.batiments.addTo(map);
  } catch (error) { console.warn('RNB indisponible', error); }
}

async function loadCadastre() {
  const b = map.getBounds();
  const geom = bboxGeom(b);
  try {
    let response;
    try {
      response = await fetchTimeout(`${CFG.cadastreApi}?geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    } catch {
      response = await fetchTimeout(CFG.cadastreApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geom }) }).then(r => r.json());
    }
    const features = response?.features || [];
    if (state.layers.cadastre) map.removeLayer(state.layers.cadastre);
    state.layers.cadastre = L.geoJSON(features, {
      style: { color: '#6a4c93', weight: 1, opacity: 0.85, fillOpacity: 0 },
      onEachFeature: (f, layer) => {
        layer.bindTooltip(`Parcelle ${f.properties?.section || ''}${f.properties?.numero || ''}`, { sticky: true });
        layer.on('click', e => { L.DomEvent.stopPropagation(e); openCadastreDrawer(f); });
      }
    });
    if (state.layerDefs.find(l => l.id === 'cadastre')?.active) state.layers.cadastre.addTo(map);
  } catch (error) { console.warn('Cadastre indisponible', error); }
}

async function loadRpg() {
  const b = map.getBounds();
  const geom = bboxGeom(b);
  try {
    const data = await fetchTimeout(`${CFG.rpgApi}?annee=2024&geom=${encodeURIComponent(JSON.stringify(geom))}`).then(r => r.json());
    if (state.layers.rpg) map.removeLayer(state.layers.rpg);
    state.layers.rpg = L.geoJSON(data, {
      style: { color: '#8a9a3b', weight: 1, opacity: 0.9, fillColor: '#8a9a3b', fillOpacity: 0.3 },
      onEachFeature: (f, layer) => layer.bindTooltip(f.properties?.code_cultu ? `Culture ${f.properties.code_cultu}` : 'Parcelle RPG', { sticky: true })
    });
    if (state.layerDefs.find(l => l.id === 'rpg')?.active) state.layers.rpg.addTo(map);
  } catch (error) { console.warn('RPG indisponible', error); }
}

async function loadGpu() {
  try {
    const data = await fetchTimeout(`${CFG.gpuApi}?partition=DU_${state.code}`).then(r => r.ok ? r.json() : { features: [] });
    if (state.layers.gpu) map.removeLayer(state.layers.gpu);
    state.layers.gpu = L.geoJSON(data, {
      style: { color: '#0d5c63', weight: 1, opacity: 0.85, fillColor: '#0d5c63', fillOpacity: 0.15 },
      onEachFeature: (f, layer) => {
        layer.bindTooltip(`Zone ${f.properties?.libelle || ''} — ${f.properties?.libelong || f.properties?.typezone || ''}`, { sticky: true });
        layer.on('click', e => { L.DomEvent.stopPropagation(e); openGpuDrawer(f); });
      }
    });
    if (state.layerDefs.find(l => l.id === 'gpu')?.active) state.layers.gpu.addTo(map);
  } catch (error) { console.warn('GPU indisponible', error); }
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
  $('drawer-body').innerHTML = `<section class="result-section"><h3>Bâtiment</h3><dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section><section class="result-section" id="bdnbSection"><h3>Détail du bâtiment (BDNB)</h3><p class="source-note">Recherche en cours…</p></section>`;
  $('drawer-actions').innerHTML = `<button id="drawer-back" type="button">← Retour à la fiche commune</button>`;
  $('drawer-back').onclick = () => renderFicheDrawer(true);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  if (feature.id) loadBdnb(feature.id);
}

async function loadBdnb(rnbId) {
  const section = $('bdnbSection');
  try {
    const rel = await fetch(`${CFG.bdnbApi}/donnees/batiment_construction?rnb_id=eq.${rnbId}&select=batiment_groupe_id&limit=1`).then(r => r.json());
    const groupId = rel?.[0]?.batiment_groupe_id;
    if (!groupId) { section.innerHTML = '<h3>Détail du bâtiment (BDNB)</h3><p class="source-note">Aucune correspondance BDNB pour ce bâtiment.</p>'; return; }
    const [dpe, rpls, risks, ffo] = await Promise.all([
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_dpe_representatif_logement?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null),
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_rpls?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null),
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_risques?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null),
      fetch(`${CFG.bdnbApi}/donnees/batiment_groupe_ffo_bat?batiment_groupe_id=eq.${groupId}&limit=1`).then(r => r.json()).then(d => d[0]).catch(() => null)
    ]);
    const rows = [
      ffo?.usage_niveau_1_txt ? ['Usage principal', ffo.usage_niveau_1_txt] : null,
      ffo?.annee_construction ? ['Année de construction (fichiers fonciers)', ffo.annee_construction] : null,
      ffo?.nb_log ? ['Nombre de logements', formatNumber(ffo.nb_log)] : null,
      ffo?.nb_niveau ? ['Nombre de niveaux', ffo.nb_niveau] : null,
      ffo?.mat_mur_txt ? ['Matériau des murs', ffo.mat_mur_txt] : null,
      ffo?.mat_toit_txt ? ['Matériau de toiture', ffo.mat_toit_txt] : null,
      dpe?.classe_bilan_dpe ? ['DPE — classe énergie', dpe.classe_bilan_dpe] : null,
      dpe?.classe_emission_ges ? ['DPE — classe GES', dpe.classe_emission_ges] : null,
      rpls?.nb_log ? ['Logements du parc social (RPLS)', formatNumber(rpls.nb_log)] : null,
      risks?.alea_argile ? ['Aléa retrait-gonflement argiles', risks.alea_argile] : null,
      risks?.alea_radon ? ['Aléa radon', risks.alea_radon] : null,
      risks?.alea_sismique ? ['Aléa sismique', risks.alea_sismique] : null
    ].filter(Boolean);
    section.innerHTML = `<h3>Détail du bâtiment (BDNB)</h3>${rows.length ? `<dl class="data-grid">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>` : '<p class="source-note">Aucune donnée BDNB publiée pour ce bâtiment.</p>'}<p class="source-note">Base de Données Nationale des Bâtiments — voir aussi <a href="https://ddt95.github.io/observatoire_bati/" target="_blank" rel="noreferrer">Logement &amp; Habitat</a>.</p>`;
  } catch (error) {
    section.innerHTML = '<h3>Détail du bâtiment (BDNB)</h3><p class="source-note">Interrogation BDNB indisponible pour le moment.</p>';
  }
}

function openInfoDrawer({ kicker, title, sub, sections }) {
  state.drawerMode = 'batiment';
  $('drawer-kicker').textContent = kicker;
  $('drawer-title').textContent = title;
  $('drawer-sub').textContent = sub;
  $('drawer-body').innerHTML = sections.map(s => `<section class="result-section"><h3>${escapeHtml(s.title)}</h3>${s.rows?.length ? `<dl class="data-grid">${s.rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd>${typeof v === 'object' ? v.html : escapeHtml(v)}</dd></div>`).join('')}</dl>` : ''}${s.note ? `<p class="source-note">${s.note}</p>` : ''}</section>`).join('');
  $('drawer-actions').innerHTML = `<button id="drawer-back" type="button">← Retour à la fiche commune</button>`;
  $('drawer-back').onclick = () => renderFicheDrawer(true);
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
}

function openCadastreDrawer(feature) {
  const p = feature.properties || {};
  openInfoDrawer({
    kicker: 'PARCELLE CADASTRALE',
    title: `${p.section || ''}${p.numero || ''}`.trim() || 'Parcelle',
    sub: p.idu || '',
    sections: [{
      title: 'Cadastre',
      rows: [
        ['Commune', p.nom_com],
        ['Section', p.section],
        ['Numéro', p.numero],
        ['Contenance', p.contenance ? `${formatNumber(p.contenance)} m²` : null],
        ['Identifiant (IDU)', p.idu]
      ].filter(([, v]) => v),
      note: 'APICarto IGN — cadastre'
    }]
  });
}

function openGpuDrawer(feature) {
  const p = feature.properties || {};
  openInfoDrawer({
    kicker: 'ZONAGE PLU',
    title: p.libelle || 'Zone',
    sub: p.idurba || '',
    sections: [{
      title: 'Document d’urbanisme',
      rows: [
        ['Zone', p.libelle],
        ['Libellé', p.libelong],
        ['Type de zone', p.typezone],
        ['Document', p.idurba],
        ['Approuvé le', p.datappro],
        ['Règlement', p.urlfic ? { html: `<a href="${escapeHtml(p.urlfic)}" target="_blank" rel="noreferrer">Consulter le PDF ↗</a>` } : null]
      ].filter(([, v]) => v),
      note: 'Géoportail de l’urbanisme (GPU) — zone-urba'
    }]
  });
}

function openSupDrawer(feature) {
  const p = feature.properties || {};
  openInfoDrawer({
    kicker: 'SERVITUDE D’UTILITÉ PUBLIQUE',
    title: p.nomass || p.suptype || 'Servitude',
    sub: p.suptype || '',
    sections: [{
      title: 'Servitude',
      rows: [
        ['Type', p.suptype],
        ['Nature', p.typeass],
        ['Nom', p.nomass],
        ['Source', p.srcgeoass]
      ].filter(([, v]) => v),
      note: 'Géoportail de l’urbanisme (GPU) — servitudes d’utilité publique'
    }]
  });
}

function openFoncierPublicDrawer(feature, info) {
  const p = feature.properties || {};
  openInfoDrawer({
    kicker: 'FONCIER PUBLIC',
    title: `Parcelle ${p.section || ''}${p.numero || ''}`.trim() || 'Parcelle',
    sub: p.idu || '',
    sections: [{
      title: 'Propriété publique',
      rows: [
        ['Propriétaire', toTitleCase(info?.[2])],
        ['Catégorie', toTitleCase(info?.[1])],
        ['Contenance', p.contenance ? `${formatNumber(p.contenance)} m²` : null]
      ].filter(([, v]) => v),
      note: 'urbanisme95 · propriétaires publics par parcelle (DGFiP)'
    }]
  });
}

// ---------- Panneau de couches, regroupé par thème ----------
function renderControls() {
  const root = $('layer-list');
  const groups = [...new Set(state.layerDefs.map(x => x.group))];
  root.innerHTML = groups.map(group => `<div class="layer-group"><div class="layer-group-head"><strong>${group}</strong><button type="button" class="layer-group-hide" data-hide-group="${escapeHtml(group)}">Tout masquer</button></div>${state.layerDefs.filter(x => x.group === group).map(x => `<div class="layer-row" data-layer-row="${x.id}" style="${x.disabled ? 'opacity:.5;pointer-events:none' : ''}"><button class="switch" type="button" data-layer="${x.id}" aria-label="Afficher ${x.label}" aria-pressed="${x.active}"></button><div class="layer-copy"><strong>${x.label}</strong><span>${x.description}${x.kind === 'zoom' ? ' · zoomez pour afficher' : ''}</span></div><i class="swatch" style="background:${x.color}"></i></div>`).join('')}</div>`).join('');
  root.querySelectorAll('[data-layer-row]').forEach(row => row.addEventListener('click', () => toggleLayer(row.dataset.layerRow)));
  root.querySelectorAll('[data-hide-group]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const group = btn.dataset.hideGroup;
    state.layerDefs.filter(d => d.group === group && d.active && !d.disabled).forEach(d => toggleLayer(d.id));
  }));
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
    if (def.kind === 'zoom' && map.getZoom() >= CFG.zoomGated && ZOOM_LAYER_LOADERS[id]) {
      runZoomLayerLoader(id);
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

async function openPrintPage(mode) {
  exportDialog.close();
  if (mode !== 'carte' && state.mosPromise) {
    await Promise.race([state.mosPromise, new Promise(resolve => setTimeout(resolve, 4500))]);
  }
  renderFicheDrawer(true);
  if (mode !== 'carte') {
    localStorage.setItem('pc-export-snapshot', JSON.stringify({
      state: { nom: state.nom, code: state.code, contour: state.contour },
      drawerHtml: $('drawer-body').innerHTML,
      octeUrl: `${CFG.pdfBase}/${encodeURIComponent(state.nom)}.pdf`
    }));
  }
  window.open(`print.html?mode=${mode}`, '_blank');
}

$('exportMap').addEventListener('click', () => openPrintPage('carte'));
$('exportOcte').addEventListener('click', () => openPrintPage('complete'));
$('exportSummary').addEventListener('click', () => openPrintPage('synthese'));

window.pcApp = { state, MOS_LABELS, PUBLIC_LAND_COLORS, mosColor, roadStyle, escapeHtml, formatNumber, octeUrl: () => `${CFG.pdfBase}/${encodeURIComponent(state.nom)}.pdf` };
