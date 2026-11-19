/*
 * OWA add-in probe harness.
 *
 * Logs into Outlook Web App, opens the message with an attachment, activates the
 * "Outlook Ajani - Yetenek Olcumu" add-in, and captures the diagnostic text the
 * add-in renders inside its iframe (https://mail.example.local:4443/probe.html).
 *
 * Credentials come from env: OWA_USER / OWA_PASS. Nothing is written to disk.
 * Read-only with respect to the mailbox: it opens and reads, never sends/deletes/moves.
 *
 * Usage:
 *   set OWA_USER / OWA_PASS, then: node run.js
 *   HEADED=1 node run.js     -> run with a visible browser
 *   KEEP_OPEN=1              -> leave the browser open at the end (manual inspection)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const OWA_URL = 'https://mail.example.local/owa';
const ADDIN_HOST = 'mail.example.local:4443';
const ADDIN_PAGE = 'probe.html';
const SUBJECT_HINT = 'ILN-2026-4471';
const ADDIN_NAMES = ['Yetenek Olcumu', 'Yetenek Ölçümü', 'Outlook Ajani', 'Outlook Ajanı'];

const USER = process.env.OWA_USER;
const PASS = process.env.OWA_PASS;

// Exchange 2019 OWA rejects Playwright's default "HeadlessChrome" UA with
// OwaNotSupportedException, so pin a normal desktop Chrome UA.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HEADED = !!process.env.HEADED;
const KEEP_OPEN = !!process.env.KEEP_OPEN;

let step = 'init';
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const setStep = s => { step = s; log(`=== STEP: ${s} ===`); };

function writeUtf8NoBom(file, text) {
  fs.writeFileSync(file, Buffer.from(text, 'utf8'));
}

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */
async function dumpDiagnostics(page, label) {
  const base = path.join(OUT_DIR, `fail-${label}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: false });
    log(`screenshot -> ${base}.png`);
  } catch (e) { log('screenshot failed:', e.message); }

  let html = '';
  try { html = await page.content(); } catch (e) { html = `<!-- page.content() failed: ${e.message} -->`; }

  let frameDump = '';
  try {
    const frames = page.frames();
    frameDump = frames.map((f, i) => {
      let name = '';
      try { name = f.name(); } catch (_) {}
      return `  [${i}] name=${JSON.stringify(name)} url=${f.url()}`;
    }).join('\n');
  } catch (e) { frameDump = `frame enumeration failed: ${e.message}`; }

  log('--- FRAME URLS ---\n' + frameDump);

  // Per-frame innerText so a nested add-in frame's state is visible even on failure.
  let frameText = '';
  for (const f of page.frames()) {
    try {
      const t = await f.evaluate(() => (document.body ? document.body.innerText : '<no body>')).catch(e => `<eval err: ${e.message}>`);
      frameText += `\n----- FRAME ${f.url()} -----\n${String(t).slice(0, 8000)}\n`;
    } catch (e) {
      frameText += `\n----- FRAME ${f.url()} ----- <unreadable: ${e.message}>\n`;
    }
  }

  const out =
    `<!--\nFAILED STEP: ${label}\nPAGE URL: ${page.url()}\nTIME: ${new Date().toISOString()}\n\n` +
    `FRAME URLS (${page.frames().length}):\n${frameDump}\n\n` +
    `FRAME INNERTEXT:\n${frameText}\n-->\n\n` + html;
  writeUtf8NoBom(`${base}.html`, out);
  log(`dom dump -> ${base}.html`);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function findAddinFrame(page) {
  return page.frames().find(f => {
    const u = f.url() || '';
    return u.includes(ADDIN_PAGE) || u.includes(ADDIN_HOST);
  });
}

async function frameText(frame) {
  return frame.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
}

/** Dump every clickable/labelled element across the page, for selector discovery. */
async function dumpClickables(page, tag) {
  const items = await page.evaluate(() => {
    const out = [];
    const sel = 'button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],a,[aria-label],[title],div[tabindex],span[tabindex],li';
    document.querySelectorAll(sel).forEach(el => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || '') + '|' + (el.getAttribute('title') || '') + '|' + (el.innerText || '').replace(/\s+/g, ' ').slice(0, 70);
      if (label.replace(/\|/g, '').trim() === '') return;
      out.push({
        t: el.tagName,
        id: el.id || '',
        role: el.getAttribute('role') || '',
        cls: (el.className || '').toString().slice(0, 60),
        label: label.slice(0, 160),
        vis: r.width > 0 && r.height > 0,
        box: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      });
    });
    return out;
  }).catch(e => [{ err: e.message }]);
  const file = path.join(OUT_DIR, `dbg-clickables-${tag}.json`);
  writeUtf8NoBom(file, JSON.stringify(items, null, 1));
  log(`clickables (${items.length}) -> ${file}`);
  return items;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
(async () => {
  if (!USER || !PASS) {
    console.error('ERROR: set OWA_USER and OWA_PASS environment variables.');
    process.exit(2);
  }

  setStep('launch');
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--ignore-certificate-errors', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1680, height: 1050 },
    userAgent: UA,
    // Covers the case where OWA/the add-in host answers with a Windows basic-auth dialog.
    httpCredentials: { username: USER, password: PASS },
  });
  context.setDefaultTimeout(30000);

  const page = await context.newPage();
  page.on('console', m => {
    const t = m.text();
    if (/probe|office|error/i.test(t)) log('[console]', m.type(), t.slice(0, 250));
  });
  page.on('frameattached', f => log('[frame+]', f.url() || '(about:blank)'));
  page.on('framenavigated', f => {
    const u = f.url() || '';
    if (u.includes(ADDIN_HOST) || u.includes(ADDIN_PAGE)) log('[frame->]', u);
  });

  try {
    /* ---------- 1. login ---------- */
    setStep('login');
    await page.goto(OWA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500); // the /owa -> logon.aspx redirect
    log('landed on', page.url());

    if (/logon\.aspx|auth\/logon/i.test(page.url()) || await page.locator('#username').count()) {
      await page.fill('#username', USER);
      await page.fill('#password', PASS);
      log('submitting logon form');
      // The OWA sign-in control is a <div role="button" onclick="clkLgn()">, and a
      // transparent .logonContainer overlays it, so a real click gets intercepted.
      // Invoke the page's own submit handler instead.
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
        page.evaluate(() => {
          if (typeof clkLgn === 'function') { clkLgn(); return 'clkLgn()'; }
          const b = document.querySelector('.signinbutton, input[type="submit"], button[type="submit"]');
          if (b) { b.click(); return 'click'; }
          document.forms.logonForm && document.forms.logonForm.submit();
          return 'form.submit()';
        }).then(how => log('submit via', how)).catch(e => log('submit eval raced navigation:', e.message.slice(0, 60))),
      ]);
      log('post-login url', page.url());
    } else {
      log('no logon form detected (httpCredentials may have handled it)');
    }

    // First-run language/timezone page (languageselection.aspx). OWA refuses to
    // open the mailbox until a time zone is chosen; this is a per-user OWA
    // preference, not a server-side change.
    setStep('firstrun');
    await page.waitForTimeout(4000);
    if (/languageselection\.aspx/i.test(page.url()) || await page.locator('#selTz').count()) {
      log('language/timezone setup page detected');
      const picked = await page.evaluate(() => {
        const tz = document.getElementById('selTz');
        if (!tz) return 'no #selTz';
        const opts = Array.from(tz.options);
        const want = opts.find(o => /Turkey|Istanbul/i.test(o.value + o.text))
          || opts.find(o => /UTC\)|Coordinated Universal Time/i.test(o.text))
          || opts.find(o => o.value && o.value !== '');
        if (!want) return 'no option';
        tz.value = want.value;
        tz.dispatchEvent(new Event('change', { bubbles: true }));
        return want.value;
      });
      log('timezone picked:', picked);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
        page.evaluate(() => {
          if (typeof frmSbmt === 'function') { frmSbmt(); return; }
          document.forms.lngFrm && document.forms.lngFrm.submit();
        }).catch(() => {}),
      ]);
      log('after language save ->', page.url());
      await page.waitForTimeout(8000);
    }

    /* ---------- 2. wait for mailbox ---------- */
    setStep('mailbox');
    await page.waitForLoadState('domcontentloaded');
    // OWA is an SPA; wait for the message list to materialise.
    await page.waitForFunction(
      hint => document.body && document.body.innerText && document.body.innerText.includes(hint),
      SUBJECT_HINT,
      { timeout: 90000 }
    );
    log('mailbox loaded, subject hint visible. url =', page.url());
    await page.screenshot({ path: path.join(OUT_DIR, 'dbg-mailbox.png') });

    /* ---------- 3. open the message ---------- */
    setStep('openmessage');
    const row = page.locator(`text=${SUBJECT_HINT}`).first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    await row.click({ timeout: 20000 });
    log('clicked message row');
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(OUT_DIR, 'dbg-message-open.png') });

    /* ---------- 4. activate the add-in ---------- */
    setStep('findaddin');
    await dumpClickables(page, 'message-open');

    const clicked = await activateAddin(page);
    if (!clicked) throw new Error('could not find an add-in entry in toolbar or overflow menu');

    /* ---------- 5. wait for the add-in iframe results ---------- */
    setStep('addinframe');
    const deadline = Date.now() + 90000;
    let frame = null;
    while (Date.now() < deadline) {
      frame = findAddinFrame(page);
      if (frame) break;
      await page.waitForTimeout(1000);
    }
    if (!frame) throw new Error('add-in iframe (probe.html / :4443) never appeared');
    log('add-in frame found:', frame.url());

    setStep('addinresults');
    const textDeadline = Date.now() + 90000;
    let text = '';
    while (Date.now() < textDeadline) {
      frame = findAddinFrame(page) || frame;
      text = await frameText(frame);
      if (text && /En y[üu]ksek desteklenen Mailbox set:/.test(text)) break;
      await page.waitForTimeout(2000);
    }
    if (!/En y[üu]ksek desteklenen Mailbox set:/.test(text)) {
      log('--- add-in frame text so far ---\n' + text);
      throw new Error('add-in rendered but summary line never appeared');
    }
    log('summary line present; letting async rows settle');

    // The add-in warns its async rows resolve within ~10s. Keep sampling until
    // the rendered text stops changing, so slow probes (attachment, tokens)
    // are captured too.
    let stable = 0;
    const settleDeadline = Date.now() + 40000;
    while (stable < 3 && Date.now() < settleDeadline) {
      await page.waitForTimeout(2500);
      const next = await frameText(findAddinFrame(page) || frame);
      if (next && next === text) stable++;
      else { stable = 0; if (next) text = next; }
    }
    log(`text settled (${stable} stable samples, ${text.length} chars)`);

    /* ---------- 6. write output ---------- */
    setStep('write');
    const outFile = path.join(OUT_DIR, 'probe-output.txt');
    writeUtf8NoBom(outFile, text);
    log('wrote', outFile, `(${Buffer.byteLength(text, 'utf8')} bytes)`);
    await page.screenshot({ path: path.join(OUT_DIR, 'success.png') });

    console.log('\n===== PROBE OUTPUT =====\n');
    console.log(text);
    console.log('\n===== END PROBE OUTPUT =====\n');

    if (!KEEP_OPEN) await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(`\nFAILED at step "${step}": ${err.message}`);
    console.error(err.stack);
    await dumpDiagnostics(page, step).catch(e => console.error('diag failed', e.message));
    if (!KEEP_OPEN) await browser.close();
    process.exit(1);
  }
})();

/* ------------------------------------------------------------------ *
 * Add-in activation: toolbar first, then the "..." overflow menu.
 * ------------------------------------------------------------------ */
async function activateAddin(page) {
  const tryClick = async (loc, what) => {
    try {
      const n = await loc.count();
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        log(`clicking ${what} #${i}`);
        await el.click({ timeout: 8000 });
        await page.waitForTimeout(4000);
        if (findAddinFrame(page)) { log('add-in frame appeared after clicking', what); return true; }
      }
    } catch (e) { log(`click ${what} failed:`, e.message); }
    return false;
  };

  // (a) direct hit in the currently visible UI
  for (const name of ADDIN_NAMES) {
    const byLabel = page.locator(`[aria-label*="${name}" i], [title*="${name}" i]`);
    if (await tryClick(byLabel, `label "${name}"`)) return true;
    const byText = page.getByText(name, { exact: false });
    if (await tryClick(byText, `text "${name}"`)) return true;
  }

  // (b) open every plausible overflow / more-actions control, then retry
  const overflowSelectors = [
    '[aria-label*="More actions" i]',
    '[aria-label*="Diğer" i]',
    '[aria-label*="Diger" i]',
    '[aria-label*="Daha fazla" i]',
    '[title*="More actions" i]',
    '[aria-label*="Uygulama" i]',
    '[aria-label*="Add-in" i]',
    '[aria-label*="Eklenti" i]',
    'button:has-text("...")',
    'div[role="button"]:has-text("...")',
    '[aria-label="..."]',
  ];

  for (const sel of overflowSelectors) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      log(`opening overflow candidate ${sel} #${i}`);
      await el.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await dumpClickables(page, 'overflow-open');
      for (const name of ADDIN_NAMES) {
        const item = page.locator(`[aria-label*="${name}" i], [title*="${name}" i]`).or(page.getByText(name, { exact: false }));
        if (await tryClick(item, `menu item "${name}"`)) return true;
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  return false;
}
