/* =============================================================================
 * app.js — 介面層（只負責讀取輸入、顯示結果；所有計算交給 loan-core.js）
 * ========================================================================== */
(function () {
  'use strict';

  var C = window.LoanCore;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    form: $('loanForm'),
    amount: $('amount'),
    term: $('term'),
    termUnit: $('termUnit'),
    rate: $('rate'),
    rateUnit: $('rateUnit'),
    method: $('method'),
    freq: $('freq'),
    result: $('result'),
    tbody: $('tbody'),
    showAll: $('showAll')
  };

  var FIELDS = ['amount', 'term', 'rate', 'method', 'freq'];

  /* ---------------------------------------------------------------------
   * 輸入小工具
   * ------------------------------------------------------------------ */

  /** 換算結果去掉多餘的小數位（例如 0.2083333333 → 0.208333、2.49999996 → 2.5） */
  function trimNumber(n, digits) {
    if (!isFinite(n)) return '';
    var d = digits === undefined ? 6 : digits;
    var out = Number(n.toFixed(d));
    // 若捨入誤差極小，改用位數更少、更好看的寫法（換算來回才不會出現 2.499996 這種數字）
    for (var i = d - 1; i >= 0; i--) {
      var v = Number(n.toFixed(i));
      if (Math.abs(n - v) < 1e-7 * Math.max(1, Math.abs(n))) { out = v; break; }
    }
    return String(out);
  }

  /** 取欄位目前的值；若使用者沒有手動改動，就沿用上次換算前的精確值 */
  function currentValue(input, digits) {
    var v = C.toNumber(input.value);
    if (isNaN(v)) return NaN;
    var exact = input.dataset.exact;
    if (exact && trimNumber(Number(exact), digits) === String(v).replace(/,/g, '')) {
      return Number(exact);
    }
    return v;
  }

  /** 寫回換算結果，同時記住未取整的精確值 */
  function setConverted(input, value, digits) {
    input.dataset.exact = String(value);
    input.value = trimNumber(value, digits);
  }

  /** 輸入時自動加上千分位，方便閱讀（只處理金額欄位） */
  function formatThousands(input) {
    var raw = input.value.replace(/[,\s]/g, '');
    if (raw === '' || isNaN(C.toNumber(raw))) return;
    var parts = raw.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    input.value = parts.join('.');
  }

  function clearErrors() {
    FIELDS.forEach(function (f) {
      var box = $('err-' + f);
      if (box) box.textContent = '';
      var input = el[f];
      if (input && input.classList) input.classList.remove('invalid');
    });
  }

  function showErrors(errors) {
    clearErrors();
    var firstBad = null;
    Object.keys(errors).forEach(function (f) {
      var box = $('err-' + f);
      if (box) box.textContent = errors[f];
      var input = el[f];
      if (input && input.classList) input.classList.add('invalid');
      if (!firstBad && input && input.focus) firstBad = input;
    });
    if (firstBad) firstBad.focus();
  }

  /* ---------------------------------------------------------------------
   * 單位自動換算
   * ------------------------------------------------------------------ */
  el.termUnit.addEventListener('change', function () {
    var v = currentValue(el.term, 4);
    if (isNaN(v) || v <= 0) return;
    // 切換成「年」：月 ÷12 ；切換成「月」：年 ×12
    setConverted(el.term, el.termUnit.value === 'year' ? v / 12 : v * 12, 4);
  });

  el.rateUnit.addEventListener('change', function () {
    var v = currentValue(el.rate, 8);
    if (isNaN(v) || v < 0) return;
    // 切換成「月利率」：年利率 ÷12 ；切換成「年利率」：月利率 ×12
    setConverted(el.rate, el.rateUnit.value === 'monthly' ? v / 12 : v * 12, 8);
  });

  el.amount.addEventListener('blur', function () { formatThousands(el.amount); });
  [el.amount, el.term, el.rate].forEach(function (input) {
    input.addEventListener('input', function () {
      var box = $('err-' + input.id);
      if (box) box.textContent = '';
      input.classList.remove('invalid');
      delete input.dataset.exact; // 使用者手動改過，就丟掉上次換算的精確值
    });
  });

  /* ---------------------------------------------------------------------
   * 送出計算
   * ------------------------------------------------------------------ */
  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    run();
  });

  function run() {
    var raw = {
      amount: el.amount.value,
      term: el.term.value,
      termUnit: el.termUnit.value,
      rate: el.rate.value,
      rateUnit: el.rateUnit.value,
      method: el.method.value,
      periodsPerYear: Number(el.freq.value)
    };

    var checked = C.validate(raw);
    if (!checked.ok) {
      showErrors(checked.errors);
      el.result.classList.add('hidden');
      return;
    }
    clearErrors();

    var out;
    try {
      out = C.calculate(checked.data);
    } catch (err) {
      // 例如「每期還款額不足以支付利息」這類可預期的商業邏輯錯誤
      showErrors({ rate: err.message });
      el.result.classList.add('hidden');
      return;
    }

    renderResult(out, checked.data);
  }

  /* ---------------------------------------------------------------------
   * 顯示結果
   * ------------------------------------------------------------------ */
  function renderResult(out, input) {
    var s = out.summary;
    var rows = out.rows;
    var money = C.formatCents;

    el.result.classList.remove('hidden');

    // --- 摘要列 ---
    var yearText = input.months % 12 === 0 ? (input.months / 12) + ' 年' : (input.months / 12).toFixed(1) + ' 年';
    var freqLabel = C.FREQ_OPTIONS.filter(function (o) { return o.value === s.periodsPerYear; })[0].label;
    $('sumMeta').textContent =
      s.methodLabel + ' · ' + s.periods + ' 期（' + yearText + '，' + input.months + ' 個月） · ' +
      freqLabel + ' · 年利率 ' + C.formatPercent(input.annualRatePct, 4) +
      '（每期 ' + C.formatPercent(s.periodRatePct, 4) + '）';

    $('sumFirst').textContent = money(s.firstPaymentCents);
    $('sumLast').textContent = money(s.lastPaymentCents);
    $('sumTotal').textContent = money(s.totalPaymentCents);
    $('sumPrincipal').textContent = money(s.totalPrincipalCents);
    $('sumInterest').textContent = money(s.totalInterestCents);
    $('sumRatio').textContent = s.interestRatioPct.toFixed(2) + '%';
    $('sumFirstUnit').textContent = '元 / 期';
    $('sumLastUnit').textContent = '元 / 期';
    $('sumRatioSub').textContent = '還款總額約為本金的 ' + s.paymentMultiple.toFixed(2) + ' 倍';

    // --- 本金 / 利息佔比條 ---
    var total = s.totalPaymentCents || 1;
    var pPct = (s.totalPrincipalCents / total) * 100;
    var iPct = 100 - pPct;
    $('barPrincipal').style.width = pPct.toFixed(3) + '%';
    $('barInterest').style.width = iPct.toFixed(3) + '%';
    $('barPrincipal').firstChild.textContent = iPct > 12 ? '本金 ' + pPct.toFixed(1) + '%' : '';
    $('barInterest').firstChild.textContent = iPct > 12 ? '利息 ' + iPct.toFixed(1) + '%' : '';

    // --- 圖表 ---
    renderChart(rows, s);

    // --- 明細表 ---
    var showAll = el.showAll.checked;
    var label = document.querySelector('.chk');
    if (label && label.lastChild && label.lastChild.nodeType === 3) {
      label.lastChild.textContent = ' 一次展開全部 ' + s.periods + ' 期';
    }

    renderTable(rows, showAll, s);

    $('footPayment').textContent = money(s.totalPaymentCents);
    $('footPrincipal').textContent = money(s.totalPrincipalCents);
    $('footInterest').textContent = money(s.totalInterestCents);
    $('footCumInterest').textContent = money(s.totalInterestCents);
  }

  function renderTable(rows, showAll, s) {
    var PREVIEW = 24;
    var list = (showAll || rows.length <= PREVIEW) ? rows : rows.slice(0, PREVIEW);
    var html = list.map(function (r) {
      return '<tr>' +
        '<td class="num">' + r.period + '</td>' +
        '<td class="num">' + C.formatCents(r.paymentCents) + '</td>' +
        '<td class="num">' + C.formatCents(r.principalCents) + '</td>' +
        '<td class="num p-int">' + C.formatCents(r.interestCents) + '</td>' +
        '<td class="num">' + C.formatCents(r.cumInterestCents) + '</td>' +
        '<td class="num">' + C.formatCents(r.balanceCents) + '</td>' +
        '</tr>';
    }).join('');

    if (list.length < rows.length) {
      html += '<tr><td colspan="6" class="more">… 僅顯示前 ' + PREVIEW + ' 期，勾選「一次展開全部 ' +
        s.periods + ' 期」可查看完整 ' + rows.length + ' 期明細</td></tr>';
    }
    el.tbody.innerHTML = html;
  }

  function renderChart(rows, s) {
    var n = rows.length;
    var W = 1000, H = 220, TOP = 12, BASE = 200, PLOT = BASE - TOP;
    var maxPay = 0;
    rows.forEach(function (r) { if (r.paymentCents > maxPay) maxPay = r.paymentCents; });
    if (maxPay <= 0) maxPay = 1;
    var principalCents = s.totalPrincipalCents || 1;

    var bw = W / n;
    var gap = n <= 60 ? Math.min(bw * 0.28, 3) : 0;
    var bars = [];
    var pts = [];

    for (var i = 0; i < n; i++) {
      var r = rows[i];
      var x = i * bw;
      var w = Math.max(bw - gap, 0.6);
      var hI = (r.interestCents / maxPay) * PLOT;   // 利息高度
      var hP = (r.principalCents / maxPay) * PLOT;  // 本金高度
      bars.push('<rect x="' + x.toFixed(2) + '" y="' + (BASE - hI).toFixed(2) +
        '" width="' + w.toFixed(2) + '" height="' + Math.max(hI, 0).toFixed(2) + '" fill="#ea580c"/>');
      bars.push('<rect x="' + x.toFixed(2) + '" y="' + (BASE - hI - hP).toFixed(2) +
        '" width="' + w.toFixed(2) + '" height="' + Math.max(hP, 0).toFixed(2) + '" fill="#2563eb"/>');
      pts.push((x + bw / 2).toFixed(2) + ',' + (BASE - (r.balanceCents / principalCents) * PLOT).toFixed(2));
    }

    $('chart').innerHTML =
      '<line x1="0" y1="' + BASE + '" x2="' + W + '" y2="' + BASE + '" stroke="#dbe2ec" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
      bars.join('') +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#94a3b8" stroke-width="1.6" ' +
      'stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
  }

  /* ---------------------------------------------------------------------
   * 其他操作
   * ------------------------------------------------------------------ */
  el.showAll.addEventListener('change', function () { run(); });

  $('btnCsv').addEventListener('click', function () {
    var raw = {
      amount: el.amount.value, term: el.term.value, termUnit: el.termUnit.value,
      rate: el.rate.value, rateUnit: el.rateUnit.value,
      method: el.method.value, periodsPerYear: Number(el.freq.value)
    };
    var checked = C.validate(raw);
    if (!checked.ok) { showErrors(checked.errors); return; }
    var out = C.calculate(checked.data);

    var lines = ['期數,當期還款額,當期本金,當期利息,累計已還利息,累計已還本金,剩餘本金'];
    out.rows.forEach(function (r) {
      lines.push([
        r.period,
        C.centsToNumber(r.paymentCents).toFixed(2),
        C.centsToNumber(r.principalCents).toFixed(2),
        C.centsToNumber(r.interestCents).toFixed(2),
        C.centsToNumber(r.cumInterestCents).toFixed(2),
        C.centsToNumber(r.cumPrincipalCents).toFixed(2),
        C.centsToNumber(r.balanceCents).toFixed(2)
      ].join(','));
    });
    var s = out.summary;
    lines.push('');
    lines.push('貸款金額,' + C.centsToNumber(s.totalPrincipalCents).toFixed(2));
    lines.push('利息總額,' + C.centsToNumber(s.totalInterestCents).toFixed(2));
    lines.push('還款總額,' + C.centsToNumber(s.totalPaymentCents).toFixed(2));
    lines.push('利息佔貸款金額,' + s.interestRatioPct.toFixed(2) + '%');

    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'loan-schedule.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  $('btnReset').addEventListener('click', function () {
    el.form.reset();
    clearErrors();
    el.result.classList.add('hidden');
    el.amount.value = '';
    el.term.value = '';
    el.rate.value = '';
  });

  $('btnSample').addEventListener('click', function () {
    el.amount.value = '3,000,000';
    el.termUnit.value = 'year';
    el.term.value = '20';
    el.rateUnit.value = 'annual';
    el.rate.value = '2.5';
    el.method.value = 'equalTotal';
    el.freq.value = '12';
    clearErrors();
    run();
  });
})();
