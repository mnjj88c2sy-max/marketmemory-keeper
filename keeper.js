// MarketMemory — Railway Keeper v8
// Usa Chromium installato da Nixpacks — zero download aggiuntivi

const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const APP_URL      = process.env.MM_URL      || 'https://backtest-bomber.netlify.app';
const API_KEY      = process.env.MM_APIKEY   || '';
const RELOAD_EVERY = parseInt(process.env.RELOAD_EVERY_MIN || '120') * 60 * 1000;
const CHECK_EVERY  = parseInt(process.env.CHECK_EVERY_MIN  || '5')   * 60 * 1000;
const TZ           = process.env.TZ || 'Europe/Rome';

function ts()  { return new Date().toLocaleString('it-IT', { timeZone: TZ }); }
function log(m){ console.log(`[${ts()}] ${m}`); }

function findChromium() {
  // Nixpacks installa 'chromium' — cerca tutti i path possibili
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/nix/var/nix/profiles/default/bin/chromium',
    '/root/.nix-profile/bin/chromium',
  ].filter(Boolean);

  for (const p of candidates) {
    try { execSync(`test -x "${p}"`, {stdio:'ignore'}); return p; } catch(_) {}
  }
  // Fallback: which
  for (const cmd of ['chromium','chromium-browser']) {
    try { return execSync(`which ${cmd}`, {encoding:'utf8'}).trim(); } catch(_) {}
  }
  throw new Error('Chromium non trovato. Candidati: ' + candidates.join(', '));
}

async function launch() {
  const chromePath = findChromium();
  log(`Chromium: ${chromePath}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
           '--disable-gpu','--single-process','--no-zygote']
  });

  const page = await browser.newPage();
  page.on('console', msg => { if(msg.type()==='error') log(`[E] ${msg.text()}`); });
  page.on('pageerror', err => log(`[pageerror] ${err.message}`));

  log(`Apertura ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  if (API_KEY) {
    await page.evaluate((k) => {
      localStorage.setItem('TWELVE_API_KEY', k);
      var inp = document.getElementById('apiKey');
      if (inp) { inp.value = k; inp.dispatchEvent(new Event('input')); }
    }, API_KEY);
    log('API key iniettata.');
  }

  log('Reload...');
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));

  const started = await page.evaluate(() => {
    var btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText.includes('Avvia') || b.innerText.includes('Start'));
    if (btn) { btn.click(); return true; }
    return false;
  });
  log(started ? 'Motore avviato.' : 'WARN: bottone Avvia non trovato.');

  await new Promise(r => setTimeout(r, 8000));
  return { browser, page };
}

async function checkAlive(page) {
  return page.evaluate(() => {
    try {
      var s = window.state;
      if (!s) return { ok: false, reason: 'state undefined' };
      return {
        ok: true,
        open: s.paper && s.paper.open ? s.paper.open.length : 0,
        closed: s.paper && s.paper.closed ? s.paper.closed.length : 0,
        regime: s.lastAnalysis && s.lastAnalysis.regimeResult
                ? s.lastAnalysis.regimeResult.regime : '?',
        key: s.apiKey ? 'OK' : 'MISSING'
      };
    } catch(e) { return { ok: false, reason: e.message }; }
  });
}

async function run() {
  var browser, page, lastReload = Date.now();
  try { ({ browser, page } = await launch()); }
  catch(e) { log(`Avvio fallito: ${e.message}`); process.exit(1); }

  log(`Keeper attivo. Check ogni ${CHECK_EVERY/60000}min.`);

  setInterval(async () => {
    try {
      var a = await checkAlive(page);
      if (a.ok) {
        log(`OK regime:${a.regime} open:${a.open} closed:${a.closed} key:${a.key}`);
      } else {
        log(`WARN: ${a.reason}`);
        await page.evaluate(() => {
          var b = Array.from(document.querySelectorAll('button'))
            .find(b => b.innerText.includes('Avvia')||b.innerText.includes('Start'));
          if (b) b.click();
        });
      }
      if (Date.now() - lastReload > RELOAD_EVERY) {
        log('Reload periodico...');
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        await page.evaluate(() => {
          var b = Array.from(document.querySelectorAll('button'))
            .find(b => b.innerText.includes('Avvia')||b.innerText.includes('Start'));
          if (b) b.click();
        });
        lastReload = Date.now();
        log('Reload OK.');
      }
    } catch(e) {
      log(`Check fallito: ${e.message} — riavvio...`);
      try { await browser.close(); } catch(_) {}
      try { ({ browser, page } = await launch()); lastReload = Date.now(); }
      catch(e2) { log(`Riavvio fallito: ${e2.message}`); process.exit(1); }
    }
  }, CHECK_EVERY);
}

run();
