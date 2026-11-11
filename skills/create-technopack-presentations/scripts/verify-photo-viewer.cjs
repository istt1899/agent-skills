/* Real touch input, including the thumbnail-to-dialog transition.
 * Usage: node verify-photo-viewer.cjs presentation.html report.json
 * Optional: PLAYWRIGHT_MODULE and CHROME_EXECUTABLE; BROWSER=webkit.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {createHash} = require('node:crypto');

function playwright() {
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

const html = path.resolve(process.argv[2] || path.join(__dirname, '../assets/html-starter/index.html'));
const reportFile = path.resolve(process.argv[3] || 'photo-viewer-qa.json');
const sha256 = createHash('sha256').update(fs.readFileSync(html)).digest('hex');
const engine = process.env.BROWSER || 'chromium';
const report = {html, sha256, engine, physicalDevice: false, telegramPreview: false,
  verifierSha256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  transport: engine === 'webkit' ? 'in-memory HTTP route; other requests blocked; file preview unverified' : 'offline file URL', browserErrors: [], checks: []};
if (engine === 'webkit') report.limitations = [
  'The private Windows WebKit driver cannot add a second contact to an existing stream correctly; native multitouch is verified in Chromium.',
  'Raw WebKit touchCancel suppresses later synthesized clicks even without application code; cancellation is checked in a separate final context, closed by Escape.',
  'Native compositor panning and page-scale control are not proven by this WebKit driver; Chromium covers them.',
];
fs.mkdirSync(path.dirname(reportFile), {recursive: true});
let browser;
async function loadDocument(context) {
  const url = engine === 'webkit' ? 'http://presentation.invalid/offline.html' : pathToFileURL(html).href;
  if (engine === 'webkit') {
    await context.route('**/*', route => route.request().url() === url
      ? route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(html)})
      : route.abort());
  }
  if (engine !== 'webkit') await context.setOffline(true);
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  await page.goto(url);
  return page;
}
const tick = (page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const imageWidth = (page) => page.locator('#viewer-image').evaluate(img => img.getBoundingClientRect().width);
const isOpen = (page) => page.locator('#photo-viewer').evaluate(dialog => dialog.open);
const centerOfVisibleImage = (page) => page.evaluate(() => {
  const image = document.getElementById('viewer-image').getBoundingClientRect();
  const stage = document.querySelector('.viewer-stage').getBoundingClientRect();
  return {x: (Math.max(image.left, stage.left + 5) + Math.min(image.right, stage.right - 5)) / 2,
    y: (Math.max(image.top, stage.top + 5) + Math.min(image.bottom, stage.bottom - 5)) / 2};
});
async function doubleTap(page, point) {
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForTimeout(70);
  await page.touchscreen.tap(point.x, point.y);
  await tick(page);
}
async function closeAndReturn(page, position, id) {
  if (await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)) await page.locator('#viewer-close').tap();
  else await page.locator('#viewer-close').click();
  await assertReturned(page, position, id);
}
async function assertReturned(page, position, id) {
  try {
    await page.waitForFunction(() => !document.getElementById('photo-viewer').open, null, {timeout: 4000});
    await page.waitForFunction(expected => Math.abs(window.scrollY - expected.y) < 2
      && document.activeElement?.id === expected.id, {y: position, id}, {timeout: 4000});
  } catch (error) {
    report.returnFailure = await page.evaluate(expected => ({expected, open: document.getElementById('photo-viewer').open,
      scrollY, focus: document.activeElement?.id, bodyClass: document.body.className,
      trace: window.__touchTrace}), {y: position, id});
    await page.screenshot({path: path.join(path.dirname(reportFile), `${engine}-return-failure.png`)});
    throw error;
  }
  assert.equal(await page.locator('html').evaluate(e => e.classList.contains('viewer-open')), false);
}

async function touchDriver(context, page) {
  if (engine === 'chromium') {
    const cdp = await context.newCDPSession(page);
    let points = [];
    const send = (type) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: points});
    return {
      kind: 'browser touch stream (CDP)',
      down: async point => {
        points = [{id: 1, x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1}];
        await send('touchStart');
      },
      move: async point => { points[0] = {...points[0], x: point.x, y: point.y}; await send('touchMove'); },
      second: async point => { points.push({id: 2, x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1}); await send('touchStart'); },
      up: async () => { points = []; await send('touchEnd'); },
      cancel: async () => { points = []; await send('touchCancel'); },
      browserScale: scale => cdp.send('Emulation.setPageScaleFactor', {pageScaleFactor: scale}),
    };
  }
  // QA-only private WebKit protocol access. Fail explicitly if a future Playwright changes it.
  const session = page._connection?.toImpl?.(page)?.delegate?._pageProxySession;
  assert.equal(typeof session?.send, 'function', 'This Playwright build does not expose the verified WebKit touch stream');
  let points = [];
  const send = type => session.send('Input.dispatchTouchEvent', {type, modifiers: 0,
    touchPoints: points.map(point => ({...point, x: Math.round(point.x), y: Math.round(point.y)}))});
  return {
    kind: 'trusted browser touch stream (private WebKit Input protocol; QA only)',
    down: async point => {points = [{id: 1, ...point}]; await send('touchStart');},
    move: async point => {points[0] = {...points[0], ...point}; await send('touchMove');},
    second: async point => {points.push({id: 2, ...point}); await send('touchStart');},
    // WebKit needs the final contact coordinates for end/cancel, unlike Chromium CDP.
    up: async () => {await send('touchEnd'); points = [];},
    cancel: async () => {await send('touchCancel'); points = [];},
    browserScale: null,
  };
}

async function dragDismissCheck(viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({viewport, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, reducedMotion});
  const page = await loadDocument(context);
  const touch = await touchDriver(context, page);
  const phase = step => {report.current = {mode: 'drag-dismiss', viewport, reducedMotion, step};};
  await page.evaluate(() => {
    window.__touchTrust = {moves: 0, untrusted: 0};
    window.__touchTrace = [];
    document.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch') return;
      window.__touchTrust.moves++;
      if (!event.isTrusted) window.__touchTrust.untrusted++;
    }, true);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click']) {
      document.addEventListener(type, event => {
        window.__touchTrace.push({type, trusted: event.isTrusted, target: event.target.id || event.target.className,
          id: event.pointerId, primary: event.isPrimary, touches: event.touches?.length,
          x: event.clientX, y: event.clientY, time: event.timeStamp});
        if (window.__touchTrace.length > 90) window.__touchTrace.shift();
      }, true);
    }
  });
  const trigger = page.locator('a[data-zoom]').first();
  const id = await trigger.getAttribute('id');
  let position;
  async function open() {
    await trigger.scrollIntoViewIfNeeded();
    await tick(page);
    position = await page.evaluate(() => scrollY);
    const triggerTarget = await trigger.evaluate(link => {
      const box = link.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {x: box.x, y: box.y, width: box.width, height: box.height,
        hit: hit?.id || hit?.className, isChild: link.contains(hit), hash: location.hash,
        viewport: {scale: visualViewport.scale, x: visualViewport.offsetLeft, y: visualViewport.offsetTop}};
    });
    await trigger.evaluate(link => {
      window.__openingPosition = null;
      const record = () => {
        if (!document.getElementById('photo-viewer').open && window.__openingPosition === null) window.__openingPosition = scrollY;
        link.removeEventListener('pointerup', record, true);
        link.removeEventListener('click', record, true);
      };
      link.addEventListener('pointerup', record, {capture: true});
      link.addEventListener('click', record, {capture: true});
    });
    await trigger.tap();
    try {
      await page.waitForFunction(() => document.getElementById('photo-viewer').open, null, {timeout: 2000});
    } catch (error) {
      report.openFailure = {triggerTarget, state: await page.evaluate(() => ({open: document.getElementById('photo-viewer').open,
        scrollY, focus: document.activeElement?.id, hash: location.hash, bodyClass: document.body.className,
        trace: window.__touchTrace}))};
      await page.screenshot({path: path.join(path.dirname(reportFile), `${engine}-open-failure.png`)});
      throw error;
    }
    assert.equal(await isOpen(page), true, 'One real tap on the inline thumbnail must reopen the viewer');
    position = await page.evaluate(() => window.__openingPosition);
    assert.equal(typeof position, 'number', 'Record the actual activation position before the modal locks scrolling');
    // Later drag fixtures must not be mistaken for the second touch of the opening double tap.
    await page.waitForTimeout(350);
    return centerOfVisibleImage(page);
  }
  async function motion(start, dx, dy, duration = 280, {hold = 0, cancel = false, beforeRelease, settle = 350} = {}) {
    const before = await page.locator('#viewer-image').boundingBox();
    const beforeTransform = await page.locator('#viewer-image').evaluate(img => getComputedStyle(img).transform);
    await touch.down(start);
    if (hold) await page.waitForTimeout(hold);
    const steps = duration <= 60 ? 3 : 8;
    for (let step = 1; step <= steps; step++) {
      await touch.move({x: start.x + dx * step / steps, y: start.y + dy * step / steps});
      if (step < steps || duration > 60) await page.waitForTimeout(duration / steps);
    }
    if (duration <= 60 && !beforeRelease) {
      // Release a flick before any page reads or frames can age its last movement.
      if (cancel) await touch.cancel(); else await touch.up();
      if (settle) await page.waitForTimeout(settle);
      return {before, beforeTransform};
    }
    await tick(page);
    const during = await page.locator('#viewer-image').boundingBox();
    const duringTransform = await page.locator('#viewer-image').evaluate(img => getComputedStyle(img).transform);
    if (beforeRelease) await beforeRelease({before, during});
    if (cancel) await touch.cancel(); else await touch.up();
    if (settle) await page.waitForTimeout(settle);
    return {before, during, beforeTransform, duringTransform};
  }
  async function stationary(before) {
    assert.equal(await isOpen(page), true, 'Cancelled or short motion must keep the viewer open');
    const after = await page.locator('#viewer-image').boundingBox();
    assert.ok(Math.abs(after.y - before.y) < 2 && Math.abs(after.x - before.x) < 2,
      'Cancelled or short motion must settle back to the fitted position');
  }

  let point = await open();
  phase('short-drag-snapback');
  const short = await motion(point, 0, 20, 320);
  await stationary(short.before);
  if (viewport.width === 390 && reducedMotion !== 'reduce') {
    phase('interrupt-snapback');
    await motion(point, 0, 35, 320, {settle: 0});
    const continued = await centerOfVisibleImage(page);
    const midReturn = await page.locator('#viewer-image').boundingBox();
    await touch.down(continued);
    await touch.move({x: continued.x, y: continued.y + 15});
    await tick(page);
    const heldAgain = await page.locator('#viewer-image').boundingBox();
    assert.ok(Math.abs(heldAgain.y - midReturn.y) < 40, 'A new gesture must interrupt snapback without jumping');
    if (engine === 'webkit') {await page.waitForTimeout(150); await touch.up();}
    else await touch.cancel();
    await page.waitForTimeout(350);
    await stationary(short.before);
  }
  phase('horizontal-no-dismiss');
  const horizontal = await motion(point, Math.min(90, viewport.width / 4), 0, 320);
  await stationary(horizontal.before);
  phase('reverse-after-threshold');
  const threshold = await page.locator('.viewer-stage').evaluate(stage => Math.min(160, Math.max(80, stage.clientHeight * .22)));
  const outward = Math.min(threshold + 65, viewport.height - point.y - 18);
  const reverse = Math.min(35, (outward - threshold) / 2);
  assert.ok(reverse >= 10, 'The reversal fixture must leave a meaningful distance beyond the close threshold');
  await touch.down(point);
  for (let step = 1; step <= 8; step++) {
    await touch.move({x: point.x, y: point.y + outward * step / 8});
    await page.waitForTimeout(35);
  }
  await touch.move({x: point.x, y: point.y + outward - reverse / 2});
  await page.waitForTimeout(10);
  await touch.move({x: point.x, y: point.y + outward - reverse});
  await touch.up();
  await page.waitForTimeout(700);
  await stationary(short.before);
  if (engine === 'chromium') {
    phase('pointer-cancel');
    const cancelled = await motion(point, 0, 60, 260, {cancel: true});
    await stationary(cancelled.before);
    phase('second-finger-cancel');
    await touch.down(point);
    await touch.move({x: point.x, y: point.y + 35});
    await touch.second({x: point.x + 45, y: point.y + 35});
    await touch.cancel();
    await page.waitForTimeout(350);
    await stationary(cancelled.before);
  }
  phase(engine === 'chromium' ? 'double-tap-after-cancel' : 'double-tap-after-drag');
  const fitted = await imageWidth(page);
  await doubleTap(page, await centerOfVisibleImage(page));
  assert.ok(await imageWidth(page) > fitted * 1.2, 'Double tap must work after the preceding gestures');
  phase('enlarged-native-pan');
  point = await centerOfVisibleImage(page);
  const panBefore = await page.locator('.viewer-stage').evaluate(stage => ({top: stage.scrollTop, range: stage.scrollHeight - stage.clientHeight}));
  await motion(point, 0, -65, 260);
  assert.equal(await isOpen(page), true, 'Panning an enlarged photo must never dismiss it');
  if (engine === 'chromium' && panBefore.range > 10) {
    const panAfter = await page.locator('.viewer-stage').evaluate(stage => stage.scrollTop);
    assert.ok(Math.abs(panAfter - panBefore.top) > 2, 'Enlarged-photo native touch panning must still move the image');
  }
  await page.locator('#viewer-fit').tap();
  await closeAndReturn(page, position, id);

  point = await open();
  phase('long-drag-follow-and-return');
  const longDistance = Math.min(170, viewport.height - point.y - 18);
  assert.ok(longDistance >= 70, 'The viewport must leave room for a meaningful drag');
  await motion(point, 0, longDistance, 320, {beforeRelease: async ({before, during}) => {
    assert.ok(during.y - before.y > Math.min(35, longDistance / 3), 'Fitted photo must visibly follow the finger before release');
    if (viewport.width === 390) await page.screenshot({path: path.join(path.dirname(reportFile),
      `${engine}-${viewport.width}-${reducedMotion}-drag.png`)});
  }});
  await assertReturned(page, position, id);

  point = await open();
  phase('long-press-then-drag');
  await motion(point, 0, Math.min(150, viewport.height - point.y - 18), 280, {hold: 650});
  await assertReturned(page, position, id);

  point = await open();
  phase('fast-flick');
  await motion(point, 0, Math.min(80, viewport.height - point.y - 18), 35);
  await assertReturned(page, position, id);

  let pageZoom = 'not available in this WebKit driver';
  if (touch.browserScale) {
    phase('browser-zoom-guard');
    await open();
    await touch.browserScale(1.5);
    await page.waitForTimeout(100);
    const visualScale = await page.evaluate(() => visualViewport.scale);
    assert.ok(visualScale > 1.1, 'Browser zoom must be active for the dismissal guard check');
    point = await centerOfVisibleImage(page);
    // CDP coordinates remain CSS pixels; a small move is enough to check that no dismiss transform starts.
    const zoomed = await motion(point, 0, 60, 200);
    assert.equal(await isOpen(page), true, 'Browser zoom must prevent drag dismissal');
    assert.equal(zoomed.duringTransform, zoomed.beforeTransform, 'Browser zoom must not start a dismissal transform');
    await touch.browserScale(1);
    await closeAndReturn(page, position, id);
    pageZoom = 'native page scale 1.5; no dismissal';
  }
  const trustedInput = await page.evaluate(() => window.__touchTrust);
  assert.ok(trustedInput.moves > 0 && trustedInput.untrusted === 0, 'Drag tests must produce trusted browser touch movement');
  report.checks.push({mode: 'drag-dismiss', viewport, reducedMotion, input: touch.kind, trustedInput,
    followsFinger: true, shortSnapBack: true, horizontalNoDismiss: true,
    pointerCancel: engine === 'chromium' ? true : 'verified in isolated final context',
    reverseAfterThreshold: true,
    multiTouch: engine === 'chromium' ? true : 'unsupported by WebKit input driver',
    doubleTapAfterCancel: engine === 'chromium' ? true : 'unsupported by WebKit input driver',
    doubleTapAfterDrag: true, enlargedPanNoDismiss: true,
    enlargedNativePan: engine === 'chromium' ? 'verified when vertical overflow exists' : 'native compositor panning unverified in Windows WebKit automation',
    interruptedSnapBack: viewport.width === 390 && reducedMotion !== 'reduce',
    longDragReturn: true, longPressDragReturn: true, flickReturn: true, pageZoom});
  await context.close();
  delete report.current;
}

async function isolatedWebKitCancelCheck() {
  const viewport = {width: 390, height: 844};
  const context = await browser.newContext({viewport, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, reducedMotion: 'no-preference'});
  const page = await loadDocument(context);
  const touch = await touchDriver(context, page);
  report.current = {mode: 'isolated-webkit-cancel', viewport};
  const trigger = page.locator('a[data-zoom]').first();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.evaluate(link => {
    window.__openingPosition = null;
    const record = () => {
      if (window.__openingPosition === null && !document.getElementById('photo-viewer').open) window.__openingPosition = scrollY;
    };
    link.addEventListener('pointerup', record, {capture: true, once: true});
    link.addEventListener('click', record, {capture: true, once: true});
  });
  const id = await trigger.getAttribute('id');
  await trigger.tap();
  await page.waitForFunction(() => document.getElementById('photo-viewer').open);
  const position = await page.evaluate(() => window.__openingPosition);
  assert.equal(typeof position, 'number', 'Record activation before pointerup opens the viewer');
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    window.__cancelObserved = null;
    document.addEventListener('pointercancel', event => {
      window.__cancelObserved = {trusted: event.isTrusted, pointerType: event.pointerType};
    }, true);
  });
  const point = await centerOfVisibleImage(page);
  const before = await page.locator('#viewer-image').boundingBox();
  await touch.down(point);
  for (let step = 1; step <= 6; step++) {
    await touch.move({x: point.x, y: point.y + step * 10});
    await page.waitForTimeout(25);
  }
  const during = await page.locator('#viewer-image').boundingBox();
  assert.ok(during.y - before.y > 30, 'Cancel fixture must start a visible drag');
  await touch.cancel();
  await page.waitForTimeout(700);
  assert.equal(await isOpen(page), true, 'WebKit pointer cancellation must keep the viewer open');
  const after = await page.locator('#viewer-image').boundingBox();
  assert.ok(Math.abs(after.y - before.y) < 2, 'WebKit pointer cancellation must return the image to fit');
  assert.deepEqual(await page.evaluate(() => window.__cancelObserved), {trusted: true, pointerType: 'touch'});
  await page.keyboard.press('Escape');
  await assertReturned(page, position, id);
  report.checks.push({mode: 'isolated-webkit-cancel', viewport, input: touch.kind,
    trustedPointerCancel: true, staysOpen: true, snapBack: true, escapeExactReturn: true,
    subsequentClicks: 'unverified because private driver suppresses them after touchCancel'});
  await context.close();
  delete report.current;
}

async function touchCheck(viewport) {
  const context = await browser.newContext({viewport, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, reducedMotion: 'reduce'});
  const page = await loadDocument(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const triggers = page.locator('a[data-zoom]');
  const total = await triggers.count();
  assert.ok(total > 0, 'A meaningful image must exercise the template viewer');
  const indices = [...new Set([0, total - 1])];
  for (const index of indices) {
    const trigger = triggers.nth(index);
    await trigger.scrollIntoViewIfNeeded();
    await tick(page);
    const id = await trigger.getAttribute('id');
    const startY = await page.evaluate(() => scrollY);
    const box = await trigger.locator('img').boundingBox();
    const point = {x: box.x + box.width / 2,
      y: Math.max(5, Math.min(viewport.height - 5, box.y + box.height / 2))};
    const screenshotPrefix = path.join(path.dirname(reportFile), `${engine}-${viewport.width}-${index}`);
    if (viewport.width === 390 && index === 0) {
      fs.mkdirSync(path.dirname(reportFile), {recursive: true});
      await page.screenshot({path: screenshotPrefix + '-inline.png'});
    }
    await page.evaluate(() => {
      const dialog = document.getElementById('photo-viewer');
      window.__firstOpenMeasurement = null;
      let touches = 0;
      const down = event => {if (event.pointerType === 'touch') touches++;};
      document.addEventListener('pointerdown', down, true);
      const observer = new MutationObserver(() => {
        if (!dialog.open || window.__firstOpenMeasurement) return;
        window.__firstOpenMeasurement = {width: document.getElementById('viewer-image').getBoundingClientRect().width, touches};
        observer.disconnect();
        document.removeEventListener('pointerdown', down, true);
      });
      observer.observe(dialog, {attributes: true, attributeFilter: ['open']});
    });
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForTimeout(70);
    await page.touchscreen.tap(point.x, point.y);
    await tick(page);
    const firstOpen = await page.evaluate(() => window.__firstOpenMeasurement);
    assert.equal(firstOpen?.touches, 1, 'First touch must open the viewer before the second touch');
    const fitted = firstOpen.width;
    assert.equal(await isOpen(page), true, 'Second touch after opening must not dismiss the viewer');
    assert.ok(await imageWidth(page) > fitted * 1.2, 'Double tap starting on the inline image must visibly enlarge it');
    await page.waitForTimeout(360);
    await doubleTap(page, await centerOfVisibleImage(page));
    assert.equal(await isOpen(page), true);
    assert.ok(Math.abs(await imageWidth(page) - fitted) < 2, 'Double tap again must restore fit');
    if (viewport.width === 390 && index === 0) await page.screenshot({path: screenshotPrefix + '-viewer.png'});
    await page.waitForTimeout(360);
    const fittedPoint = await centerOfVisibleImage(page);
    await page.touchscreen.tap(fittedPoint.x, fittedPoint.y);
    await tick(page);
    assert.ok(Math.abs(await imageWidth(page) - fitted) < 2, 'A single touch inside the viewer must preserve scale');
    await page.waitForTimeout(360);
    await doubleTap(page, fittedPoint);
    assert.ok(await imageWidth(page) > fitted * 1.2, 'Double tap in the open viewer must enlarge');
    const closeBox = await page.locator('#viewer-close').boundingBox();
    assert.ok(closeBox.x >= 0 && closeBox.y >= 0 && closeBox.width >= 44 && closeBox.height >= 44);
    assert.ok(closeBox.y + closeBox.height <= viewport.height, 'Close must remain visible after zoom');
    await page.locator('#viewer-native').click();
    assert.equal(await page.locator('#viewer-image').evaluate(img => Math.round(img.getBoundingClientRect().width)),
      await page.locator('#viewer-image').evaluate(img => img.naturalWidth), '100% must mean native width');
    const touchAction = await page.locator('.viewer-stage').evaluate(e => getComputedStyle(e).touchAction);

    const localPinch = touchAction === 'none' && await page.locator('.viewer-stage').getAttribute('data-multitouch') === 'image-pinch';
    assert.ok(localPinch || touchAction.includes('pinch-zoom') || ['auto', 'manipulation'].includes(touchAction), 'Preserve browser zoom or provide image-local pinch');
    if (localPinch && engine === 'chromium') {
      await page.locator('#viewer-fit').click();
      const at = await centerOfVisibleImage(page), initial = await imageWidth(page);
      const cdp = await context.newCDPSession(page);
      const send = (type, d) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{id: 71, x: at.x-d, y: at.y, radiusX: 4, radiusY: 4, force: 1}, {id: 72, x: at.x+d, y: at.y, radiusX: 4, radiusY: 4, force: 1}]});
      await send('touchStart', 25);
      for (const d of [30,35,40,45,50]) {await send('touchMove',d); await page.waitForTimeout(25);}
      await send('touchEnd'); await tick(page);
      assert.ok(await imageWidth(page) > initial*1.5, 'Native two-contact spread must enlarge the image');
      assert.ok((await page.evaluate(()=>visualViewport.scale)) <= 1.02, 'Image pinch must not enlarge the whole page');
      const enlarged = await imageWidth(page);
      await send('touchStart', 50);
      for (const d of [45,40,35,30,25]) {await send('touchMove',d); await page.waitForTimeout(25);}
      await send('touchEnd'); await tick(page);
      assert.ok(await imageWidth(page) < enlarged*.8, 'Native two-contact pinch must reduce the image');
      assert.ok(await isOpen(page), 'Multitouch must not dismiss the image');
      await cdp.detach();
      report.checks.push({mode:'image-local-pinch',viewport,index,spread:true,pinch:true,pageScalePreserved:true});
    }

    await closeAndReturn(page, startY, id);
    report.checks.push({mode: 'touch', viewport, index, inlineDoubleTap: true, viewerDoubleTap: true,
      singleTapStable: true, closeReturn: true, nativeWidth: true});
  }
  assert.deepEqual(errors, []);
  await context.close();
}

async function mouseAndKeyboardCheck() {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce'});
  const page = await loadDocument(context);
  const trigger = page.locator('a[data-zoom]').first();
  await trigger.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  const id = await trigger.getAttribute('id');
  await trigger.click();
  const fitted = await imageWidth(page);
  const point = await centerOfVisibleImage(page);
  await page.mouse.click(point.x, point.y);
  assert.ok(await imageWidth(page) > fitted * 1.2);
  await page.locator('#viewer-fit').click();
  await page.locator('#viewer-image').focus();
  await page.keyboard.press('Enter');
  assert.ok(await imageWidth(page) > fitted * 1.2);
  await page.keyboard.press('Space');
  assert.ok(Math.abs(await imageWidth(page) - fitted) < 2);
  await page.locator('#viewer-close').focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#photo-viewer').evaluate(dialog => dialog.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(expected => !document.getElementById('photo-viewer').open
    && document.activeElement.id === expected.id && Math.abs(scrollY - expected.position) < 2, {id, position});
  report.checks.push({mode: 'mouse-keyboard', clickZoom: true, keyboardZoom: true, focusTrap: true, escapeReturn: true});
  await context.close();
}

async function noJavascriptCheck() {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, javaScriptEnabled: false});
  const page = await loadDocument(context);
  const trigger = page.locator('a[data-zoom]').first();
  await trigger.scrollIntoViewIfNeeded();
  const id = await trigger.getAttribute('id');
  const href = await trigger.getAttribute('href');
  await trigger.click();
  assert.equal(new URL(page.url()).hash, href);
  const figure = page.locator(href);
  const image = await figure.locator('img').boundingBox();
  const close = await figure.locator('.fallback-close').boundingBox();
  assert.ok(image.width > 0 && image.height > 0);
  assert.ok(close.y >= 0 && close.y + close.height <= 844);
  await figure.locator('img').click();
  assert.equal(new URL(page.url()).hash, href, 'Clicking a full image must not close the no-JS view');
  await figure.locator('.fallback-close').click();
  assert.equal(new URL(page.url()).hash, '#' + id);
  report.checks.push({mode: 'no-javascript', offline: engine !== 'webkit', otherRequestsBlocked: true,
    open: true, imageDoesNotClose: true, exactReturnAnchor: true});
  await context.close();
}

(async () => {
  const pw = playwright();
  assert.ok(['chromium', 'webkit'].includes(engine));
  const launch = {headless: true};
  if (engine === 'chromium') {
    const candidates = [process.env.CHROME_EXECUTABLE,
      'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
    const executablePath = candidates.find(candidate => candidate && fs.existsSync(candidate));
    if (executablePath) launch.executablePath = executablePath;
  }
  browser = await pw[engine].launch(launch);
  if (!process.env.VIEWER_DRAG_ONLY) {
    for (const viewport of [{width: 320, height: 720}, {width: 390, height: 844}, {width: 812, height: 375}]) {
      await touchCheck(viewport);
    }
    await mouseAndKeyboardCheck();
    await noJavascriptCheck();
  } else {
    report.selection = 'drag-only';
  }
  for (const viewport of [{width: 320, height: 720}, {width: 390, height: 844}, {width: 812, height: 375}]
    .filter(viewport => !process.env.VIEWER_VIEWPORT || viewport.width === Number(process.env.VIEWER_VIEWPORT))) {
    await dragDismissCheck(viewport);
  }
  if (!process.env.VIEWER_VIEWPORT) await dragDismissCheck({width: 390, height: 844}, 'reduce');
  else report.viewportSelection = Number(process.env.VIEWER_VIEWPORT);
  if (engine === 'webkit') await isolatedWebKitCancelCheck();
  assert.deepEqual(report.browserErrors, []);
  report.passed = true;
})().catch(error => {
  report.passed = false;
  report.error = error.message;
  report.stack = error.stack;
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  fs.mkdirSync(path.dirname(reportFile), {recursive: true});
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({passed: report.passed, checks: report.checks.length, report: reportFile, error: report.error}));
});
