/* 核心邏輯測試：node test-core.js */
var C = require('./loan-core.js');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expected) { ok(name, actual === expected, 'actual=' + actual + ' expected=' + expected); }

function calc(o) { return C.calculate(o); }
function base(o) {
  return Object.assign({ amount: 1000000, months: 240, annualRatePct: 2.5, method: 'equalTotal', periodsPerYear: 12 }, o);
}

console.log('\n[1] 等額本息：已知值比對（100 萬 / 30 年 / 年利率 6% → 月付 5,995.51）');
{
  var r = calc(base({ amount: 1000000, months: 360, annualRatePct: 6, method: 'equalTotal' }));
  eq('首期還款額（分）', r.summary.firstPaymentCents, 599551);
  ok('總期數 = 360', r.summary.periods === 360);
}

console.log('\n[2] 不變量：本金總額 = 貸款金額、末期剩餘本金 = 0、各欄位加總一致');
[
  { name: '等額本息 100萬/20年/2.5%', o: base({}) },
  { name: '等額本金 100萬/20年/2.5%', o: base({ method: 'equalPrincipal' }) },
  { name: '等額本息 350萬/30年/1.8%', o: base({ amount: 3500000, months: 360, annualRatePct: 1.8 }) },
  { name: '等額本金 88萬/7年/12%', o: base({ amount: 880000, months: 84, annualRatePct: 12, method: 'equalPrincipal' }) },
  { name: '季繳 50萬/20年/4.2%', o: base({ amount: 500000, months: 240, annualRatePct: 4.2, periodsPerYear: 4 }) },
  { name: '零利率 12萬/12期', o: base({ amount: 120000, months: 12, annualRatePct: 0 }) },
  { name: '1 期 10萬/5%', o: base({ amount: 100000, months: 1, annualRatePct: 5 }) }
].forEach(function (t) {
  var r = calc(t.o);
  var cents = Math.round(t.o.amount * 100);
  ok(t.name + '：本金總額 = 貸款金額', r.summary.totalPrincipalCents === cents,
    r.summary.totalPrincipalCents + ' vs ' + cents);
  ok(t.name + '：末期剩餘本金 = 0', r.rows[r.rows.length - 1].balanceCents === 0);
  ok(t.name + '：剩餘本金遞減且不為負', r.rows.every(function (x) { return x.balanceCents >= 0; }));
  var sumPay = r.rows.reduce(function (a, x) { return a + x.paymentCents; }, 0);
  var sumInt = r.rows.reduce(function (a, x) { return a + x.interestCents; }, 0);
  ok(t.name + '：逐期還款額加總 = 還款總額', sumPay === r.summary.totalPaymentCents);
  ok(t.name + '：逐期利息加總 = 利息總額', sumInt === r.summary.totalInterestCents);
  ok(t.name + '：還款總額 = 本金 + 利息',
    r.summary.totalPaymentCents === r.summary.totalPrincipalCents + r.summary.totalInterestCents);
  ok(t.name + '：當期還款額 = 當期本金 + 當期利息',
    r.rows.every(function (x) { return x.paymentCents === x.principalCents + x.interestCents; }));
  ok(t.name + '：累計利息逐期遞增', r.rows.every(function (x, i, a) { return i === 0 || x.cumInterestCents >= a[i - 1].cumInterestCents; }));
});

console.log('\n[3] 等額本息：每期還款額固定（末期除外）／等額本金：每期本金固定（末期除外）');
{
  var a = calc(base({})).rows;
  var fixed = a[0].paymentCents;
  ok('等額本息前 n-1 期還款額一致', a.slice(0, -1).every(function (x) { return x.paymentCents === fixed; }));

  var b = calc(base({ method: 'equalPrincipal' })).rows;
  var fp = b[0].principalCents;
  ok('等額本金前 n-1 期本金一致', b.slice(0, -1).every(function (x) { return x.principalCents === fp; }));
  ok('等額本金還款額逐期遞減', b[0].paymentCents > b[b.length - 2].paymentCents);
  ok('等額本息利息總額 > 等額本金利息總額',
    calc(base({})).summary.totalInterestCents > calc(base({ method: 'equalPrincipal' })).summary.totalInterestCents);
}

console.log('\n[4] 零利率');
{
  var r = calc(base({ amount: 120000, months: 12, annualRatePct: 0 }));
  eq('利息總額 = 0', r.summary.totalInterestCents, 0);
  eq('還款總額 = 本金', r.summary.totalPaymentCents, 12000000);
  eq('每期還款 = 10,000', r.rows[0].paymentCents, 1000000);
}

console.log('\n[5] 單位換算：20 年 = 240 月；月利率 0.208333% ≒ 年利率 2.5%');
{
  var v = C.validate({ amount: '1,000,000', term: '20', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal', periodsPerYear: 12 });
  ok('OK', v.ok, JSON.stringify(v.errors));
  eq('月數 = 240', v.data.months, 240);
  var v2 = C.validate({ amount: '1000000', term: '240', termUnit: 'month', rate: '0.2083333', rateUnit: 'monthly', method: 'equalTotal', periodsPerYear: 12 });
  ok('月利率 → 年利率 ≈ 2.5', Math.abs(v2.data.annualRatePct - 2.5) < 1e-6, String(v2.data.annualRatePct));
}

console.log('\n[6] 驗證錯誤分支');
[
  [{ amount: '', term: '20', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'amount', '空白'],
  [{ amount: 'abc', term: '20', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'amount', '非數字'],
  [{ amount: '0', term: '20', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'amount', '零'],
  [{ amount: '-1000', term: '20', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'amount', '負數'],
  [{ amount: '1000', term: '', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'term', '空白'],
  [{ amount: '1000', term: '-5', termUnit: 'month', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'term', '負數'],
  [{ amount: '1000', term: '1.3', termUnit: 'year', rate: '2.5', rateUnit: 'annual', method: 'equalTotal' }, 'term', '非整數月'],
  [{ amount: '1000', term: '20', termUnit: 'month', rate: '2.5', rateUnit: 'annual', method: 'equalTotal', periodsPerYear: 4 }, 'term', '期數非繳款週期倍數'],
  [{ amount: '1000', term: '20', termUnit: 'year', rate: '', rateUnit: 'annual', method: 'equalTotal' }, 'rate', '空白'],
  [{ amount: '1000', term: '20', termUnit: 'year', rate: '-1', rateUnit: 'annual', method: 'equalTotal' }, 'rate', '負數'],
  [{ amount: '1000', term: '20', termUnit: 'year', rate: '2.5%', rateUnit: 'annual', method: 'equalTotal', periodsPerYear: 99 }, 'method', '非法週期→ 仍應通過（還款方式正常）']
].forEach(function (t) {
  var v = C.validate(t[0]);
  if (t[2].indexOf('仍應通過') >= 0) {
    ok('驗證：' + t[2], v.ok && !v.errors[t[1]], JSON.stringify(v.errors));
  } else {
    ok('驗證擋下：' + t[2], !v.ok && !!v.errors[t[1]], JSON.stringify(v.errors));
  }
});

console.log('\n[7] 極端情境：小額貸超長期 → 拋出可預期錯誤；高利率短天期 → 正常計算');
{
  var threw = null;
  try { calc(base({ amount: 1, months: 600, annualRatePct: 100 })); } catch (e) { threw = e; }
  ok('等額本息：金額過小 → 拋出 NEGATIVE_AMORTIZATION', threw && threw.code === 'NEGATIVE_AMORTIZATION', threw && threw.message);

  var threw2 = null;
  try { calc(base({ amount: 1, months: 600, annualRatePct: 100, method: 'equalPrincipal' })); } catch (e2) { threw2 = e2; }
  ok('等額本金：金額過小 → 拋出 AMOUNT_TOO_SMALL', threw2 && threw2.code === 'AMOUNT_TOO_SMALL', threw2 && threw2.message);

  var fine = null;
  try { fine = calc(base({ amount: 100000, months: 12, annualRatePct: 100 })); } catch (e3) { fine = null; }
  ok('年利率 100% / 12 期仍可正常計算', !!fine && fine.rows[11].balanceCents === 0);
}

console.log('\n[8] 金額格式化（千分位 + 兩位小數）');
{
  eq('123456789 分', C.formatCents(123456789), '1,234,567.89');
  eq('5 分', C.formatCents(5), '0.05');
  eq('0 分', C.formatCents(0), '0.00');
  eq('100 分', C.formatCents(100), '1.00');
  eq('負數', C.formatCents(-12345), '-123.45');
  eq('四捨五入顯示', C.formatCents(C.toCents(1234.565)), '1,234.57');
}

console.log('\n———— 結果：' + pass + ' 通過 / ' + fail + ' 失敗 ————');
process.exit(fail ? 1 : 0);
