/* =============================================================================
 * loan-core.js — 貸款計算核心（純邏輯，不依賴 DOM、不碰畫面）
 *
 * 設計重點：
 *  1. 金額一律以「分 (cent)」為單位的整數運算，只在輸入/輸出時換算「元」，
 *     因此不會有 0.1 + 0.2 !== 0.3 的浮點累計誤差。
 *  2. 每期利息 = 當期期初剩餘本金 × 每期利率，四捨五入到「分」。
 *  3. 末期本金 = 當期的剩餘本金（吸收前面所有尾差），保證最後一期剩餘本金恰為 0。
 *  4. 累計利息 / 累計本金由整數累加而來，不做浮點連加。
 *
 * 對外 API：LoanCore.validate() / LoanCore.calculate() / LoanCore.formatCents()
 * ========================================================================== */
(function (global) {
  'use strict';

  /** 輸入上限，避免不合理的數值拖垮瀏覽器 */
  var LIMITS = {
    maxAmount: 1e12,      // 貸款金額上限（元）
    maxMonths: 600,       // 期限上限（月）＝ 50 年
    maxAnnualRate: 100    // 年利率上限（%）
  };

  /** 繳款週期：每年繳幾期 → 每期相隔幾個月 */
  var FREQ_OPTIONS = [
    { value: 12, label: '每月繳款', monthsPerPeriod: 1 },
    { value: 4, label: '每季繳款', monthsPerPeriod: 3 },
    { value: 2, label: '每半年繳款', monthsPerPeriod: 6 },
    { value: 1, label: '每年繳款', monthsPerPeriod: 12 }
  ];

  var METHODS = {
    equalTotal: '等額本息',      // 每期還款總額固定
    equalPrincipal: '等額本金'   // 每期償還本金固定
  };

  /* ---------------------------------------------------------------------------
   * 工具：字串 → 數字
   * 允許使用者輸入千分位、空白、百分比符號，其餘一律視為非法。
   * ------------------------------------------------------------------------ */
  function toNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    if (typeof value !== 'string') return NaN;
    var s = value.replace(/[,\s_％%]/g, '').trim();
    if (s === '') return NaN;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN; // 只接受純數字
    return Number(s);
  }

  /** 四捨五入到「分」（Math.round 對 .5 採遠離零進位，符合一般四捨五入習慣） */
  function roundCents(x) {
    return Math.round(x);
  }

  /** 元 → 分（Math.round 會把 1234.56*100 = 123455.999… 這類誤差修回來） */
  function toCents(amount) {
    return roundCents(amount * 100);
  }

  /** 分 → 元（僅供顯示） */
  function centsToNumber(cents) {
    return cents / 100;
  }

  /** 分 → 含千分位、兩位小數的字串（字串處理，不經浮點，顯示永遠精準） */
  function formatCents(cents, opt) {
    opt = opt || {};
    var negative = cents < 0;
    var v = Math.abs(Math.round(cents));
    var integerPart = Math.floor(v / 100);
    var fracPart = v % 100;
    var text = String(integerPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
      '.' + String(fracPart).padStart(2, '0');
    if (negative) text = '-' + text;
    return (opt.prefix || '') + text + (opt.suffix || '');
  }

  /** 數字 → 百分比字串（四位小數以內，去掉多餘的 0） */
  function formatPercent(pct, digits) {
    var d = typeof digits === 'number' ? digits : 4;
    var s = pct.toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
    return s + '%';
  }

  /* ---------------------------------------------------------------------------
   * 驗證：回傳 { ok, errors:{欄位:訊息}, data:{正規化後的輸入} }
   * ------------------------------------------------------------------------ */
  function validate(raw) {
    raw = raw || {};
    var errors = {};
    var data = {};

    // --- 繳款週期（預設月繳）---
    var ppy = Number(raw.periodsPerYear);
    data.periodsPerYear = FREQ_OPTIONS.some(function (o) { return o.value === ppy; }) ? ppy : 12;
    var monthsPerPeriod = 12 / data.periodsPerYear; // 每期間隔月數

    // --- 還款方式 ---
    var method = String(raw.method || '');
    if (method !== 'equalTotal' && method !== 'equalPrincipal') {
      errors.method = '請選擇還款方式';
    } else {
      data.method = method;
    }

    // --- 貸款金額 ---
    var amountRaw = raw.amount == null ? '' : String(raw.amount);
    if (amountRaw.trim() === '') {
      errors.amount = '請輸入貸款金額';
    } else {
      var amount = toNumber(amountRaw);
      if (isNaN(amount)) {
        errors.amount = '貸款金額必須是數字，請勿輸入文字或符號';
      } else if (amount <= 0) {
        errors.amount = '貸款金額必須大於 0';
      } else if (amount > LIMITS.maxAmount) {
        errors.amount = '貸款金額過大（上限 ' + formatCents(toCents(LIMITS.maxAmount)) + ' 元）';
      } else {
        data.amount = amount;
      }
    }

    // --- 貸款期限（年 / 月 自動換算）---
    var termRaw = raw.term == null ? '' : String(raw.term);
    if (termRaw.trim() === '') {
      errors.term = '請輸入貸款期限';
    } else {
      var term = toNumber(termRaw);
      if (isNaN(term)) {
        errors.term = '貸款期限必須是數字';
      } else if (term <= 0) {
        errors.term = '貸款期限必須大於 0';
      } else {
        // 年 → 月：×12；月 → 月：原值
        var monthsExact = raw.termUnit === 'year' ? term * 12 : term;
        if (Math.abs(monthsExact - Math.round(monthsExact)) > 1e-9) {
          errors.term = '期限換算後必須是整數月數（例如 1.5 年可，1.3 年不可）';
        }
        if (!errors.term) {
          var months = Math.round(monthsExact);
          if (months < 1) {
            errors.term = '貸款期限至少要 1 個月';
          } else if (months > LIMITS.maxMonths) {
            errors.term = '貸款期限過長（上限 ' + LIMITS.maxMonths + ' 個月 / 50 年）';
          } else if (months % monthsPerPeriod !== 0) {
            errors.term = '期限需為繳款週期的整數倍（目前每 ' + monthsPerPeriod + ' 個月繳一次）';
          } else {
            data.months = months;
          }
        }
      }
    }

    // --- 利率（年利率 / 月利率 自動換算）---
    var rateRaw = raw.rate == null ? '' : String(raw.rate);
    if (rateRaw.trim() === '') {
      errors.rate = '請輸入利率';
    } else {
      var rate = toNumber(rateRaw);
      if (isNaN(rate)) {
        errors.rate = '利率必須是數字，請勿輸入文字或符號';
      } else if (rate < 0) {
        errors.rate = '利率不得為負數';
      } else {
        // 月利率 → 年利率：×12
        var annual = raw.rateUnit === 'monthly' ? rate * 12 : rate;
        if (annual > LIMITS.maxAnnualRate) {
          errors.rate = '利率過高（年利率上限 ' + LIMITS.maxAnnualRate + '%）';
        } else {
          data.annualRatePct = annual;
        }
      }
    }

    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      data: data
    };
  }

  /* ---------------------------------------------------------------------------
   * 計算攤還表
   * input: { amount(元), months, annualRatePct, method, periodsPerYear }
   * 回傳: { rows:[...], summary:{...}, meta:{...} }，金額欄位一律是「分」
   * ------------------------------------------------------------------------ */
  function calculate(input) {
    var principalCents = toCents(input.amount);              // 貸款本金（分）
    var periodsPerYear = input.periodsPerYear || 12;
    var n = input.months * periodsPerYear / 12;              // 總期數（月繳時＝月數）
    var r = (input.annualRatePct / 100) / periodsPerYear;    // 每期利率（年利率 ÷ 每年期數）

    if (!(principalCents > 0) || !isFinite(n) || n < 1 || Math.abs(n - Math.round(n)) > 1e-9) {
      var e = new Error('輸入資料不完整，請先通過驗證');
      e.code = 'INVALID_INPUT';
      throw e;
    }
    n = Math.round(n);

    var fixedPayment = 0;         // 等額本息：每期固定還款額（分）
    var basePrincipal = 0;        // 等額本金：每期固定本金（分）

    if (input.method === 'equalTotal') {
      if (r === 0) {
        // 零利率：直接把本金平均分攤
        fixedPayment = roundCents(principalCents / n);
      } else {
        // 等額本息公式：  M = P × r × (1+r)^n / [ (1+r)^n − 1 ]
        var growth = Math.pow(1 + r, n);
        fixedPayment = roundCents(principalCents * r * growth / (growth - 1));
      }
      // 若每期還款額連第一期利息都付不出來，代表永遠還不完（利率過高 / 期數過多 / 金額過小）
      if (fixedPayment <= roundCents(principalCents * r) || fixedPayment < 1) {
        var err = new Error(principalCents < n
          ? '貸款金額過小，無法分攤至 ' + n + ' 期，請提高金額或縮短期數'
          : '每期還款額不足以支付利息（利率過高或期限過長），請調降利率或縮短期限');
        err.code = 'NEGATIVE_AMORTIZATION';
        throw err;
      }
    } else {
      // 等額本金：每期本金固定＝本金 ÷ 期數，無法整除的零頭留到末期
      basePrincipal = Math.floor(principalCents / n);
      if (basePrincipal < 1) {
        var err2 = new Error('貸款金額過小，無法分攤至 ' + n + ' 期，請提高金額或縮短期數');
        err2.code = 'AMOUNT_TOO_SMALL';
        throw err2;
      }
    }

    var rows = [];
    var balance = principalCents;   // 期初剩餘本金
    var cumInterest = 0;            // 累計已還利息（整數累加）
    var cumPrincipal = 0;           // 累計已還本金（整數累加）

    for (var i = 1; i <= n; i++) {
      var interest = roundCents(balance * r);   // 當期利息 = 剩餘本金 × 期利率（四捨五入至分）
      var isLast = (i === n);
      var principalPart;
      var payment;

      if (input.method === 'equalTotal') {
        if (isLast) {
          // 末期：本金＝剩餘本金（吸收四捨五入尾差），還款額隨之調整
          principalPart = balance;
          payment = principalPart + interest;
        } else {
          payment = fixedPayment;
          principalPart = payment - interest;
        }
      } else {
        // 等額本金：本金固定，還款額 = 固定本金 + 當期利息（逐期遞減）
        principalPart = isLast ? balance : basePrincipal;
        payment = principalPart + interest;
      }

      if (principalPart <= 0) {
        var e2 = new Error('第 ' + i + ' 期無法償還本金，請調整利率或期限');
        e2.code = 'NON_POSITIVE_PRINCIPAL';
        throw e2;
      }

      balance -= principalPart;
      cumInterest += interest;
      cumPrincipal += principalPart;

      rows.push({
        period: i,
        paymentCents: payment,          // 當期還款額
        principalCents: principalPart,  // 當期本金
        interestCents: interest,        // 當期利息
        cumInterestCents: cumInterest,  // 累計已還利息
        cumPrincipalCents: cumPrincipal,// 累計已還本金
        balanceCents: balance           // 期末剩餘本金
      });
    }

    var totalPaymentCents = cumPrincipal + cumInterest;

    var summary = {
      periods: n,
      method: input.method,
      methodLabel: METHODS[input.method],
      periodsPerYear: periodsPerYear,
      months: input.months,
      annualRatePct: input.annualRatePct,
      periodRatePct: r * 100,                 // 每期利率（%）
      firstPaymentCents: rows[0].paymentCents,   // 首期還款額
      lastPaymentCents: rows[n - 1].paymentCents,// 末期還款額
      totalPrincipalCents: cumPrincipal,         // 本金總額
      totalInterestCents: cumInterest,           // 利息總額
      totalPaymentCents: totalPaymentCents,      // 還款總額
      // 利息佔貸款金額比例（%）：利息總額 ÷ 本金總額 × 100
      interestRatioPct: cumPrincipal > 0 ? (cumInterest / cumPrincipal) * 100 : 0,
      // 還款總額佔貸款金額倍數
      paymentMultiple: cumPrincipal > 0 ? totalPaymentCents / cumPrincipal : 0
    };

    return {
      rows: rows,
      summary: summary,
      meta: {
        principalCents: principalCents,
        periods: n,
        remainingCents: balance   // 應恆為 0
      }
    };
  }

  var API = {
    LIMITS: LIMITS,
    FREQ_OPTIONS: FREQ_OPTIONS,
    METHODS: METHODS,
    toNumber: toNumber,
    toCents: toCents,
    roundCents: roundCents,
    centsToNumber: centsToNumber,
    formatCents: formatCents,
    formatPercent: formatPercent,
    validate: validate,
    calculate: calculate
  };

  if (typeof module === 'object' && module.exports) module.exports = API; // Node
  else global.LoanCore = API;                                             // 瀏覽器
})(typeof globalThis !== 'undefined' ? globalThis : this);
