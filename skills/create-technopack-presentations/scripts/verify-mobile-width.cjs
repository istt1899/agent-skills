/* Responsive width acceptance for self-contained HTML presentations.
 * Usage: node verify-mobile-width.cjs presentation.html report.json
 * Optional: BROWSER=webkit, PLAYWRIGHT_MODULE=/path/to/playwright.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');

function getPlaywright() {
  const choices = [process.env.PLAYWRIGHT_MODULE, 'playwright'];
  if (process.env.USERPROFILE) choices.push(path.join(process.env.USERPROFILE,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  for (const candidate of choices.filter(Boolean)) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Set PLAYWRIGHT_MODULE to the installed Playwright package');
}

const html = path.resolve(process.argv[2]);
if (!fs.existsSync(html)) throw new Error(`HTML not found: ${html}`);
const reportFile = path.resolve(process.argv[3] || 'mobile-width-qa.json');
const engine = process.env.BROWSER || 'chromium';
if (!['chromium', 'webkit'].includes(engine)) throw new Error(`Unsupported browser: ${engine}`);
const report = {html, sha256:createHash('sha256').update(fs.readFileSync(html)).digest('hex'),
  engine, physicalDevice:false, telegramPreview:false, checks:[]};
fs.mkdirSync(path.dirname(reportFile), {recursive:true});

(async () => {
  const chrome = process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await getPlaywright()[engine].launch({headless:true,
    ...(engine === 'chromium' && fs.existsSync(chrome) ? {executablePath:chrome} : {})});
  try {
    for (const width of [320, 375, 390, 430, 750, 768, 1280]) {
      for (const javascriptEnabled of [true, false]) {
        const context = await browser.newContext({viewport:{width,height:844},
          javascriptEnabled, deviceScaleFactor:1});
        const url = engine === 'webkit' ? 'http://presentation.invalid/offline.html' : pathToFileURL(html).href;
        if (engine === 'webkit') await context.route('**/*', route => route.request().url() === url
          ? route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync(html)})
          : route.abort());
        else await context.setOffline(true);
        const page = await context.newPage();
        await page.goto(url);
        const measurements = await page.evaluate(() => {
          const root = document.documentElement;
          const selectors = ['.cover', '.cover .wrap', '.cover-copy', 'h1', '.cost-table',
            '.top', '.top nav', '.route-map', '.vote'];
          const blocks = selectors.map(selector => {
            const element = document.querySelector(selector);
            if (!element) return {selector,missing:true};
            const box = element.getBoundingClientRect();
            return {selector,left:Math.round(box.left),right:Math.round(box.right),
              client:element.clientWidth,scroll:element.scrollWidth};
          });
          return {viewport:innerWidth,client:root.clientWidth,scroll:root.scrollWidth,
            bodyScroll:document.body.scrollWidth,blocks};
        });
        if (width === 390 && javascriptEnabled)
          await page.screenshot({path:reportFile.replace(/\.json$/i, '-390.png'),fullPage:false});
        const failures = [];
        if (measurements.scroll > measurements.client + 1 || measurements.bodyScroll > measurements.client + 1)
          failures.push('document overflows viewport');
        for (const b of measurements.blocks) {
          if (b.missing) continue;
          if (b.selector !== '.route-map' && b.selector !== '.top nav' && b.scroll > b.client + 1)
            failures.push(`${b.selector} has clipped content`);
          if (b.left < -1 || b.right > measurements.client + 1)
            failures.push(`${b.selector} extends outside viewport`);
        }
        report.checks.push({width,javascriptEnabled,...measurements,failures});
        await context.close();
      }
    }
  } finally { await browser.close(); }
  report.passed = report.checks.every(c => c.failures.length === 0);
  fs.writeFileSync(reportFile, JSON.stringify(report,null,2));
  console.log(`Mobile width ${engine}: ${report.checks.length} checks, ${report.passed ? 'PASS' : 'FAIL'} — ${reportFile}`);
  if (!report.passed) {
    for (const c of report.checks.filter(c => c.failures.length))
      console.error(`${c.width}px JS=${c.javascriptEnabled}: ${c.failures.join('; ')}`);
    process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
