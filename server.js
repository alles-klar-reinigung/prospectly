// Prospectly v2 – nur Cold Calls: Leads suchen, sortieren (Cold Calls / Aussortiert), anrufen, auswerten.
// Keine npm-Abhängigkeiten, Node >= 18. Start: node server.js
// Prospectly Backend – keine npm-Abhängigkeiten, Node >= 18. Start: node server.js
'use strict';
if (+process.versions.node.split('.')[0] < 18) { console.error('\n!! Prospectly braucht Node.js ab Version 18 (installiert: ' + process.version + '). Bitte die LTS-Version von nodejs.org installieren.\n'); process.exit(1); }
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const dns = require('dns').promises, net = require('net'), tls = require('tls');
try { require('dns').setDefaultResultOrder('ipv4first'); } catch {}   // viele Heimnetze haben kaputtes IPv6: das führte zu „CONNECT_TIMEOUT“

// ---------- .env laden
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}


// ---------- Grundlagen
const E = process.env, PORT = +E.PORT || 3000, HOST = E.HOST || '127.0.0.1';
const DD = process.env.DATA_DIR || __dirname, DBF = path.join(DD, 'data.json'), BK = path.join(DD, 'backups');
let db = { leads: {}, campaigns: [], jobs: [], log: [], cfg: {}, seen: {} };

// ---------- Sicherheit: Backups + sicheres Laden
function backup() {
  try {
    if (!fs.existsSync(DBF)) return;
    JSON.parse(fs.readFileSync(DBF, 'utf8'));
    fs.mkdirSync(BK, { recursive: true });
    fs.copyFileSync(DBF, path.join(BK, 'data-' + new Date().toISOString().slice(0, 10) + '.json'));
    for (const x of fs.readdirSync(BK).filter(x => /^data-.*\.json$/.test(x)).sort().slice(0, -14)) fs.unlinkSync(path.join(BK, x));
  } catch (e) { console.error('Backup fehlgeschlagen:', e.message); }
}
backup(); setInterval(backup, 6 * 36e5);

try { db = { ...db, ...JSON.parse(fs.readFileSync(DBF, 'utf8')) }; }
catch (e) {
  if (fs.existsSync(DBF)) {
    const c = DBF + '.defekt-' + Date.now();
    fs.renameSync(DBF, c);
    console.error('\n!! data.json war nicht lesbar und wurde gesichert als ' + c + '.\n!! Alte Stände liegen im Ordner "backups". Zum Wiederherstellen eine Datei daraus als data.json einsetzen.\n');
  }
}

// Speichern: nie den Prozess beenden, bei Fehlern (z. B. Virenscanner unter Windows) wird neu versucht
let dirty = false, rev = 1;
const save = () => { dirty = true; rev++; };
function flush() {
  try {
    fs.writeFileSync(DBF + '.tmp', JSON.stringify(db));
    try { fs.renameSync(DBF + '.tmp', DBF); }
    catch { fs.copyFileSync(DBF + '.tmp', DBF); try { fs.unlinkSync(DBF + '.tmp'); } catch {} }
    dirty = false; return true;
  } catch (e) { console.error('Speichern fehlgeschlagen (neuer Versuch folgt):', e.message); dirty = true; return false; }
}
setInterval(() => { if (dirty) flush(); }, 1000);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { flush(); process.exit(); });
process.on('uncaughtException', e => console.error('Unerwarteter Fehler:', e));
process.on('unhandledRejection', e => console.error('Unbehandelter Fehler:', e));

const uid = () => crypto.randomBytes(5).toString('hex'), now = () => Date.now();
const fatal = m => Object.assign(Error(m), { fatal: 1 });
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const log = m => { db.log.unshift({ t: now(), m }); db.log.length = Math.min(db.log.length, 100); save(); console.log(m); };
db.seen = db.seen || {}; db.campaigns = db.campaigns || []; db.jobs = db.jobs || []; db.log = db.log || []; db.cfg = db.cfg || {};
if (!db.cfg.token) { db.cfg.token = crypto.randomBytes(16).toString('hex'); save(); }
Object.assign(E, db.cfg.s || {});
const TOKEN = E.ADMIN_TOKEN || db.cfg.token;
const str = (v, n = 500) => String(v ?? '').slice(0, n);


// ---------- Betriebe erkennen: Duplikate, Social-Media, Ketten
// ---------- Betriebe erkennen: Duplikate, Social-Media, Ketten
// Seiten, die KEINE eigene Website sind (der Betrieb gilt dann als „ohne Website“)
const NOTOWN = /facebook|fb\.com|fb\.me|instagram|linktr\.ee|linkin\.bio|youtube|youtu\.be|tiktok|twitter\.com|^x\.com|yelp|tripadvisor|booksy|treatwell|google\.|goo\.gl|business\.site|wa\.me|whatsapp|pinterest|xing\.com|linkedin|lieferando|wolt\.com|opentable|quandoo|gelbeseiten|11880|dasoertliche|golocal|meinestadt/i;
// Kostenlose Baukasten-Adressen: Website existiert, wirkt aber unprofessionell
const FREEHOST = /wixsite\.com|jimdosite\.com|jimdofree\.com|weebly\.com|webnode\.|site123\.me|beepworld|yolasite|strikingly|carrd\.co|blogspot\.|\.wordpress\.com|webador\.|bplaced\.net|npage\.de|ucoz|my-free\.website/i;
const CHAINS = /^(aldi|lidl|rewe|edeka|penny|netto|kaufland|norma|nahkauf|real|globus|marktkauf|dm|rossmann|müller|mueller|douglas|tedi|action|kik|woolworth|takko|c&a|h&m|zara|new yorker|ernsting|esprit|orsay|s\.oliver|bonprix|deichmann|görtz|mediamarkt|media markt|saturn|expert|euronics|obi|hornbach|bauhaus|toom|hagebau|ikea|poco|roller|tchibo|fressnapf|das futterhaus|intersport|decathlon|fielmann|apollo|kamps|backwerk|ihr platz|dunkin|nordsee|vapiano|l'osteria|mcdonald|burger king|kfc|subway|starbucks|domino|pizza hut|sparkasse|volksbank|raiffeisen|commerzbank|deutsche bank|postbank|hypovereinsbank|dhl|deutsche post|hermes|dpd|ups|shell|aral|esso|total|jet |agip|telekom|vodafone|o2|congstar|e\.center|budni|hunkem|jack & jones|vero moda|only |mister lady|rituals|lush|snipes|footlocker|foot locker|mrs\.? ?sporty|clever fit|mcfit|john reed|fitx|ibis|motel one|b&b hotel|a&o|novotel|mercure|hilton|marriott|best western|ramada|holiday inn|atlas|europcar|sixt|hertz|avis|check24)\b/i;

// Mehrdeutige Markennamen (auch häufige Nachnamen): nur ausblenden, wenn der Name genau die Marke ist (z. B. „Müller Drogerie“), nicht bei „Müller Bäckerei“
const AMBIG = new Set(['müller', 'mueller', 'netto', 'real', 'action', 'expert', 'total', 'atlas', 'apollo', 'hermes', 'norma', 'penny', 'globus', 'kamps', 'only', 'jet', 'roller', 'poco', 'lush', 'avis', 'hertz', 'esprit', 'orsay', 'dm', 'ups', 'o2', 'shell', 'aral', 'esso', 'agip', 'ibis', 'toom', 'kik', 'rituals', 'expert', 'action']);
const AMBIG_RE = new RegExp('^(?:' + [...AMBIG].join('|') + ')\\s*(?:(?:marken-?discount|discount|supermarkt|drogerie|markt|filiale|tankstelle|station|store|shop|fachmarkt|handels\\w*|gmbh|ag|kg|city|center)\\b.*|[-–,|(].*)?$', 'i');
const dom = w => { try { return new URL(/^https?:/i.test(w) ? w : 'https://' + w).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const isChain = o => {
  const n = String(o.name || '').trim(), m = n.match(CHAINS);
  if (!m) return false;
  return AMBIG.has(m[1].trim().toLowerCase()) ? AMBIG_RE.test(n) : true;
};
function normWeb(o) {   // Social-Media-Links sind keine eigene Website
  if (o.web && NOTOWN.test(dom(o.web))) { o.social = o.web; o.web = ''; }
  if (o.web && !dom(o.web).includes('.')) o.web = '';
  return o;
}
function setWeb(l, w) {
  w = String(w || '').trim(); l.web = w; l.social = l.social || '';
  if (w && !dom(w).includes('.')) { l.web = ''; return; }
  if (w && NOTOWN.test(dom(w))) { l.social = w; l.web = ''; }
}
const keysOf = o => {
  const d = o.web ? dom(o.web) : '';
  return [(o.name + '|' + (o.addr || o.city || '')).toLowerCase(), d && !NOTOWN.test(d) ? 'd:' + d : '', o.email ? 'm:' + String(o.email).toLowerCase() : ''].filter(Boolean);
};
for (const l of Object.values(db.leads)) for (const y of keysOf(l)) db.seen[y] = db.seen[y] || l.created || now();

// ---------- Branchen
const DE = { hairdresser: 'Friseur', beauty: 'Kosmetik', bakery: 'Bäckerei', florist: 'Blumenladen', car_repair: 'Autowerkstatt', clothes: 'Modegeschäft', butcher: 'Metzgerei', hardware: 'Eisenwaren', jewelry: 'Juwelier', optician: 'Optiker', bicycle: 'Fahrradgeschäft', furniture: 'Möbelgeschäft', electronics: 'Elektronikgeschäft', books: 'Buchhandlung', gift: 'Geschenkladen', tattoo: 'Tattoo-Studio', massage: 'Massage', supermarket: 'Supermarkt', convenience: 'Kiosk', kiosk: 'Kiosk', newsagent: 'Kiosk', shoes: 'Schuhgeschäft', pet: 'Zoofachgeschäft', mobile_phone: 'Handyshop', restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Kneipe', fast_food: 'Imbiss', biergarten: 'Biergarten', ice_cream: 'Eisdiele', dentist: 'Zahnarzt', doctors: 'Arztpraxis', clinic: 'Praxis', pharmacy: 'Apotheke', veterinary: 'Tierarzt', bank: 'Bank', driving_school: 'Fahrschule', car_wash: 'Autowäsche', car_rental: 'Autovermietung', cinema: 'Kino', nightclub: 'Club', coworking_space: 'Coworking', language_school: 'Sprachschule', music_school: 'Musikschule', hotel: 'Hotel', guest_house: 'Pension', hostel: 'Hostel', apartment: 'Ferienwohnung', motel: 'Motel', camp_site: 'Campingplatz', fitness_centre: 'Fitnessstudio', sports_centre: 'Sportzentrum', dance: 'Tanzstudio', bowling_alley: 'Bowlingbahn', escape_game: 'Escape Room', carpenter: 'Tischlerei', electrician: 'Elektriker', plumber: 'Installateur', painter: 'Malerbetrieb', roofer: 'Dachdecker', gardener: 'Gärtnerei', photographer: 'Fotograf', tailor: 'Schneiderei', shoemaker: 'Schuhmacher', lawyer: 'Rechtsanwalt', accountant: 'Buchhaltung', tax_advisor: 'Steuerberater', estate_agent: 'Immobilienmakler', insurance: 'Versicherung', architect: 'Architekturbüro', travel_agent: 'Reisebüro', physiotherapist: 'Physiotherapie', optometrist: 'Optiker', psychotherapist: 'Psychotherapie', alternative: 'Heilpraktiker' };
const catLabel = t => DE[t.shop] || DE[t.craft] || DE[t.office] || DE[t.amenity] || DE[t.tourism] || DE[t.leisure] || DE[t.healthcare] || (t.craft ? 'Handwerksbetrieb' : t.office ? 'Dienstleister' : t.shop ? 'Geschäft' : t.healthcare ? 'Praxis' : 'Unternehmen');
// Schreibweise: "k=v" (genau), "k~a|b" (eines von), "k" (Schlüssel vorhanden), "*" = alle
const CATS = { 'Alle Unternehmen': '*', 'Friseur': 'shop=hairdresser', 'Restaurant': 'amenity=restaurant', 'Café': 'amenity=cafe', 'Bäckerei': 'shop=bakery', 'Blumenladen': 'shop=florist', 'Autowerkstatt': 'shop=car_repair', 'Kosmetik': 'shop=beauty', 'Zahnarzt': 'amenity=dentist', 'Arzt & Praxis': 'amenity~doctors|clinic|dentist|veterinary', 'Fitnessstudio': 'leisure=fitness_centre', 'Hotel & Pension': 'tourism~hotel|guest_house|hostel|apartment|motel', 'Handwerker': 'craft', 'Einzelhandel': 'shop', 'Büro & Dienstleister': 'office', 'Kiosk': 'shop~kiosk|newsagent|convenience' };
const PLACES_ALL = ['Geschäfte', 'Dienstleister', 'Handwerker', 'Restaurants', 'Cafés und Bäckereien', 'Arztpraxen und Zahnärzte', 'Friseure und Kosmetik', 'Fitnessstudios und Sport', 'Hotels und Pensionen', 'Autowerkstätten', 'Büros Agenturen und Kanzleien', 'Studios und Fotografen'];
const OSM_ALL = [
  '["shop"~"^(hairdresser|beauty|bakery|florist|car_repair|clothes|butcher|hardware|jewelry|optician|bicycle|furniture|electronics|books|gift|tattoo|massage|shoes|pet|mobile_phone|interior_decoration|photo|tailor|laundry|toys|sports|garden_centre|art|craft|stationery|variety_store|boutique|kiosk|wine|tea|coffee|confectionery|deli|greengrocer|seafood|pastry)$"]',
  '["craft"]',
  '["office"~"^(lawyer|accountant|tax_advisor|estate_agent|insurance|architect|travel_agent|company|it|financial|consulting|advertising_agency|employment_agency|notary|surveyor|engineer|therapist|physician|photographer|graphic_design|web_design|marketing|coworking)$"]',
  '["healthcare"]',
  '["amenity"~"^(restaurant|cafe|fast_food|bar|pub|biergarten|ice_cream|dentist|doctors|clinic|pharmacy|veterinary|driving_school|car_wash|car_rental|cinema|nightclub|coworking_space|language_school|music_school)$"]',
  '["tourism"~"^(hotel|guest_house|hostel|apartment|motel|camp_site)$"]',
  '["leisure"~"^(fitness_centre|sports_centre|dance|bowling_alley|escape_game)$"]'];


// ---------- Website-Prüfung (ohne KI, kostenlos)
const isPriv = ip => { ip = ip.replace(/^::ffff:/i, ''); return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || /^(::1?$|f[cd]|fe[89ab])/i.test(ip); };
async function safeHost(h) {
  h = h.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(h) || /\.(local|internal|lan)$/i.test(h)) throw fatal('Adresse nicht erlaubt');
  if (net.isIP(h)) { if (isPriv(h)) throw fatal('Adresse nicht erlaubt'); return; }
  if (!h.includes('.')) throw fatal('Adresse nicht erlaubt');
  let a; try { a = await dns.lookup(h, { all: true }); } catch { throw Error('Domain nicht auflösbar'); }
  if (a.some(x => isPriv(x.address))) throw fatal('Adresse nicht erlaubt');
}
async function getAny(u) {   // viele kleine Seiten haben ein abgelaufenes Zertifikat oder laufen nur mit www: erst Varianten probieren, bevor sie als „nicht erreichbar“ gelten
  try { return await get(u); }
  catch (e) {
    if (e.fatal || e.name == 'TimeoutError') throw e;
    const p = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u), alts = [];
    if (p.protocol == 'https:') { const q = new URL(p); q.protocol = 'http:'; alts.push(q.href); }
    if (!/^www\./.test(p.hostname)) { const q = new URL(p); q.hostname = 'www.' + p.hostname; alts.push(q.href); }
    for (const a of alts) { try { return await get(a); } catch (e2) { if (e2.fatal || e2.name == 'TimeoutError') break; } }
    throw e;
  }
}
async function get(u) {
  u = /^https?:\/\//i.test(u) ? u : 'https://' + u;
  const t0 = now();
  for (let hop = 0; hop < 6; hop++) {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) throw fatal('Adresse nicht erlaubt');
    await safeHost(url.hostname);   // jede Weiterleitung wird VOR dem Abruf geprüft
    const r = await fetch(u, { signal: AbortSignal.timeout(15000), redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Prospectly/1.0)', 'accept-language': 'de' } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).href; continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    let cs = (r.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1] || buf.subarray(0, 3000).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
    let text; try { text = new TextDecoder(cs || 'utf-8').decode(buf); } catch { text = buf.toString('utf8'); }
    return { html: text.slice(0, 400000), size: buf.length, url: u, ok: r.ok, status: r.status, ms: now() - t0 };
  }
  throw Error('Zu viele Weiterleitungen');
}
const safeDec = x => { try { return decodeURIComponent(x); } catch { return x; } };
const JUNKMAIL = /\.(png|jpe?g|gif|svg|webp|css|js)$|example\.|beispiel|sentry|wixpress|@[23]x|techaro|^(nutzer|user|username|vorname\.nachname|max\.mustermann|yourname|ihre-?e-?mail)@|@(domain|ihredomain|deinedomain|yourdomain|email)\./i;
const cleanMail = e => { e = safeDec(String(e || '').trim().replace(/^mailto:/i, '').split('?')[0]).trim().split(/[;,\s]+/)[0].toLowerCase(); return /^[^@\s<>:]+@[^@\s<>:]+\.[a-zäöüß]{2,}$/.test(e) && !JUNKMAIL.test(e) ? e : ''; };
const mails = (h, d) => {
  const raw = [...h.matchAll(/mailto:([^"'\s>]+)/gi)].map(m => m[1]).concat(h.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []);
  const a = [...new Set(raw.map(cleanMail).filter(Boolean))];
  return a.find(x => d && x.endsWith(d)) || a[0] || '';
};
// Bewertet eine Website: Liste aus [Befund, Gewicht]. Je höher die Summe, desto mehr Verbesserungspotenzial.
function heur(html, url, r) {
  const I = [], add = (t, w) => I.push([t, w]);
  const y = Math.max(0, ...[...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,15}((?:19|20)\d\d)/gi)].map(m => +m[1]));
  const imgs = html.match(/<img\b[^>]*>/gi) || [], noAlt = imgs.filter(i => !/\balt=/i.test(i)).length;
  const title = ((html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim();
  const text = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>|<[^>]+>/gi, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
  const spa = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html);
  const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)/i) || [])[1] || '';
  if (r.status >= 400) add('Website liefert Fehlerstatus ' + r.status, 20);
  if (!url.startsWith('https')) add('Kein HTTPS', 15);
  if (!/<meta[^>]+name=["']?viewport/i.test(html)) add('Kein Mobil-Viewport – vermutlich nicht mobilfreundlich', 25);
  if (!title) add('Seitentitel fehlt', 8);
  else if (title.length < 8 || /^(home|startseite|willkommen|untitled|index|neue seite)\b/i.test(title)) add('Seitentitel nichtssagend („' + title.slice(0, 40) + '“)', 4);
  if (!/<meta[^>]+name=["']?description/i.test(html)) add('Meta-Beschreibung fehlt', 6);
  if ((html.match(/<h1\b/gi) || []).length != 1) add('H1-Struktur fehlerhaft', 4);
  if (noAlt > 2) add(noAlt + ' Bilder ohne Alt-Text', 4);
  if (/<(font|center|marquee|frameset|blink|applet)\b|<embed|\.swf\b/i.test(html) || (html.match(/<table\b/gi) || []).length > 3) add('Veraltete Technik (Tabellen-Layout, <font> oder Flash)', 20);
  if (/frontpage|dreamweaver|joomla! 1|wordpress [1-4]\.|typo3 [3-6]\./i.test(gen)) add('Veraltetes System (' + gen.slice(0, 30) + ')', 12);
  if (y && y < new Date().getFullYear() - 2) add('Copyright-Jahr ' + y + ' wirkt veraltet', 10);
  if (!/<form\b|mailto:|tel:/i.test(html)) add('Keine klare Kontaktmöglichkeit', 8);
  if (!/impressum/i.test(html)) add('Impressum-Link fehlt (in Deutschland Pflicht)', 6);
  if (!spa && text.length < 500) add('Sehr wenig Inhalt', 12);
  if (r.ms > 4000) add('Seite lädt langsam (' + (r.ms / 1000).toFixed(1) + ' s)', 8);
  // ---- weitere Prüfungen (alles ohne KI, nur aus dem HTML der Startseite)
  if (/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) add('Seite ist für Google gesperrt (noindex)', 15);
  if (!/datenschutz|privacy/i.test(html)) add('Datenschutzerklärung fehlt (in Deutschland Pflicht)', 6);
  if (!/tel:|\b(?:\+49|0049|0)[\s/()-]*\d{2,5}[\s/()-]*\d{3,}/.test(html)) add('Keine Telefonnummer sichtbar', 5);
  const links = (html.match(/<a\b[^>]*href=/gi) || []).length;
  if (!spa && (!/<nav\b|role=["']navigation/i.test(html) && links < 6)) add('Navigation fehlt oder ist sehr dünn (' + links + ' Links)', 6);
  else if (links > 120) add('Sehr viele Links (' + links + '), Seite wirkt unübersichtlich', 4);
  if (url.startsWith('https') && /(?:src|href)=["']http:\/\/(?!(?:www\.)?w3\.org)/i.test(html.replace(/<a\b[^>]*>/gi, ''))) add('Gemischte Inhalte: unsichere http-Dateien auf https-Seite', 6);
  const old = html.match(/jquery[-.\/]?(?:min[-.])?(?:v)?(1\.\d+|2\.\d+)|bootstrap(?:\.min)?[-.\/]?(?:v)?(2|3)\.\d/i); if (old) add('Veraltete Technik (alte Software-Version: ' + old[0].slice(0, 24) + ')', 8);
  const scripts = (html.match(/<script\b[^>]*src=/gi) || []).length;
  if (scripts > 15) add('Viele externe Skripte (' + scripts + '), bremst die Seite', 5);
  if (html.length > 1500000) add('Sehr große Seite (' + Math.round(html.length / 1e6 * 10) / 10 + ' MB HTML)', 4);
  if (!spa && !/(anfrag|termin|angebot|reserv|bestell|buchen|kontakt|anrufen|jetzt)/i.test((html.match(/<(?:a|button)\b[^>]*>[^<]{2,40}</gi) || []).join(' '))) add('Kein klarer nächster Schritt (z. B. „Jetzt anfragen“)', 4);
  if (!spa && imgs.length < 2) add('Kaum Bilder, Seite wirkt nüchtern', 5);
  if (!/<link[^>]+rel=["'][^"']*icon/i.test(html)) add('Favicon fehlt (kleines Symbol im Browser-Tab)', 2);
  if (!/<html[^>]+lang=/i.test(html)) add('Sprache der Seite nicht angegeben', 2);
  if (!/property=["']og:/i.test(html)) add('Keine Vorschau für Social Media und Messenger (Open Graph)', 2);
  if (!/application\/ld\+json|itemtype=["']https?:\/\/schema\.org/i.test(html)) add('Keine strukturierten Daten für Google (Öffnungszeiten, Adresse)', 2);
  if (title.length > 70) add('Seitentitel zu lang (' + title.length + ' Zeichen), wird bei Google abgeschnitten', 2);
  if (FREEHOST.test(dom(url))) add('Kostenlose Baukasten-Adresse (' + dom(url) + ') wirkt unprofessionell', 15);
  return I;
}
// Bewertung: Keine Website / Nur Social Media / Schlecht / Mittel / Gut
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', copy: '©' };
const unent = s => String(s || '').replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m).replace(/\s+/g, ' ').trim();
const BLOCKED = /just a moment|browser wird geprüft|checking your browser|attention required|access denied|ddos|403 forbidden|are you a robot/i;

// ---------- Leads
// list: ''  = Pool (frisch gefunden, noch nicht sortiert)
//       'cold' = Cold-Call-Liste,  'skip' = Aussortiert
function addLead(o) {
  normWeb(o);
  const ks = keysOf(o);
  if (ks.some(y => db.seen[y])) return [null, false];   // schon bekannt (auch sortierte und gelöschte Leads)
  const l = { id: uid(), key: ks[0], list: '', score: null, grade: '', issues: [], web: '', social: '', email: '', phone: '', addr: '', cat: '', city: '', created: now(), ...o };
  db.leads[l.id] = l; for (const y of ks) db.seen[y] = now(); save();
  return [l, true];
}
const gradeOf = l => !l.web ? (l.social ? 'social' : 'none') : l.score == null ? '' : l.score >= 55 ? 'bad' : l.score >= 30 ? 'ok' : 'good';
const LISTS = ['', 'cold', 'skip'], CRES = ['noanswer', 'callback', 'interested', 'no'];
function moveLead(l, list) {
  if (!LISTS.includes(list)) throw fatal('Ungültige Liste');
  l.list = list;
  if (list == 'cold' && !l.cold) l.cold = { at: now(), res: '', tries: 0, last: 0, note: '', hist: [] };
  if (list == 'skip') l.skipAt = now();
}
function setCall(l, res) {
  const c = l.cold; if (!c) throw fatal('Der Lead ist nicht in der Cold-Call-Liste');
  if (res && !CRES.includes(res)) throw fatal('Ungültiges Ergebnis');
  c.hist = c.hist || [];
  if (res) { if (res != c.res) { c.res = res; c.tries = (c.tries || 0) + 1; c.last = now(); c.hist.push({ t: now(), res }); } }
  else { if (c.res && c.hist.length && c.hist[c.hist.length - 1].res == c.res) { c.hist.pop(); c.tries = Math.max(0, (c.tries || 1) - 1); c.last = c.hist.length ? c.hist[c.hist.length - 1].t : 0; } c.res = ''; }
}
// Alte Daten (v1) übernehmen: Cold-Call-Leads bleiben Cold Calls, aussortierte werden zu „Aussortiert“
for (const l of Object.values(db.leads)) {
  if (l.list === undefined) l.list = l.cold ? 'cold' : (l.flag ? 'skip' : '');
  if (l.cold && !l.cold.hist) l.cold.hist = [];
  for (const y of keysOf(l)) db.seen[y] = db.seen[y] || l.created || now();
}
db.jobs = db.jobs.filter(j => ['search', 'scan'].includes(j.type)); db.jobs.forEach(j => { if (j.status == 'running') j.status = 'pending'; });

// ---------- Jobs
function enq(type, data, delay = 0) {
  if (db.jobs.some(j => j.status == 'pending' && j.type == type && JSON.stringify(j.data) == JSON.stringify(data))) return;
  db.jobs.push({ id: uid(), type, data, runAt: now() + delay, tries: 0, status: 'pending' }); save();
}


// ---------- Suche
const OVP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = () => ({ 'user-agent': 'Prospectly/1.0 (' + (E.CONTACT_EMAIL || E.GMAIL_ADDRESS || 'local') + ')' });
const geoCache = new Map();
const netErr = e => { const c = e?.cause; return e.name == 'TimeoutError' ? 'Zeitüberschreitung' : (e.message || String(e)) + (c ? ' (' + (c.code || c.message || c) + ')' : ''); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const geoSrc = q => {
  const enc = encodeURIComponent(q);
  return [
    ['Nominatim', async () => { const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=de&q=' + enc, { headers: UA(), signal: AbortSignal.timeout(20000) }); if (!r.ok) throw Error('Nominatim ' + r.status); const x = (await r.json())[0]; return x && { lat: +x.lat, lon: +x.lon, cc: String(x.address?.country_code || '').toUpperCase() }; }],
    ['Open-Meteo', async () => { const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=' + enc, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw Error('Open-Meteo ' + r.status); const x = (await r.json()).results?.[0]; return x && { lat: x.latitude, lon: x.longitude, cc: String(x.country_code || '').toUpperCase() }; }],
    ['Photon', async () => { const r = await fetch('https://photon.komoot.io/api/?limit=1&lang=de&q=' + enc, { headers: UA(), signal: AbortSignal.timeout(20000) }); if (!r.ok) throw Error('Photon ' + r.status); const f = (await r.json()).features?.[0], x = f?.geometry?.coordinates; return x && { lat: x[1], lon: x[0], cc: String(f.properties?.countrycode || '').toUpperCase() }; }]
  ];
};
async function geocode(q) {
  if (geoCache.has(q)) return geoCache.get(q);
  // Mehrere Dienste nacheinander: fällt einer aus oder blockiert uns, springt der nächste ein
  let err, answered = false;
  for (const [name, fn] of geoSrc(q)) {
    try { const v = await fn(); answered = true; if (v && isFinite(v.lat) && isFinite(v.lon)) { geoCache.set(q, v); return v; } }
    catch (e) { err = Error('Ortssuche (' + name + '): ' + e.message); }
  }
  if (answered) throw fatal('Ort „' + q + '“ nicht gefunden. Bitte Stadt statt Stadtteil probieren, z. B. „Rostock“');
  throw err || Error('Ortssuche nicht erreichbar');
}
async function overpass(q) {
  let err;
  for (let round = 0; round < 2; round++) {
    for (const [i, ep] of OVP.entries()) {
      try {
        const r = await fetch(ep, { method: 'POST', headers: i == 0 ? UA() : { ...UA(), 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(100000) });
        if (!r.ok) { err = Error('Kartendienst ' + new URL(ep).hostname + ' antwortet mit ' + r.status + (r.status == 429 ? ' (zu viele Anfragen)' : r.status >= 500 ? ' (überlastet)' : '')); continue; }
        const j = await r.json();
        if (j.remark && /error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length) { err = Error('Kartendienst: ' + j.remark); continue; }
        return j;
      } catch (e) { err = Error('Kartendienst ' + new URL(ep).hostname + ': ' + netErr(e)); }
    }
    if (round == 0) await sleep(5000);
  }
  throw err;
}
const km = (a, b) => { const R = 6371, rad = x => x * Math.PI / 180, dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

async function searchOSM(c, all, center) {
  const A = `(around:${c.radiusKm * 1000},${center.lat},${center.lon})`;
  let parts;
  if (all) parts = OSM_ALL.map(f => `nwr${A}${f}[name];`);
  else {
    const m = CATS[c.category].match(/^(\w+)(=|~)?(.*)$/), [, k, op, v] = m;
    parts = [`nwr${A}${op == '=' ? `["${k}"="${v}"]` : op == '~' ? `["${k}"~"^(${v})$"]` : `["${k}"]`}[name];`];
  }
  const els = []; let ok = 0, err;
  for (const [i, part] of parts.entries()) {
    prog({ phase: 'map', step: i + 1, steps: parts.length, sub: 0, part: all ? OSM_LABELS[i] || 'Branchen' : c.category, found: els.length });
    try { const j = await overpass(`[out:json][timeout:30];(${part});out center tags 500;`); els.push(...(j.elements || [])); ok++; prog({ found: els.length, sub: 1 }); }
    catch (e) { err = e; if (!ok && i >= 1) break; }   // zwei Teilabfragen ohne jeden Erfolg: nicht weiter warten, Ausweichsuche übernimmt
    if (i < parts.length - 1) await sleep(800);
  }
  if (!ok) throw err || Error('Kartendienst nicht erreichbar');
  const seenId = new Set();
  return els.filter(e => e.tags && !seenId.has(e.type + e.id) && seenId.add(e.type + e.id) && !e.tags.brand && !e.tags['brand:wikidata']).map(e => {
    const t = e.tags;
    return {
      name: t.name,
      addr: [[t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '), [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      web: t.website || t['contact:website'] || '', phone: t.phone || t['contact:phone'] || '', email: t.email || t['contact:email'] || '',
      cat: catLabel(t)
    };
  });
}
// Google-Angabe zu einem Betrieb (Bewertung, Öffnungszeiten, Maps-Link) aus einem Places-Treffer
const gData = p => ({ id: p.id || '', addr: p.formattedAddress || '', rating: typeof p.rating == 'number' ? p.rating : null, n: p.userRatingCount || 0, maps: p.googleMapsUri || '', hours: p.regularOpeningHours?.weekdayDescriptions || [], at: now() });
const digits = x => String(x || '').replace(/\D/g, '');
// Holt die Google-Angabe zu einem vorhandenen Lead nach (auch wenn er aus OpenStreetMap stammt). Braucht GOOGLE_PLACES_KEY.
async function googleLookup(l) {
  if (!E.GOOGLE_PLACES_KEY) throw fatal('Dafür fehlt der Google-Places-Key (Einstellungen). Die Links „Google“ und „Maps“ gehen auch ohne Key.');
  const mask = 'places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.id,places.rating,places.userRatingCount,places.googleMapsUri,places.regularOpeningHours.weekdayDescriptions';
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': E.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': mask }, body: JSON.stringify({ textQuery: [l.name, l.addr || l.city].filter(Boolean).join(', '), languageCode: 'de', pageSize: 5 }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fatal('Google Places: ' + (j.error?.message || r.status));
  const nm = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, ''), mine = nm(l.name), d = dom(l.web), ph = digits(l.phone).slice(-7);
  let best = null, bs = 0;
  for (const p of j.places || []) {
    const t = nm(p.displayName?.text); let sc = 0;
    if (d && dom(p.websiteUri) == d) sc += 3;
    if (ph.length >= 6 && digits(p.nationalPhoneNumber).endsWith(ph)) sc += 3;
    if (t && mine && (t.includes(mine) || mine.includes(t))) sc += 2;
    if (sc > bs) { bs = sc; best = p; }
  }
  l.g = best && bs >= 2 ? gData(best) : { none: true, at: now() };
  save(); return l.g;
}
async function searchPlaces(c, all, center) {
  const qs = all ? PLACES_ALL : [c.category], want = Math.max(60, c.maxLeads * 3), out = [];
  const mask = 'places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryTypeDisplayName,places.businessStatus,places.location,places.id,places.rating,places.userRatingCount,places.googleMapsUri,places.regularOpeningHours.weekdayDescriptions,nextPageToken';
  for (const [qi, q] of shuffle([...qs]).entries()) {
    let token = '';
    for (let page = 0; page < 3; page++) {
      prog({ phase: 'map', step: qi + 1, steps: qs.length, sub: page / 3, part: q, found: out.length });
      const body = { textQuery: `${q} in ${c.location}`, languageCode: 'de', pageSize: 20 };
      if (center) body.locationBias = { circle: { center: { latitude: center.lat, longitude: center.lon }, radius: Math.min(50000, c.radiusKm * 1000) } };
      if (token) body.pageToken = token;
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': E.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': mask }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error('Places: ' + (j.error?.message || r.status));
      for (const p of j.places || []) {
        if (p.businessStatus && p.businessStatus != 'OPERATIONAL') continue;   // geschlossene Betriebe auslassen
        if (center && p.location && km(center, { lat: p.location.latitude, lon: p.location.longitude }) > c.radiusKm * 1.15) continue;   // Radius einhalten
        out.push({ name: p.displayName?.text, addr: p.formattedAddress || '', web: p.websiteUri || '', phone: p.nationalPhoneNumber || '', email: '', cat: p.primaryTypeDisplayName?.text || (all ? 'Unternehmen' : c.category), g: gData(p) });
      }
      token = j.nextPageToken || ''; if (!token) break;
    }
    if (out.length >= want) break;
  }
  return out;
}

// ---------- Fortschritt der aktuellen Suche (nur im Speicher, wird der Oberfläche über /api/state gezeigt)
let PROG = { phase: 'idle' };
const prog = o => { Object.assign(PROG, o); rev++; };
const OSM_LABELS = ['Läden', 'Handwerk', 'Büros und Dienstleister', 'Arztpraxen', 'Gastronomie', 'Hotels', 'Freizeit und Sport'];
function progressView() {
  const P = PROG; if (P.phase == 'idle' || P.phase == 'done') return null;
  if (P.phase == 'error') return null;   // der Fehler steht in der roten Box
  let scanned = 0, total = (P.ids || []).length;
  if (P.phase == 'scan') {
    for (const id of P.ids) { const l = db.leads[id]; if (!l || l.scannedAt || l.scanFailed) scanned++; }
    if (scanned >= total) { P.phase = 'done'; return null; }
  }
  const base = { q: P.q, src: P.src, since: P.since, found: P.found || 0 };
  switch (P.phase) {
    case 'geo': return { ...base, phase: 'geo', pct: 4, label: 'Ort wird gesucht', detail: P.q };
    case 'map': { const f = (P.step - 1 + (P.sub || 0)) / P.steps; return { ...base, phase: 'map', pct: Math.round(6 + f * 54), label: 'Kartendaten laden', detail: `${P.part} (${P.step} von ${P.steps})`, found: P.found || 0 }; }
    case 'filter': return { ...base, phase: 'filter', pct: 64, label: 'Treffer filtern', detail: `${P.found} Treffer, Ketten und Duplikate werden aussortiert` };
    case 'create': return { ...base, phase: 'create', pct: 70, label: 'Leads anlegen', detail: `${P.made || 0} von maximal ${P.max}` };
    case 'scan': return { ...base, phase: 'scan', pct: Math.round(72 + scanned / Math.max(1, total) * 28), label: 'Websites prüfen', detail: `${scanned} von ${total} geprüft`, total, scanned };
    case 'retry': return { ...base, phase: 'retry', pct: P.pct || 0, label: 'Neuer Versuch', detail: P.err };
  }
  return null;
}
// ---------- Ausweichsuche: wenn kein Overpass-Server erreichbar ist, Betriebe über die Ortssuche (Nominatim) holen
const NOM_ALL = [['shop', 'hairdresser', 'hairdresser'], ['shop', 'bakery', 'bakery'], ['shop', 'florist', 'florist'], ['shop', 'car_repair', 'car repair'], ['shop', 'beauty', 'beauty salon'], ['shop', 'butcher', 'butcher'], ['shop', 'clothes', 'clothes shop'], ['amenity', 'restaurant', 'restaurant'], ['amenity', 'cafe', 'cafe'], ['amenity', 'dentist', 'dentist'], ['amenity', 'doctors', 'doctor'], ['amenity', 'fast_food', 'fast food'], ['amenity', 'bar', 'bar'], ['leisure', 'fitness_centre', 'fitness centre'], ['tourism', 'hotel', 'hotel'], ['tourism', 'guest_house', 'guest house'], ['craft', 'carpenter', 'carpenter'], ['craft', 'electrician', 'electrician'], ['craft', 'plumber', 'plumber']];
function nomPairs(c, all) {
  if (all) return NOM_ALL;
  const [, k, op, v] = CATS[c.category].match(/^(\w+)(=|~)?(.*)$/);
  if (op == '=') return [[k, v, v.replace(/_/g, ' ')]];
  if (op == '~') return v.split('|').map(t => [k, t, t.replace(/_/g, ' ')]);
  return NOM_ALL.filter(x => x[0] == k);
}
// ---------- Kostenlose Suche über Geoapify Places (OpenStreetMap-Daten, Gratis-Key ohne Kreditkarte, 3000 Credits/Tag)
const GEO_ALL = ['commercial', 'catering', 'service', 'healthcare', 'accommodation', 'leisure', 'office', 'sport'];
const GEO_CAT = { 'Friseur': 'service.beauty.hairdresser', 'Restaurant': 'catering.restaurant', 'Café': 'catering.cafe', 'Bäckerei': 'commercial.food_and_drink.bakery', 'Blumenladen': 'commercial.florist', 'Autowerkstatt': 'service.vehicle.repair', 'Kosmetik': 'service.beauty', 'Zahnarzt': 'healthcare.dentist', 'Arzt & Praxis': 'healthcare', 'Fitnessstudio': 'sport.fitness', 'Hotel & Pension': 'accommodation', 'Handwerker': 'service', 'Einzelhandel': 'commercial', 'Büro & Dienstleister': 'office', 'Kiosk': 'commercial.convenience' };
async function searchGeoapify(c, all, center) {
  const groups = all ? GEO_ALL : [GEO_CAT[c.category] || 'commercial'], want = Math.max(60, c.maxLeads * 3), out = [], seen = new Set();
  const area = `&filter=circle:${center.lon},${center.lat},${Math.round(c.radiusKm * 1000)}&bias=proximity:${center.lon},${center.lat}`;
  const ask = async (cat, offset, limit) => {
    const r = await fetch('https://api.geoapify.com/v2/places?categories=' + encodeURIComponent(cat) + area + '&limit=' + limit + '&offset=' + offset + '&apiKey=' + encodeURIComponent(E.GEOAPIFY_KEY), { signal: AbortSignal.timeout(30000) });
    if (r.status == 401 || r.status == 403) throw fatal('Geoapify-Key ungültig oder gesperrt (Status ' + r.status + ')');
    if (r.status == 429) throw fatal('Geoapify: Tageslimit erreicht, morgen wieder oder Radius/Branche verkleinern');
    if (!r.ok) throw Object.assign(Error('Geoapify ' + r.status), { status: r.status });
    return (await r.json()).features || [];
  };
  let ok = 0, err;
  for (const [i, g0] of groups.entries()) {
    prog({ phase: 'map', step: i + 1, steps: groups.length, sub: 0, part: all ? g0 : c.category, found: out.length });
    let g = g0;
    try {
      for (let off = 0; off < Math.min(want, 300); off += 100) {
        let fs;
        try { fs = await ask(g, off, 100); }
        catch (e) { if (e.status == 400 && g.includes('.')) { g = g.split('.')[0]; fs = await ask(g, off, 100); } else throw e; }   // unbekannte Unterkategorie: gröber suchen
        for (const f of fs) {
          const p = f.properties || {}, raw = p.datasource?.raw || {}, id = p.place_id || (p.name + '|' + p.formatted);
          if (!p.name || seen.has(id) || raw.brand || raw['brand:wikidata']) continue; seen.add(id);
          if (c.category == 'Kiosk' && !/^(kiosk|newsagent|convenience)$/.test(raw.shop || '')) continue;   // Geoapify liefert bei Kiosk auch andere Läden: nur echte Kioske behalten
          const cats = p.categories || [];
          out.push({ name: p.name, addr: [[p.street, p.housenumber].filter(Boolean).join(' '), [p.postcode, p.city || p.suburb].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            web: p.website || p.contact?.website || raw.website || raw['contact:website'] || '', phone: p.contact?.phone || raw.phone || raw['contact:phone'] || '', email: p.contact?.email || raw.email || raw['contact:email'] || '',
            cat: catLabel({ shop: raw.shop, craft: raw.craft, office: raw.office, amenity: raw.amenity, tourism: raw.tourism, leisure: raw.leisure, healthcare: raw.healthcare }) !== 'Unternehmen' ? catLabel({ shop: raw.shop, craft: raw.craft, office: raw.office, amenity: raw.amenity, tourism: raw.tourism, leisure: raw.leisure, healthcare: raw.healthcare }) : (cats[0] || '').split('.').slice(0, 2).join(' – ') || 'Unternehmen' });
        }
        prog({ found: out.length });
        if (fs.length < 100) break;
        await sleep(300);
      }
      ok++;
    } catch (e) { if (e.fatal) throw e; err = e; }
    await sleep(300);
  }
  if (!ok) throw err || Error('Geoapify nicht erreichbar');
  return out;
}
// ---------- Erste Ausweichsuche: Photon (Komoot) findet Betriebe nach OSM-Tag, Nominatim-Lookup holt Website/Telefon/E-Mail nach
async function searchPhoton(c, all, center, origErr) {
  const pairs = nomPairs(c, all), out = [], seen = new Set(), found = [];
  const dLat = c.radiusKm / 111, dLon = c.radiusKm / (111 * Math.cos(center.lat * Math.PI / 180));
  const bbox = [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat].map(x => x.toFixed(5)).join(',');
  let ok = 0, fails = 0;
  for (const [i, [k, t, word]] of pairs.entries()) {
    prog({ phase: 'map', step: i + 1, steps: pairs.length, sub: 0, part: word + ' (Photon)', found: found.length });
    try {
      const u = 'https://photon.komoot.io/api/?lang=de&limit=50&q=' + encodeURIComponent(c.location) + '&lat=' + center.lat + '&lon=' + center.lon + '&bbox=' + bbox + '&osm_tag=' + encodeURIComponent(k + ':' + t);
      const r = await fetch(u, { headers: UA(), signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw Error('Photon ' + r.status);
      for (const f of (await r.json()).features || []) {
        const p = f.properties || {}, g = f.geometry?.coordinates || [];
        const id = (p.osm_type || '') + (p.osm_id || ''); if (!p.name || !p.osm_id || seen.has(id)) continue; seen.add(id);
        if (g.length < 2 || km(center, { lat: g[1], lon: g[0] }) > c.radiusKm * 1.15) continue;
        found.push({ type: p.osm_type, id: p.osm_id, p, k, t });
      }
      ok++; fails = 0;
    } catch (e) { fails++; if (!ok && fails >= 2) throw Error(origErr.message + ' – Photon: ' + netErr(e)); }
    prog({ found: found.length });
    await sleep(700);
  }
  if (!found.length) throw Error(origErr.message + ' – auch Photon fand nichts');
  // Details (Website, Telefon, E-Mail, Marke) über Nominatim-Lookup nachladen, 50 Objekte pro Anfrage
  const extra = new Map(), ids = found.map(x => x.type + x.id);
  for (let i = 0; i < ids.length; i += 50) {
    prog({ part: 'Details laden (' + Math.min(i + 50, ids.length) + '/' + ids.length + ')' });
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/lookup?format=jsonv2&extratags=1&accept-language=de&osm_ids=' + ids.slice(i, i + 50).join(','), { headers: UA(), signal: AbortSignal.timeout(25000) });
      if (r.ok) for (const x of await r.json()) extra.set(String(x.osm_type || '')[0].toUpperCase() + x.osm_id, x.extratags || {});
    } catch {}
    await sleep(1100);
  }
  for (const f of found) {
    const x2 = extra.get(f.type + f.id) || f.p.extra || {}, p = f.p;
    if (x2.brand || x2['brand:wikidata']) continue;
    out.push({ name: p.name, addr: [[p.street, p.housenumber].filter(Boolean).join(' '), [p.postcode, p.city || p.district].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      web: x2.website || x2['contact:website'] || '', phone: x2.phone || x2['contact:phone'] || '', email: x2.email || x2['contact:email'] || '', cat: catLabel({ [f.k]: f.t }) });
  }
  return out;
}
async function searchNominatim(c, all, center, origErr) {
  const pairs = nomPairs(c, all), out = [], seen = new Set(), dLat = c.radiusKm / 111, dLon = c.radiusKm / (111 * Math.cos(center.lat * Math.PI / 180));
  const vb = `${center.lon - dLon},${center.lat + dLat},${center.lon + dLon},${center.lat - dLat}`;
  const ask = async q => {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&addressdetails=1&extratags=1&namedetails=1&accept-language=de&bounded=1&viewbox=' + vb + '&q=' + encodeURIComponent(q), { headers: UA(), signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw Error('Nominatim ' + r.status);
    return r.json();
  };
  for (const [i, [k, t, word]] of pairs.entries()) {
    prog({ phase: 'map', step: i + 1, steps: pairs.length, sub: 0, part: word + ' (Ausweichsuche)', found: out.length });
    let got = [];
    for (const q of [`[${k}=${t}]`, `${word} in ${c.location}`]) {
      try { got = (await ask(q)).filter(x => x.category == k && x.type == t); } catch {}
      await sleep(1100);   // Nominatim erlaubt höchstens eine Anfrage pro Sekunde
      if (got.length) break;
    }
    for (const x of got) {
      const id = x.osm_type + x.osm_id; if (seen.has(id)) continue; seen.add(id);
      const x2 = x.extratags || {}, a = x.address || {}, name = x.namedetails?.name || x.name;
      if (!name || km(center, { lat: +x.lat, lon: +x.lon }) > c.radiusKm * 1.15 || x2.brand || x2['brand:wikidata']) continue;
      out.push({ name, addr: [[a.road, a.house_number].filter(Boolean).join(' '), [a.postcode, a.city || a.town || a.village].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        web: x2.website || x2['contact:website'] || '', phone: x2.phone || x2['contact:phone'] || '', email: x2.email || x2['contact:email'] || '', cat: catLabel({ [k]: t }) });
    }
    prog({ found: out.length });
  }
  if (!out.length) throw Error(origErr.message + ' – auch die Ausweichsuche über die Ortssuche fand nichts');
  return out;
}

// ---------- Handler
const H = {
  async search({ cid }) {
    const c = db.campaigns.find(x => x.id == cid); if (!c) return;
    if (db.cfg.lastSearch?.error) db.cfg.lastSearch = { ...db.cfg.lastSearch, retry: true };
    if (!E.GOOGLE_PLACES_KEY) throw fatal('Bitte zuerst Google verbinden (Einstellungen).');
    if (!CATS[c.category]) throw fatal('Unbekannte Branche');
    c.radiusKm = Math.min(50, Math.max(1, +c.radiusKm || 5));
    const all = c.category == 'Alle Unternehmen';
    PROG = { phase: 'geo', q: `${c.category} in ${c.location}`, src: E.GOOGLE_PLACES_KEY ? 'Google Places' : 'OpenStreetMap', since: now(), max: c.maxLeads, ids: [], found: 0 }; rev++;
    let center = null;
    try { center = await geocode(c.location); } catch (e) { if (!E.GOOGLE_PLACES_KEY || e.fatal) throw e; }
    let srcName = E.GOOGLE_PLACES_KEY ? 'Google Places' : 'OpenStreetMap', res;
    if (E.GOOGLE_PLACES_KEY) res = await searchPlaces(c, all, center);
    else if (E.GEOAPIFY_KEY && center) {
      srcName = 'Geoapify (OpenStreetMap)'; prog({ src: srcName });
      try { res = await searchGeoapify(c, all, center); }
      catch (e) { if (e.fatal) throw e; log('Geoapify fehlgeschlagen (' + netErr(e) + '), OpenStreetMap-Suche startet'); srcName = 'OpenStreetMap'; prog({ src: srcName }); res = await searchOSM(c, all, center).catch(async e2 => { if (e2.fatal) throw e2; srcName = 'OpenStreetMap (Ausweichsuche)'; try { return await searchPhoton(c, all, center, e2); } catch { return await searchNominatim(c, all, center, e2); } }); }
    }
    else {
      try { res = await searchOSM(c, all, center); }
      catch (e) { if (e.fatal || !center) throw e; log('Kartendaten nicht erreichbar (' + e.message + '), Ausweichsuche über Photon startet'); srcName = 'OpenStreetMap (Ausweichsuche)'; prog({ src: srcName });
        try { res = await searchPhoton(c, all, center, e); }
        catch (e2) { log('Photon-Suche fehlgeschlagen (' + e2.message + '), Nominatim startet'); res = await searchNominatim(c, all, center, e); } }
    }
    prog({ phase: 'filter', found: res.length });
    res.forEach(normWeb);
    const total = res.length;
    res = res.filter(o => o.name && !isChain(o));
    const afterChains = res.length;
    if (c.web == 'with') res = res.filter(o => o.web); else if (c.web == 'without') res = res.filter(o => !o.web);
    const afterWeb = res.length;
    // Zufällige Reihenfolge für Vielfalt, Betriebe mit Kontaktdaten zuerst
    res = shuffle(res).sort((a, b) => !a.phone - !b.phone);   // Betriebe mit Telefonnummer zuerst
    let n = 0, known = 0;
    prog({ phase: 'create', made: 0 });
    for (const o of res) {
      if (n >= c.maxLeads) break;
      const [l, isNew] = addLead({ ...o, cat: o.cat || (all ? 'Unternehmen' : c.category), city: c.location, cc: center?.cc || '' });
      if (isNew) { n++; PROG.ids.push(l.id); PROG.made = n; if (l.web) enq('scan', { lid: l.id }); else { l.grade = l.social ? 'social' : 'none'; l.score = l.social ? 85 : 90; l.scannedAt = now(); } } else known++;
    }
    prog({ phase: n ? 'scan' : 'done' });
    log(`Suche „${c.category} in ${c.location}“: ${total} Treffer, ${n} neue Leads, ${known} schon bekannt (übersprungen)`);
    db.cfg.lastSearch = { at: now(), q: `${c.category} in ${c.location}`, src: srcName, total, chains: total - afterChains, webFilter: afterChains - afterWeb, n, known, web: c.web || 'any', radius: c.radiusKm };
    if (c.once) { db.campaigns = db.campaigns.filter(x => x !== c); save(); }
  },
  async scan({ lid, url }) {
    const l = db.leads[lid]; if (!l) return;
    if (url) setWeb(l, url);
    l.scanFailed = false; l.blocked = false;
    let I = [], html = '';
    if (!l.web) {
      I = [[l.social ? 'Keine eigene Website (nur ' + dom(l.social) + ')' : 'Keine Website gefunden', 90]];
      l.score = l.social ? 85 : 90;
    } else {
      try {
        const r = await getAny(l.web);
        html = r.html; I = heur(html, r.url, r);
        l.title = ((html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        l.desc = ((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [])[1] || '').slice(0, 200);
        l.score = Math.min(95, 5 + I.reduce((s, x) => s + x[1], 0));
        l.snip = unent(String(html).replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 600);   // Textauszug: Grundlage für belegbares Lob in der Mail
        l.loadMs = r.ms;
        l.title = unent(l.title); l.desc = unent(l.desc);
        l.blocked = BLOCKED.test(l.title) || [403, 429, 503].includes(r.status);   // Schutzseite: Bewertung unsicher, bitte manuell ansehen
        if (!l.phone) l.phone = safeDec((html.match(/href=["']tel:([^"']+)/i) || [])[1] || '').replace(/\s+/g, ' ').slice(0, 30);
        if (!l.email) {
          const d = dom(r.url);
          l.email = mails(html, d);
          if (!l.email) for (const h of [...html.matchAll(/href=["']([^"']*(?:impressum|kontakt|contact)[^"']*)["']/gi)].map(m => m[1]).slice(0, 2)) {
            try { const p = await get(new URL(h, r.url).href); if (l.email = mails(p.html, d)) break; } catch {}
          }
        }
      } catch (e) { I = [['Website nicht erreichbar', 75]]; l.score = 80; l.title = ''; l.desc = ''; }
    }
    I.sort((a, b) => b[1] - a[1]);   // wichtigste Befunde zuerst
    l.issues = I.map(x => x[0]); l.grade = gradeOf(l); l.scannedAt = now(); l.hint = ''; save();

  }
};
const WHAT = { scan: 'Website-Prüfung' };
function noteSearch(j, e, final) {
  const c = db.campaigns.find(x => x.id == j.data?.cid);
  prog(final ? { phase: 'error', err: e.message } : { phase: 'retry', err: e.message });
  db.cfg.lastSearch = { at: now(), q: c ? `${c.category} in ${c.location}` : '', src: E.GOOGLE_PLACES_KEY ? 'Google Places' : 'OpenStreetMap', error: e.message, retry: !final };
}
function jobFailed(j, e) {
  if (j.type == 'search') { noteSearch(j, e, true); db.campaigns = db.campaigns.filter(x => x.id != j.data?.cid); }
  const l = db.leads[j.data?.lid]; if (!l) return;
  if (j.type == 'scan') { l.scanFailed = true; l.hint = `${WHAT[j.type]} fehlgeschlagen: ${e.message}`; }
}
const running = new Set();
async function runJob(j) {
  j.status = 'running'; running.add(j); save();
  try { await H[j.type](j.data, j); j.status = 'done'; j.doneAt = now(); }
  catch (e) {
    j.tries++; j.err = e.message;
    if (j.tries >= 3 || e.fatal) { j.status = 'failed'; j.doneAt = now(); log(`Job ${j.type} fehlgeschlagen: ${e.message}`); jobFailed(j, e); }
    else { j.status = 'pending'; j.runAt = now() + (j.type == 'search' ? 2e4 * j.tries : 6e4 * j.tries); if (j.type == 'search') noteSearch(j, e, false); }
  } finally {
    running.delete(j);
    db.jobs = db.jobs.filter(x => ['pending', 'running'].includes(x.status) || now() - (x.doneAt || 0) < 864e5);
    save();
  }
}
// Website-Prüfungen laufen bis zu 4 gleichzeitig, die Suche allein
function tick() {
  for (const j of db.jobs.filter(j => j.status == 'pending' && j.runAt <= now())) {
    if (running.size >= 4) break;
    if (j.type != 'scan' && [...running].some(x => x.type != 'scan')) continue;
    runJob(j);
  }
}
setInterval(tick, 1000);


// ---------- Zugangsdaten testen
const KEYTEST_NAMES = { ANTHROPIC_API_KEY: 'Anthropic', GROQ_API_KEY: 'Groq', GEOAPIFY_KEY: 'Geoapify', GOOGLE_PLACES_KEY: 'Google Places', GOOGLE_OAUTH: 'Google (Client-ID und Secret)' };
const keyHint = k => k && k.length >= 12 ? '…' + k.slice(-4) : '';
async function testKey(provider, given) {
  const secrets = Object.values(given).filter(v => v && v.length > 5);
  const clean = t => { let x = String(t ?? ''); for (const v of secrets) x = x.split(v).join('••••'); return x.slice(0, 300); };   // Keys tauchen nie in Meldungen auf
  const res = (status, message, extra = {}) => ({ status, message, provider: KEYTEST_NAMES[provider], hint: keyHint(given.key || given.secret), ...extra });
  const net = e => {
    const m = String(e?.message || e), c = e?.cause?.code || e?.cause?.message || '';
    if (e?.name == 'TimeoutError') return res('warn', KEYTEST_NAMES[provider] + ' hat nicht rechtzeitig geantwortet (nach 20 Sekunden). Das ist ein technisches Problem, kein Hinweis auf einen falschen Key. Bitte später erneut testen.');
    if (/header|ByteString|invalid character/i.test(m)) return res('invalid', 'Der Key enthält ungültige Zeichen (zum Beispiel ein Leerzeichen, einen Zeilenumbruch oder einen Umlaut). Bitte neu und ohne Anhang kopieren.');
    return res('warn', 'Der Anbieter ist von diesem Rechner aus nicht erreichbar' + (c ? ' (' + clean(c) + ')' : '') + '. Prüfe Internetverbindung, Firewall oder Proxy. Das sagt nichts darüber, ob der Key gültig ist.');
  };
  const json = async r => { try { return await r.json(); } catch { return {}; } };
  const down = r => res('warn', KEYTEST_NAMES[provider] + ' meldet gerade einen Serverfehler (HTTP ' + r.status + '). Das ist ein technisches Problem beim Anbieter. Bitte später erneut testen.');
  const T = () => AbortSignal.timeout(20000);
  if (provider == 'GOOGLE_OAUTH') {
    if (!given.id || !given.secret) return res('invalid', 'Es fehlt ' + (!given.id && !given.secret ? 'Client-ID und Client-Secret' : !given.id ? 'die Client-ID' : 'das Client-Secret') + '. Beides wird zusammen geprüft.');
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: T(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: given.id, client_secret: given.secret, refresh_token: 'prospectly-test', grant_type: 'refresh_token' }) });
      if (r.status >= 500) return down(r);
      const j = await json(r);
      if (j.error == 'invalid_grant') return res('ok', 'Client-ID und Client-Secret werden von Google akzeptiert.');   // Client ist bekannt, nur der Testtoken ist (absichtlich) ungültig
      if (j.error == 'invalid_client' || r.status == 401) return res('invalid', 'Google lehnt Client-ID oder Client-Secret ab. Bitte beide neu aus der Google Cloud Console kopieren.' + (j.error_description ? ' (' + clean(j.error_description) + ')' : ''));
      return res('warn', 'Unerwartete Antwort von Google (HTTP ' + r.status + (j.error ? ', ' + clean(j.error) : '') + '). Das Ergebnis ist nicht eindeutig.');
    } catch (e) { return net(e); }
  }
  const key = given.key;
  if (!key) return res('invalid', 'Es ist noch kein Key eingetragen. Füge ihn ein und teste erneut (er muss dafür nicht gespeichert sein).');
  try {
    if (provider == 'ANTHROPIC_API_KEY') {
      const model = E.AI_MODEL || 'claude-sonnet-5-5';
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: T(), headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] }) });
      if (r.ok) return res('ok', 'Der API-Key funktioniert. Anthropic hat die Testanfrage mit dem Modell „' + model + '“ beantwortet.');
      if (r.status >= 500) return down(r);
      const j = await json(r), msg = clean(j.error?.message || '');
      if (r.status == 401) return res('invalid', 'Der API-Key wurde von Anthropic abgelehnt (ungültig, widerrufen oder falsch kopiert).' + (msg ? ' Meldung: ' + msg : ''));
      if (r.status == 403) return res('invalid', 'Der Key hat keine Berechtigung für diese Anfrage.' + (msg ? ' Meldung: ' + msg : ''));
      if (r.status == 404) return res('warn', 'Der Key wurde akzeptiert, aber das Modell „' + model + '“ ist für ihn nicht verfügbar. Prüfe die Einstellung AI_MODEL.' + (msg ? ' Meldung: ' + msg : ''));
      if (r.status == 429) return res('warn', 'Der Key ist gültig, aber das Anfrage-Limit ist gerade erreicht. Bitte in einer Minute erneut testen.');
      if (r.status == 400 && /credit|balance|billing/i.test(msg)) return res('warn', 'Der Key ist gültig, aber das Guthaben ist aufgebraucht. Lade unter console.anthropic.com Guthaben auf (Plans & Billing).');
      return res('warn', 'Anthropic hat die Testanfrage nicht angenommen (HTTP ' + r.status + ').' + (msg ? ' Meldung: ' + msg : ''));
    }
    if (provider == 'GROQ_API_KEY') {
      let model;
      try { model = await groqModel(key, T()); } catch (e) {
        if (e.status == 401) return res('invalid', 'Der Key wurde von Groq abgelehnt (ungültig oder falsch kopiert).');
        if (e.status == 429) return res('warn', 'Der Key ist gültig, aber das Gratis-Limit ist gerade erreicht. Bitte später erneut testen.');
        if (e.status >= 500) return down({ status: e.status });
        throw e;
      }
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', signal: T(), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: groqBody(model, 1, 'Hi') });
      if (r.ok) return res('ok', 'Der Groq-Key funktioniert (Modell „' + model + '“).');
      if (r.status >= 500) return down(r);
      const j = await json(r), msg = clean(j.error?.message || '');
      if (r.status == 401) return res('invalid', 'Der Key wurde von Groq abgelehnt (ungültig oder falsch kopiert).' + (msg ? ' Meldung: ' + msg : ''));
      if (r.status == 429) return res('warn', 'Der Key ist gültig, aber das Gratis-Limit ist gerade erreicht. Bitte später erneut testen.');
      if (r.status == 404 || r.status == 400) return res('warn', 'Der Key wurde akzeptiert, aber das Modell „' + model + '“ ist nicht verfügbar. Prüfe die Einstellung GROQ_MODEL.' + (msg ? ' Meldung: ' + msg : ''));
      return res('warn', 'Groq hat die Testanfrage nicht angenommen (HTTP ' + r.status + ').' + (msg ? ' Meldung: ' + msg : ''));
    }
    if (provider == 'GEOAPIFY_KEY') {
      const r = await fetch('https://api.geoapify.com/v2/places?categories=commercial&filter=circle:12.1405,54.0887,2000&limit=1&apiKey=' + encodeURIComponent(key), { signal: T() });
      if (r.ok) return res('ok', 'Der Geoapify-Key funktioniert.');
      if (r.status >= 500) return down(r);
      const j = await json(r), msg = clean(j.message || j.error || '');
      if (r.status == 401 || r.status == 403) return res('invalid', 'Geoapify lehnt den Key ab (ungültig oder für diese Anfrage gesperrt).' + (msg ? ' Meldung: ' + msg : ''));
      if (r.status == 429) return res('warn', 'Der Key ist gültig, aber das Tageslimit von Geoapify ist erreicht. Morgen geht es weiter.');
      return res('warn', 'Geoapify hat die Testanfrage nicht angenommen (HTTP ' + r.status + ').' + (msg ? ' Meldung: ' + msg : ''));
    }
    if (provider == 'GOOGLE_PLACES_KEY') {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: T(), headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.displayName' }, body: JSON.stringify({ textQuery: 'Bäckerei in Rostock', pageSize: 1 }) });
      if (r.ok) return res('ok', 'Der Google-Places-Key funktioniert.');
      if (r.status >= 500) return down(r);
      const j = await json(r), msg = clean(j.error?.message || '');
      if (r.status == 429) return res('warn', 'Der Key ist gültig, aber das Anfrage-Limit von Google ist gerade erreicht.');
      if (r.status == 400 && /api key not valid|API_KEY_INVALID/i.test(JSON.stringify(j))) return res('invalid', 'Google lehnt den Key ab (ungültig oder falsch kopiert).');
      if (r.status == 401 || r.status == 403) return res('invalid', 'Der Key wird von Google nicht akzeptiert. Meistens ist „Places API (New)“ im Projekt nicht aktiviert, die Abrechnung fehlt oder der Key ist eingeschränkt.' + (msg ? ' Meldung: ' + msg : ''));
      return res('warn', 'Google hat die Testanfrage nicht angenommen (HTTP ' + r.status + ').' + (msg ? ' Meldung: ' + msg : ''));
    }
  } catch (e) { return net(e); }
  throw fatal('Unbekannter Anbieter');
}


// ---------- Liste per E-Mail (eigener SMTP-Zugang, z. B. iCloud: smtp.mail.me.com, Port 587, App-spezifisches Passwort)
const LIST_TO = () => { const a = [...new Set(String(E.LIST_TO || 'gloegema@icloud.com').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean))]; return a.slice(0, 5); };   // mehrere Empfänger, höchstens 5
const smtpReady = () => !!(E.SMTP_HOST && E.SMTP_USER && E.SMTP_PASS);
const oneLine = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();   // verhindert Header-Injection
const hdr = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
async function smtpSend({ to, subject, text }) {   // to: Liste von Adressen
  to = [].concat(to);
  const host = oneLine(E.SMTP_HOST), port = +E.SMTP_PORT || 587, user = oneLine(E.SMTP_USER), from = oneLine(E.SMTP_FROM || E.SMTP_USER);
  const mode = E.SMTP_SECURE || (port == 465 ? 'ssl' : 'starttls');   // ssl | starttls | none
  const okAddr = a => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(a);
  if (!okAddr(from)) throw fatal('Die Absenderadresse ist ungültig (Einstellungen)');
  if (!to.length || !to.every(okAddr)) throw fatal('Eine Empfängeradresse ist ungültig (Einstellungen). Mehrere Adressen mit Komma trennen.');
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiting = null, done = false;
    const fail = e => { if (done) return; done = true; try { sock?.destroy(); } catch {} reject(Object.assign(e instanceof Error ? e : Error(String(e)), { fatal: 1 })); };
    const timer = setTimeout(() => fail(Error('Zeitüberschreitung beim Senden (30 Sekunden)')), 30000);
    const feed = () => {   // vollständige Antwort = Zeilen bis zu einer ohne „-“ nach dem Code
      const m = buf.match(/^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/);
      if (m && waiting) { const t = m[0]; buf = buf.slice(t.length); const w = waiting; waiting = null; w(t); }
    };
    const attach = s => { s.setEncoding('utf8'); s.on('data', d => { buf += d; feed(); }); s.on('error', e => fail(Error('Verbindung zum Mailserver: ' + (e.code || e.message)))); s.on('close', () => { if (!done && waiting) fail(Error('Mailserver hat die Verbindung beendet')); }); };
    const read = () => new Promise(r => { waiting = r; feed(); });
    const cmd = async (c, ok) => { sock.write(c + '\r\n'); const r = await read(); if (!ok.includes(r[0] + r[1] + r[2])) throw Error('Mailserver: ' + r.trim().split('\n').pop().slice(0, 200)); return r; };
    (async () => {
      sock = mode == 'ssl' ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      attach(sock);
      let r = await read(); if (!r.startsWith('220')) throw Error('Mailserver: ' + r.trim().slice(0, 200));
      await cmd('EHLO prospectly.local', ['250']);
      if (mode == 'starttls') {
        await cmd('STARTTLS', ['220']);
        sock.removeAllListeners('data'); sock.removeAllListeners('close');
        sock = tls.connect({ socket: sock, servername: host }); buf = ''; attach(sock);
        await new Promise((ok, no) => { sock.once('secureConnect', ok); sock.once('error', no); });
        await cmd('EHLO prospectly.local', ['250']);
      }
      if (user) {
        await cmd('AUTH LOGIN', ['334']);
        await cmd(Buffer.from(user).toString('base64'), ['334']);
        try { await cmd(Buffer.from(E.SMTP_PASS || '').toString('base64'), ['235']); } catch (e) { throw Error('Anmeldung beim Mailserver abgelehnt. Bei iCloud brauchst du ein App-spezifisches Passwort. (' + e.message + ')'); }
      }
      await cmd(`MAIL FROM:<${from}>`, ['250']);
      for (const a of to) await cmd(`RCPT TO:<${a}>`, ['250', '251']);
      await cmd('DATA', ['354']);
      const body = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
      const msg = [`From: Prospectly <${from}>`, `To: ${to.map(a => `<${a}>`).join(', ')}`, `Subject: ${hdr(oneLine(subject))}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${uid()}${uid()}@prospectly.local>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', body].join('\r\n');
      await cmd(msg.replace(/^\./gm, '..') + '\r\n.', ['250']);
      try { sock.write('QUIT\r\n'); sock.end(); } catch {}
      done = true; clearTimeout(timer); resolve();
    })().catch(e => { clearTimeout(timer); fail(e); });
  });
}
function listText() {
  const order = { '': 0, callback: 1, noanswer: 2, interested: 3, no: 4 }, RES = { '': 'noch offen', noanswer: 'nicht erreicht', callback: 'Rückruf', interested: 'interessiert', no: 'kein Interesse' };
  const all = Object.values(db.leads).filter(l => l.list == 'cold'), withNr = all.filter(l => l.phone).sort((a, b) => order[a.cold?.res || ''] - order[b.cold?.res || ''] || a.name.localeCompare(b.name, 'de'));
  const when = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
  const lines = [`Cold-Call-Liste vom ${when} Uhr`, `${withNr.length} Nummern${all.length > withNr.length ? ` (${all.length - withNr.length} Leads ohne Nummer nicht dabei)` : ''}`, ''];
  withNr.forEach((l, i) => {
    const q = encodeURIComponent([l.name, l.g?.addr || l.addr || l.city].filter(Boolean).join(' '));
    lines.push(`${i + 1}. ${l.name}`, `   Tel: ${l.phone}`, `   Adresse (Google): ${l.g?.addr || l.addr || '–'}`, `   Google Maps: ${l.g?.maps || 'https://www.google.com/maps/search/' + q}`, `   Status: ${RES[l.cold?.res || '']}`, ...(l.cold?.note ? [`   Notiz: ${l.cold.note.replace(/\s+/g, ' ').slice(0, 300)}`] : []), '');
  });
  return { text: lines.join('\n'), n: withNr.length };
}

// ---------- HTTP
const send = (r, c, b, h = {}) => {
  const isStr = typeof b == 'string' || Buffer.isBuffer(b);
  r.writeHead(c, { 'content-type': isStr ? 'text/html; charset=utf-8' : 'application/json', ...h });
  r.end(isStr ? b : JSON.stringify(b));
};
const SK = ['GOOGLE_PLACES_KEY', 'GEOAPIFY_KEY'], MAILK = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_FROM', 'LIST_TO'];
const slim = l => { const { snip, desc, report, title, ...r } = l; return r; };   // schwere Felder bleiben auf dem Server
const rebuildSeen = () => { db.seen = {}; for (const l of Object.values(db.leads)) for (const y of keysOf(l)) db.seen[y] = l.created || now(); };
const dropJobsOf = () => { db.jobs = db.jobs.filter(j => !(j.data?.lid && !db.leads[j.data.lid])); };
const ids = v => (Array.isArray(v) ? v : []).slice(0, 5000);

const FAIL = {};
const srv = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname, M = req.method;
    if (p == '/' || p == '/index.html') {
      let h;
      try { h = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'); }
      catch { return send(res, 500, '<h2>public/index.html fehlt</h2><p>Die Oberfläche muss im Ordner „public“ liegen.</p>'); }
      if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) h = h.replace('</head>', '<script>window.TOKEN=' + JSON.stringify(TOKEN) + ';</script></head>');
      return send(res, 200, h);
    }
    if (!p.startsWith('/api/')) return send(res, 404, { error: '404' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim(), f = FAIL[ip] || { n: 0, t: 0 };
    if (f.n >= 8 && now() - f.t < 600000) return send(res, 429, { error: 'Zu viele Versuche, bitte 10 Minuten warten' });
    if (req.headers['x-token'] != TOKEN) { FAIL[ip] = { n: (now() - f.t < 600000 ? f.n : 0) + 1, t: now() }; return send(res, 401, { error: 'Code falsch' }); }
    delete FAIL[ip];
    let b = {};
    if (M != 'GET') {
      let s = '';
      for await (const c of req) { s += c; if (s.length > 2e6) throw fatal('Anfrage zu groß'); }
      try { b = JSON.parse(s || '{}'); } catch {}
    }
    const R = p.split('/').slice(2), lead = R[0] == 'leads' && R[1] ? db.leads[R[1]] : null;

    if (M == 'GET' && R[0] == 'state') {
      if (u.searchParams.get('rev') == String(rev)) return send(res, 200, { same: 1 });
      const js = {}; db.jobs.forEach(j => { if (['pending', 'running'].includes(j.status)) js[j.type] = (js[j.type] || 0) + 1; });
      return send(res, 200, { rev, leads: Object.values(db.leads).map(slim), cats: Object.keys(CATS), jobs: js, log: db.log.slice(0, 20), search: db.cfg.lastSearch || null, progress: progressView(),
        status: { places: !!E.GOOGLE_PLACES_KEY, geo: !!E.GEOAPIFY_KEY, smtp: smtpReady(), mail: { ...Object.fromEntries(MAILK.map(k => [k, E[k] || ''])), SMTP_PASS: !!E.SMTP_PASS, to: LIST_TO().join(', ') }, hints: Object.fromEntries(SK.map(k => [k, E[k] ? '…' + E[k].slice(-4) : ''])) } });
    }
    if (M == 'POST' && R[0] == 'search') {
      const location = str(b.location, 100).trim(), category = str(b.category, 60);
      if (!location) throw fatal('Bitte einen Ort eingeben');
      if (!CATS[category]) throw fatal('Unbekannte Branche');
      if (db.jobs.some(j => j.type == 'search' && ['pending', 'running'].includes(j.status))) throw fatal('Es läuft schon eine Suche. Bitte kurz warten.');
      const c = { id: uid(), location, category, maxLeads: Math.min(1000, Math.max(1, +b.maxLeads || 50)), radiusKm: Math.min(50, Math.max(1, +b.radiusKm || 5)), web: ['with', 'without'].includes(b.web) ? b.web : 'any', once: true, created: now() };
      db.campaigns.push(c); enq('search', { cid: c.id }); return send(res, 200, { ok: 1 });
    }
    if (M == 'POST' && R[0] == 'leads' && R[1] == 'sort') {   // viele Leads in Pool / Cold Calls / Aussortiert schieben
      let n = 0;
      for (const id of ids(b.ids)) { const l = db.leads[id]; if (!l) continue; moveLead(l, b.list ?? ''); n++; }
      save(); return send(res, 200, { ok: 1, n });
    }
    if (M == 'POST' && R[0] == 'leads' && R[1] == 'delete') {   // endgültig löschen (bleibt bei neuen Suchen ausgeblendet)
      let n = 0;
      for (const id of ids(b.ids)) { const l = db.leads[id]; if (!l) continue; for (const y of keysOf(l)) db.seen[y] = now(); delete db.leads[id]; n++; }
      dropJobsOf(); save(); return send(res, 200, { ok: 1, n });
    }
    if (M == 'POST' && R[0] == 'leads' && R[1] == 'google-bulk') {
      let n = 0, miss = 0;
      for (const id of ids(b.ids).slice(0, 60)) {
        const l = db.leads[id]; if (!l || (l.g && !l.g.none)) continue;
        await googleLookup(l); l.g.none ? miss++ : n++; await sleep(150);
      }
      rev++; return send(res, 200, { ok: 1, n, miss });
    }
    if (M == 'POST' && R[0] == 'wipe-pool') {   // „Alle Leads löschen“: nur der Pool. Cold Calls und Aussortiert bleiben.
      let n = 0;
      for (const l of Object.values(db.leads)) { if (l.list) continue; delete db.leads[l.id]; n++; }
      rebuildSeen(); dropJobsOf(); if (!db.jobs.some(j => j.type == 'search' && ['pending', 'running'].includes(j.status))) PROG = { phase: 'idle' };
      save(); return send(res, 200, { ok: 1, n, kept: Object.keys(db.leads).length });
    }
    if (R[0] == 'leads' && lead) {
      if (M == 'DELETE' && !R[2]) { for (const y of keysOf(lead)) db.seen[y] = now(); delete db.leads[lead.id]; dropJobsOf(); save(); return send(res, 200, { ok: 1 }); }
      if (M == 'PATCH' && !R[2]) {
        for (const k of ['name', 'phone', 'email', 'notes']) if (k in b) lead[k] = str(b[k], k == 'notes' ? 5000 : 200).trim();
        if ('web' in b) { setWeb(lead, str(b.web, 300)); if (lead.web) { lead.scanFailed = false; enq('scan', { lid: lead.id }); } else { lead.grade = lead.social ? 'social' : 'none'; lead.score = lead.social ? 85 : 90; } }
        if ('list' in b) moveLead(lead, b.list);
        if ('call' in b) setCall(lead, b.call);
        if ('note' in b) { if (!lead.cold) throw fatal('Nicht in Cold Calls'); lead.cold.note = str(b.note, 5000); }
        save(); return send(res, 200, slim(lead));
      }
      if (M == 'POST' && R[2] == 'google') { const g = await googleLookup(lead); rev++; return send(res, 200, { ok: 1, g }); }
      if (M == 'POST' && R[2] == 'scan') { lead.scanFailed = false; enq('scan', { lid: lead.id }); return send(res, 200, { ok: 1 }); }
    }
    if (M == 'POST' && R[0] == 'send-list') {   // Empfänger kommt nur aus den Einstellungen, nie aus der Anfrage
      const { text, n } = listText();
      if (!n) throw fatal('In der Cold-Call-Liste gibt es keine Leads mit Telefonnummer');
      if (!smtpReady()) throw fatal('Der E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail-Versand der Liste).');
      const to = LIST_TO();
      await smtpSend({ to, subject: `Cold-Call-Liste: ${n} Nummern`, text });
      log(`Cold-Call-Liste (${n} Nummern) an ${to.join(', ')} gesendet`); return send(res, 200, { ok: 1, n, to: to.join(', ') });
    }
    if (M == 'GET' && R[0] == 'list-text') return send(res, 200, listText());
    if (M == 'POST' && R[0] == 'test-key') {
      const pv = String(b.provider || '');
      if (!SK.includes(pv)) throw fatal('Unbekannter Anbieter');
      const typed = typeof b.key == 'string' && b.key.trim() ? b.key.trim() : '';
      return send(res, 200, await testKey(pv, { key: typed || E[pv] || '' }));
    }
    if (M == 'POST' && R[0] == 'settings') {
      const t = db.cfg.s = db.cfg.s || {};
      for (const k of SK) if (typeof b[k] == 'string' && b[k].trim()) { t[k] = b[k].trim(); E[k] = t[k]; }
      for (const k of MAILK) if (typeof b[k] == 'string') { t[k] = oneLine(b[k]).slice(0, 200); E[k] = t[k]; }
      if (typeof b.SMTP_PASS == 'string' && b.SMTP_PASS.trim()) { t.SMTP_PASS = /gmail|google/i.test(E.SMTP_HOST || '') ? b.SMTP_PASS.replace(/\s+/g, '') : b.SMTP_PASS.trim(); E.SMTP_PASS = t.SMTP_PASS; }   // Gmail zeigt App-Passwörter mit Leerzeichen
      for (const k of Array.isArray(b.clear) ? b.clear : []) if ([...SK, 'SMTP_PASS'].includes(k)) { delete t[k]; delete E[k]; }
      save(); return send(res, 200, { ok: 1 });
    }
    if (M == 'GET' && R[0] == 'export') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="prospectly-backup.json"' });
      const ex = { ...db, cfg: { ...db.cfg } }; delete ex.cfg.s; return res.end(JSON.stringify(ex));   // Keys gehören nicht in ein Backup
    }
    send(res, 404, { error: '404' });
  } catch (e) { send(res, e.fatal ? 400 : 500, { error: e.message }); }
});
srv.on('error', e => {
  if (e.code == 'EADDRINUSE') console.error(`\n!! Port ${PORT} ist belegt. Läuft Prospectly schon in einem anderen Fenster? Sonst PORT=3100 in .env setzen.\n`);
  else console.error('Serverfehler:', e.message);
  process.exit(1);
});
srv.listen(PORT, HOST, () => {
  console.log(`Prospectly v2 läuft: http://localhost:${PORT}  (Zugangstoken für Fernzugriff: ${TOKEN})`);
  if (!E.NO_BROWSER) try { require('child_process').exec((process.platform == 'win32' ? 'start ""' : process.platform == 'darwin' ? 'open' : 'xdg-open') + ' http://localhost:' + PORT, () => {}); } catch {}
});
