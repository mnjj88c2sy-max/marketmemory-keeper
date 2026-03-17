// MarketMemory — Railway Keeper v2
// Apre la pagina Netlify in un browser headless e la mantiene viva H24.
// Non modifica app.js. Non interferisce con la logica del motore.

const puppeteer = require('puppeteer');

const APP_URL      = process.env.MM_URL            || 'https://YOUR-APP.netlify.app';
const RELOAD_EVERY = parseInt(process.env.RELOAD_EVERY_MIN || '120') * 60 * 1000;
const CHECK_EVERY  = parseInt(process.env.CHECK_EVERY_MIN  || '5')   * 60 * 1000;
const TZ           = process.env.TZ || 'Europe/Rome';

function ts() {
  return new Date().toLocaleString('it-IT', { timeZone: TZ });
}
function log(msg) { console.log(`[${ts()}] ${msg}`); }

async function launch() {
  log('Avvio Puppeteer...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ]
  });

  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') log(`[browser:error] ${msg.text()}`);
  });
  page.on('pageerror', err => log(`[browser:pageerror] ${err.message}`));

  log(`Apertura ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  log('Pagina caricata. Motore attivo.');

  return { browser, page };
}

// Health check dinamico: verifica che il motore stia davvero girando
async function checkAlive(page) {
  return await page.evaluate(() => {
    try {
      const s = window.state;
      if (!s) return { ok: false, reason: 'state undefined' };
      const lastCycle = s.lastCycleAt || s.meta?.lastCycleAt || null;
      const openTrades = (s.paper?.open || []).length;
      const closedTrades = (s.paper?.closed || []).length;
      return {
        ok: true,
        lastCycle,
        openTrades,
        closedTrades,
        regime: s.lastAnalysis?.regimeResult?.regime || null
      };
    } catch(e) {
      return { ok: false, reason: e.message };
    }
  });
}

async function run() {
  let browser, page;
  let lastReload = Date.now();

  try {
    ({ browser, page } = await launch());
  } catch (err) {
    log(`Errore avvio: ${err.message}`);
    process.exit(1);
  }

  setInterval(async () => {
    try {
      // 1. Health check dinamico su window.state
      const alive = await checkAlive(page);
      if (alive.ok) {
        log(`Health OK — regime:${alive.regime} open:${alive.openTrades} closed:${alive.closedTrades} lastCycle:${alive.lastCycle || 'n/a'}`);
      } else {
        log(`Health WARN — ${alive.reason}`);
      }

      // 2. Reload periodico per evitare memory leak e stato zombie
      if (Date.now() - lastReload > RELOAD_EVERY) {
        log('Reload periodico...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        lastReload = Date.now();
        log('Reload completato.');
      }

    } catch (err) {
      log(`Health check fallito: ${err.message} — riavvio browser...`);
      try { await browser.close(); } catch(_) {}
      try {
        ({ browser, page } = await launch());
        lastReload = Date.now();
      } catch (relaunchErr) {
        log(`Riavvio fallito: ${relaunchErr.message} — uscita.`);
        process.exit(1);
      }
    }
  }, CHECK_EVERY);

  log(`Keeper attivo. Check ogni ${CHECK_EVERY/60000}min, reload ogni ${RELOAD_EVERY/60000}min.`);
}

run();
