/* 介面冒煙測試：node smoke-ui.js（需要 jsdom） */
const path = require('path');
const { JSDOM } = require(process.env.NODE_PATH
  ? path.join(process.env.NODE_PATH, 'jsdom')
  : 'jsdom');

(async () => {
  const dom = await JSDOM.fromFile(path.join(__dirname, 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });
  await new Promise(r => dom.window.addEventListener('load', r));

  const { document } = dom.window;
  const $ = id => document.getElementById(id);
  let pass = 0, fail = 0;
  const ok = (n, c, extra) => c ? (pass++, console.log('  ✓ ' + n))
    : (fail++, console.log('  ✗ ' + n + (extra ? '  → ' + extra : '')));

  console.log('\n[UI-1] 載入範例後應直接算出結果');
  $('btnSample').click();
  ok('結果區顯示', !$('result').classList.contains('hidden'));
  ok('首期還款有值', /\d/.test($('sumFirst').textContent), $('sumFirst').textContent);
  ok('利息總額有值', /\d/.test($('sumInterest').textContent), $('sumInterest').textContent);
  console.log('    首期 =', $('sumFirst').textContent,
    '| 末期 =', $('sumLast').textContent,
    '| 利息總額 =', $('sumInterest').textContent,
    '| 佔比 =', $('sumRatio').textContent);
  console.log('    摘要：', $('sumMeta').textContent);
  ok('利息佔比是百分比', /%$/.test($('sumRatio').textContent), $('sumRatio').textContent);
  ok('金額含千分位與兩位小數', /^[\d,]+\.\d{2}$/.test($('sumTotal').textContent), $('sumTotal').textContent);

  console.log('\n[UI-2] 明細表');
  const trs = $('tbody').querySelectorAll('tr');
  ok('產生表格列', trs.length > 0, String(trs.length));
  ok('預設僅顯示前 24 期 + 提示列', trs.length === 25 && $('tbody').textContent.includes('僅顯示前 24 期'));
  ok('合計列 = 還款總額', $('footPayment').textContent === $('sumTotal').textContent);
  ok('第 1 期剩餘本金 < 貸款金額',
    parseFloat(trs[0].children[5].textContent.replace(/,/g, '')) < 3000000);
  $('showAll').checked = true;
  $('showAll').dispatchEvent(new dom.window.Event('change'));
  ok('勾選展開後為 240 期', $('tbody').querySelectorAll('tr').length === 240,
    String($('tbody').querySelectorAll('tr').length));
  ok('末期剩餘本金為 0.00',
    $('tbody').querySelectorAll('tr')[239].children[5].textContent === '0.00');

  console.log('\n[UI-3] 圖表');
  ok('圖表有長條', $('chart').querySelectorAll('rect').length === 480,
    String($('chart').querySelectorAll('rect').length));
  ok('圖表有剩餘本金折線', !!$('chart').querySelector('polyline'));

  console.log('\n[UI-4] 輸入驗證與錯誤提示');
  $('amount').value = '';
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('空白金額 → 顯示錯誤', $('err-amount').textContent.length > 0, $('err-amount').textContent);
  ok('空白金額 → 結果區隱藏', $('result').classList.contains('hidden'));
  console.log('    訊息：', $('err-amount').textContent);

  $('amount').value = 'abc';
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('非數字 → 顯示錯誤', /數字/.test($('err-amount').textContent), $('err-amount').textContent);

  $('amount').value = '-5000';
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('負數 → 顯示錯誤', /大於 0/.test($('err-amount').textContent), $('err-amount').textContent);

  $('amount').value = '1000000';
  $('term').value = '0';
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('期限 0 → 顯示錯誤', /大於 0/.test($('err-term').textContent), $('err-term').textContent);

  $('term').value = '20';
  $('rate').value = '-1';
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('負利率 → 顯示錯誤', /負數/.test($('err-rate').textContent), $('err-rate').textContent);

  $('rate').value = '2.5';
  $('freq').value = '4';
  $('termUnit').value = 'month';
  $('term').value = '20'; // 20 個月不是季繳的整數倍
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('季繳 + 20 個月 → 顯示錯誤', /整數倍/.test($('err-term').textContent), $('err-term').textContent);

  console.log('\n[UI-5] 單位換算');
  $('freq').value = '12';
  $('term').value = '240';
  $('termUnit').value = 'year';
  $('termUnit').dispatchEvent(new dom.window.Event('change'));
  ok('240 月 → 20 年', $('term').value === '20', $('term').value);
  $('termUnit').value = 'month';
  $('termUnit').dispatchEvent(new dom.window.Event('change'));
  ok('20 年 → 240 月', $('term').value === '240', $('term').value);

  $('rateUnit').value = 'monthly';
  $('rateUnit').dispatchEvent(new dom.window.Event('change'));
  ok('年利率 2.5% → 月利率 0.2083333%', $('rate').value === '0.2083333', $('rate').value);
  $('rateUnit').value = 'annual';
  $('rateUnit').dispatchEvent(new dom.window.Event('change'));
  ok('月利率 → 回年利率 2.5%', $('rate').value === '2.5', $('rate').value);

  // 非 12 倍數的月數來回換算（250 月 → 20.8333 年 → 250 月）
  $('term').value = '250';
  $('term').dispatchEvent(new dom.window.Event('input'));
  $('termUnit').value = 'year';
  $('termUnit').dispatchEvent(new dom.window.Event('change'));
  ok('250 月 → 20.8333 年', $('term').value === '20.8333', $('term').value);
  $('termUnit').value = 'month';
  $('termUnit').dispatchEvent(new dom.window.Event('change'));
  ok('20.8333 年 → 回到 250 月', $('term').value === '250', $('term').value);

  console.log('\n[UI-6] 切換等額本金');
  $('term').value = '240';
  $('amount').value = '3,000,000';
  $('method').value = 'equalPrincipal';
  $('loanForm').dispatchEvent(new dom.window.Event('submit'));
  ok('等額本金有結果', !$('result').classList.contains('hidden'));
  ok('摘要標示等額本金', $('sumMeta').textContent.includes('等額本金'), $('sumMeta').textContent);
  const first = parseFloat($('sumFirst').textContent.replace(/,/g, ''));
  const last = parseFloat($('sumLast').textContent.replace(/,/g, ''));
  ok('等額本金首期 > 末期', first > last, first + ' vs ' + last);

  console.log('\n[UI-7] 重設');
  $('btnReset').click();
  ok('重設後結果隱藏', $('result').classList.contains('hidden'));
  ok('重設後輸入清空', $('amount').value === '' && $('term').value === '' && $('rate').value === '');

  console.log('\n———— 介面冒煙：' + pass + ' 通過 / ' + fail + ' 失敗 ————');
  process.exit(fail ? 1 : 0);
})();
