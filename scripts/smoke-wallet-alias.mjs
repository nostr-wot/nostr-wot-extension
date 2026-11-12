import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { focusAddressSection } from '../src/screens/Wallet/focusAddressSection.ts';

// Freeze the panel partway through its entrance so the failure is deterministic.
const browser = await chromium.launch({channel:'chromium'});
try {
  const page = await browser.newPage({viewport:{width:380,height:600}});
  await page.setContent('<style>*{box-sizing:border-box}body{margin:0}.shell{position:relative;width:380px;height:600px;overflow:hidden}.panel{position:absolute;inset:0;transform:translateX(65px)}.body{height:530px;overflow:auto}.spacer{height:700px}</style><main class="shell"><article class="panel"><header>Wallet settings</header><div class="body"><div class="spacer"></div><section><input placeholder="Username"><button>Claim</button></section></div></article></main>');
  const shell = page.locator('.shell');
  await page.locator('section').evaluate(el => el.scrollIntoView({block:'start'}));
  assert.ok(await shell.evaluate(el => el.scrollLeft > 0), 'old navigation shifts the shell');
  await shell.evaluate(el => {el.scrollLeft = 0; el.querySelector('.body').scrollTop = 0;});
  await page.evaluate('(' + focusAddressSection.toString() + ')(document.querySelector(".body"), document.querySelector("section"))');
  await page.locator('.panel').evaluate(el => {el.style.transform='none';});
  assert.equal(await shell.evaluate(el => el.scrollLeft), 0);
  assert.ok(await page.locator('.body').evaluate(el => el.scrollTop > 0));
  assert.equal(await page.locator('input').evaluate(el => el === el.ownerDocument.activeElement), true);
  assert.equal((await page.locator('header').boundingBox()).x, 0);
  console.log('Wallet alias focus: old shell shift reproduced; fixed panel stays aligned at 380×600.');
} finally { await browser.close(); }
