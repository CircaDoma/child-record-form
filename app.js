(function () {
  'use strict';

  // Paste the Apps Script web app URL (the one ending in /exec) between the quotes.
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbx4so1jTx2n99k2DIHq0rPVebEijmSEXo_l-v8_lnEy2J4A113NDMxKtXXQXuIFvAMuQg/exec';

  // true: the page only works from the link that ends in #k=... (the key is read from the address).
  // The server must have the same key (see setup() in Code.gs). Set to false to turn the key off.
  var REQUIRE_KEY = true;

  var $ = function (id) { return document.getElementById(id); };

  var TEXT_IDS = [
    'first', 'middle', 'last', 'suffix', 'birthdate', 'birthplace', 'street', 'city', 'state', 'zip',
    'father', 'fatherRec', 'mother', 'motherRec', 'parentWard',
    'guardian', 'guardianRec', 'blessDate', 'blessBy', 'blessOffice', 'blessRec',
    'signer', 'signDate', 'website'
  ];
  var RADIO_NAMES = ['gender', 'covenant', 'fatherMember', 'motherMember', 'guardianMember'];

  // ---------- Signature pad ----------
  var INK = '#000000';
  var LINE_FRACTION = 0.011; // pen width as a fraction of the box width
  var EXPORT_SCALE = 3;      // PNG pixels per on-screen pixel

  var canvas = $('sigCanvas');
  var ctx = canvas.getContext('2d');
  var strokes = [];          // each stroke is a list of [x, y] points, both 0..1 of the box
  var current = null;
  var cssW = 0;
  var cssH = 0;
  var frame = 0;

  function sizeCanvas() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = window.devicePixelRatio || 1;
    cssW = r.width;
    cssH = r.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function penWidth() { return Math.max(2, cssW * LINE_FRACTION); }

  function drawStroke(c, pts, sx, sy, ox, oy) {
    var P = pts.map(function (p) { return [p[0] * sx + ox, p[1] * sy + oy]; });
    c.beginPath();
    if (P.length === 1) {
      c.arc(P[0][0], P[0][1], c.lineWidth / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.moveTo(P[0][0], P[0][1]);
    for (var i = 1; i < P.length - 1; i++) {
      var mx = (P[i][0] + P[i + 1][0]) / 2;
      var my = (P[i][1] + P[i + 1][1]) / 2;
      c.quadraticCurveTo(P[i][0], P[i][1], mx, my);
    }
    c.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
    c.stroke();
  }

  function setInk(c, width) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = INK;
    c.fillStyle = INK;
    c.lineWidth = width;
  }

  function render() {
    frame = 0;
    ctx.clearRect(0, 0, cssW, cssH);
    setInk(ctx, penWidth());
    strokes.forEach(function (s) { drawStroke(ctx, s, cssW, cssH, 0, 0); });
    $('sigHint').hidden = strokes.length > 0;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function pointFrom(e) {
    var r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    current = [pointFrom(e)];
    strokes.push(current);
    clearError('signature');
    schedule();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!current) return;
    e.preventDefault();
    var events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    if (!events.length) events = [e];
    events.forEach(function (ev) { current.push(pointFrom(ev)); });
    schedule();
  });

  function endStroke() { current = null; }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  $('clearBtn').addEventListener('click', function () {
    strokes = [];
    current = null;
    render();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(sizeCanvas).observe($('sigBox'));
  } else {
    window.addEventListener('resize', sizeCanvas);
  }

  // Crops to the ink, keeps the background transparent, and renders at 3x for sharpness.
  function exportPng() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokes.forEach(function (s) {
      s.forEach(function (p) {
        var x = p[0] * cssW, y = p[1] * cssH;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      });
    });
    var lw = penWidth();
    var margin = lw * 2 + 8;
    var k = EXPORT_SCALE;
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.ceil((maxX - minX + 2 * margin) * k));
    out.height = Math.max(1, Math.ceil((maxY - minY + 2 * margin) * k));
    var oc = out.getContext('2d');
    setInk(oc, lw * k);
    strokes.forEach(function (s) {
      drawStroke(oc, s, cssW * k, cssH * k, (margin - minX) * k, (margin - minY) * k);
    });
    return out.toDataURL('image/png');
  }

  // ---------- Validation ----------
  function val(id) { return ($(id).value || '').trim(); }
  function radio(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function fieldBox(name) { return document.querySelector('[data-field="' + name + '"]'); }

  function setError(name, message) {
    var box = fieldBox(name);
    if (!box) return;
    var err = box.querySelector('.err');
    if (!err) return;
    if (!err.id) err.id = 'err-' + name;
    err.textContent = message || '';
    err.hidden = !message;
    box.classList.toggle('invalid', !!message);
    Array.prototype.forEach.call(box.querySelectorAll('input, select'), function (el) {
      if (message) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', err.id);
      } else {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
    });
  }

  function clearError(name) { setError(name, ''); }

  // In page order, so the first failure is the first one the person sees.
  var RULES = [
    { name: 'first', message: 'Enter the child’s first name.', ok: function () { return !!val('first'); } },
    { name: 'last', message: 'Enter the child’s last name.', ok: function () { return !!val('last'); } },
    { name: 'gender', message: 'Choose a gender.', ok: function () { return !!radio('gender'); } },
    { name: 'birthdate', message: 'Enter the child’s birth date.', ok: function () { return !!val('birthdate'); } },
    { name: 'signer', message: 'Enter the parent or guardian’s name.', ok: function () { return !!val('signer'); } },
    { name: 'signature', message: 'Please sign in the box.', ok: function () { return strokes.length > 0; } },
    { name: 'signDate', message: 'Enter today’s date.', ok: function () { return !!val('signDate'); } }
  ];

  function validate() {
    var first = null;
    RULES.forEach(function (rule) {
      var good = rule.ok();
      setError(rule.name, good ? '' : rule.message);
      if (!good && !first) first = rule.name;
    });
    if (first) {
      var box = fieldBox(first);
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var focusable = box.querySelector('input, select');
      if (focusable && first !== 'signature') focusable.focus({ preventScroll: true });
    }
    return !first;
  }

  $('form').addEventListener('input', function (e) {
    var box = e.target.closest && e.target.closest('[data-field]');
    if (box) clearError(box.getAttribute('data-field'));
  });
  $('form').addEventListener('change', function (e) {
    var box = e.target.closest && e.target.closest('[data-field]');
    if (box) clearError(box.getAttribute('data-field'));
  });

  // ---------- PDF: fill the official Child Record Form ----------
  // The template PDF has no fillable fields, so text, check marks and the signature are placed at fixed
  // positions. Coordinates are in PDF points measured from the TOP-left of the A4 page.
  // ---- PDF fill (start)
  var PDF_PAGE_HEIGHT = 841.889764;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  // Standard PDF fonts only cover Western European characters. Anything else becomes "?"
  // instead of crashing the whole PDF.
  function pdfSafe(font, text) {
    var out = '';
    Array.from(String(text || '').replace(/[\r\n\t]+/g, ' ')).forEach(function (ch) {
      try { font.encodeText(ch); out += ch; } catch (err) { out += '?'; }
    });
    return out.replace(/\s+/g, ' ').trim();
  }

  async function fillChildRecordPdf(PDFLib, templateBase64, d, signaturePng) {
    var doc = await PDFLib.PDFDocument.load(templateBase64);
    var page = doc.getPages()[0];
    var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    var H = page.getHeight() || PDF_PAGE_HEIGHT;
    var ink = PDFLib.rgb(0, 0, 0);

    // Writes one line of text with its baseline at `base` (from the top of the page).
    // Shrinks the text to fit `maxW`, then trims it if it still does not fit.
    function text(x, base, value, maxW) {
      var str = pdfSafe(font, value);
      if (!str) return;
      var size = 10;
      while (size > 6.5 && font.widthOfTextAtSize(str, size) > maxW) size -= 0.5;
      while (str.length > 1 && font.widthOfTextAtSize(str, size) > maxW) str = str.slice(0, -1);
      page.drawText(str, { x: x, y: H - base, size: size, font: font, color: ink });
    }

    // Draws an X centred on a checkbox.
    function check(cx, cy) {
      var r = 3.2;
      var y = H - cy;
      page.drawLine({ start: { x: cx - r, y: y - r }, end: { x: cx + r, y: y + r }, thickness: 1.3, color: ink });
      page.drawLine({ start: { x: cx - r, y: y + r }, end: { x: cx + r, y: y - r }, thickness: 1.3, color: ink });
    }

    function yesNo(value, yes, no) {
      if (value === 'Yes') check(yes[0], yes[1]);
      else if (value === 'No') check(no[0], no[1]);
    }

    // Individual information
    var childName = [d.last, [d.first, d.middle].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (d.suffix) childName += ', ' + d.suffix;
    text(31, 138.0, childName, 398);
    if (d.gender === 'Male') check(447.9, 132.7);
    else if (d.gender === 'Female') check(501.4, 132.7);
    text(31, 163.3, fmtDate(d.birthdate), 126);
    text(165, 163.3, d.birthplace, 265);
    yesNo(d.covenant, [447.9, 158.0], [496.4, 158.0]);
    var address = [d.street, d.city, [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    text(31, 188.9, address, 532);

    // Parents
    text(31, 241.8, d.father, 266);
    yesNo(d.fatherMember, [314.8, 236.5], [363.3, 236.5]);
    text(439, 241.8, d.fatherRec, 124);
    text(31, 267.0, d.mother, 266);
    yesNo(d.motherMember, [314.8, 261.7], [363.3, 261.7]);
    text(439, 267.0, d.motherRec, 124);
    text(31, 292.3, d.parentWard, 398);
    text(31, 317.9, d.guardian, 266);
    yesNo(d.guardianMember, [314.8, 312.2], [363.3, 312.2]);
    text(439, 317.9, d.guardianRec, 124);

    // Blessing information (ward and stake are already printed on the template)
    text(31, 370.8, fmtDate(d.blessDate), 532);
    text(31, 396.0, d.blessBy, 266);
    text(303, 396.0, d.blessOffice, 127);
    text(439, 396.0, d.blessRec, 124);

    // Signature (image, scaled to fit beside the label) and date
    if (signaturePng) {
      var img = await doc.embedPng(signaturePng);
      var box = { x: 182, top: 485.5, w: 246, h: 29 };
      var scale = Math.min(box.w / img.width, box.h / img.height);
      var w = img.width * scale;
      var h = img.height * scale;
      page.drawImage(img, { x: box.x, y: H - (box.top + box.h) + (box.h - h) / 2, width: w, height: h });
    }
    text(439, 509.4, fmtDate(d.signDate), 124);

    return await doc.saveAsBase64();
  }
  // ---- PDF fill (end)

  // The PDF library (pdf-lib.min.js, kept on this site) is loaded by index.html. The blank template loads
  // in the background while the person fills in the form.
  var templatePromise = null;

  function loadTemplate() {
    if (!templatePromise) {
      templatePromise = fetch('template.pdf').then(function (res) {
        if (!res.ok) throw new Error('Could not load the PDF template');
        return res.arrayBuffer();
      }).then(function (buf) { return new Uint8Array(buf); });
      templatePromise.catch(function () { templatePromise = null; }); // try again next time
    }
    return templatePromise;
  }

  // Resolves with the filled PDF as base64. Rejects if the library or template is unavailable.
  function makePdf(data) {
    if (!window.PDFLib) {
      return Promise.reject(new Error('The PDF tool did not load'));
    }
    var timeout = new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error('Preparing the form timed out')); }, 20000);
    });
    return Promise.race([loadTemplate(), timeout]).then(function (template) {
      return fillChildRecordPdf(window.PDFLib, template, data, data.png);
    });
  }

  // The link key comes from the part of the address after "#", which the browser never sends to any server.
  function readKey() {
    var m = /^#k=([A-Za-z0-9_-]{8,64})$/.exec(window.location.hash || '');
    return m ? m[1] : '';
  }

  // Sends ONLY the finished PDF, the link key, and the child's first and last name (used for the file name).
  // The body is plain text (a "simple" request, so no preflight) and no cookies are sent.
  function sendToServer(payload) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 60000);
    return fetch(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: ctl ? ctl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('Server error ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || !json.ok) throw new Error((json && json.error) || 'The form was not saved.');
      return json;
    }).then(function (json) { clearTimeout(timer); return json; },
            function (err) { clearTimeout(timer); throw err; });
  }

  // ---------- Submit ----------
  var busy = false;
  var banner = $('banner');
  var submitBtn = $('submitBtn');

  function showBanner(text) {
    banner.textContent = text;
    banner.hidden = false;
  }

  function collect() {
    var data = {};
    TEXT_IDS.forEach(function (id) { data[id] = val(id); });
    RADIO_NAMES.forEach(function (name) { data[name] = radio(name); });
    data.png = exportPng();
    return data;
  }

  function setBusy(on, label) {
    busy = on;
    submitBtn.disabled = on;
    submitBtn.textContent = on ? (label || 'Submitting…') : 'Submit';
  }

  function onSuccess(result) {
    if (!result || !result.ok) {
      onFailure({ message: 'The form was not saved.' });
      return;
    }
    setBusy(false);
    var who = val('signer');
    $('doneTitle').textContent = who ? 'Thank you, ' + who + '!' : 'Thank you!';
    wipeForm();                       // nothing from the form stays on the page after it is sent
    $('formView').hidden = true;
    $('doneView').hidden = false;
    window.scrollTo(0, 0);
  }

  function wipeForm() {
    $('form').reset();
    strokes = [];
    current = null;
    ctx.clearRect(0, 0, cssW, cssH);
    $('signDate').value = today();
  }

  function onFailure(err) {
    setBusy(false);
    var detail = err && err.message ? ' (' + err.message + ')' : '';
    showBanner('The form could not be submitted. Check your connection and tap Submit again.' + detail);
  }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    banner.hidden = true;
    if (!validate()) return;
    if (!ENDPOINT) {
      showBanner('This page is not connected to the server yet, so nothing was sent.');
      return;
    }
    setBusy(true, 'Preparing…');
    var data = collect();
    // The finished PDF is built here on the phone. Only the PDF leaves the page, never the separate answers.
    makePdf(data).then(function (pdf) {
      setBusy(true, 'Submitting…');
      return sendToServer({ pdf: pdf, key: readKey(), first: data.first, last: data.last, website: data.website });
    }).then(onSuccess, onFailure);
  });

  // ---------- Reset / start ----------
  function today() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function resetForm() {
    $('form').reset();
    strokes = [];
    current = null;
    $('signDate').value = today();
    RULES.forEach(function (rule) { clearError(rule.name); });
    banner.hidden = true;
    $('doneView').hidden = true;
    $('formView').hidden = false;
    sizeCanvas();
    window.scrollTo(0, 0);
  }

  $('againBtn').addEventListener('click', resetForm);

  $('signDate').value = today();
  sizeCanvas();
  if (REQUIRE_KEY && !readKey()) {
    $('linkNotice').hidden = false;
    $('form').hidden = true;
  } else {
    loadTemplate().catch(function () { /* shown again if it still fails when Submit is tapped */ });
  }
})();
