'use strict';

function receiptDate(value) {
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const uk = value.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  const words = value.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})$/i);
  let year, month, day;
  if (iso) [,year,month,day] = iso.map(Number);
  else if (uk) [,day,month,year] = uk.map(Number);
  else if (words) {
    day = Number(words[1]);
    month = months.indexOf(words[2].slice(0,3).toLowerCase())+1;
    year = Number(words[3]);
  } else return '';
  const date = new Date(Date.UTC(year,month-1,day));
  if (year < 2000 || date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return '';
  return date.toISOString().slice(0,10);
}

function parseStockReceipt(text) {
  const lines = text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const read = pattern => lines.flatMap((line,index)=>{
    const match = line.match(pattern);
    return match ? [(match[1] || '').trim() || lines[index+1] || ''] : [];
  });
  const unique = values => [...new Set(values.filter(Boolean))];
  const items = unique(read(/^(?:item(?: name)?|product(?: name)?|order item)(?:\s*[:–-]\s*|$)(.*)$/i).concat(read(/^order$/i).filter(Boolean)));
  const brands = unique(read(/^brand\s*[:–-]\s*(.*)$/i));
  const totals = pattern => unique(read(pattern).map(value=>{
    const match = value.match(/^(?:£\s*|GBP\s+)([\d,]+\.\d{2})(?:\s+GBP)?$/i);
    if (!match) return '';
    const amount = Number(match[1].replace(/,/g,''));
    return amount>0 && amount<=1000000 ? amount.toFixed(2) : '';
  }));
  const paid = totals(/^(?:total paid|amount paid|paid)\s*[:–-]?\s*(.*)$/i);
  const total = totals(/^(?:grand total|order total|total)(?:\s*[:–-]\s*|\s+|$)(.*)$/i);
  const amounts = paid.length ? paid : total;
  const dates = unique(read(/^(?:order date|purchase date|payment date|date)\s*[:–-]\s*(.*)$/i).map(receiptDate));
  const pricedLines = lines.filter(line=>/^[^£]+\s+£\s*\d[\d,]*\.\d{2}$/i.test(line)&&
    !/^(?:total|sub\s*total|amount|paid|cash|card|change|postage|shipping|delivery|discount|tax|vat|fee|vinted fee|item)\b/i.test(line));
  const multiple = items.length>1 || pricedLines.length>1 || lines.some(line=>/^(?:items|quantity)\s*(?:[:–-]\s*|\s+)(?:[2-9]|\d{2,})\b/i.test(line));
  return {
    name: items.length===1 && !multiple ? items[0].slice(0,200) : '',
    brand: brands.length===1 && !multiple ? brands[0].slice(0,150) : '',
    cost: amounts.length===1 && !multiple ? amounts[0] : '',
    purchasedAt: dates.length===1 ? dates[0] : '',
    multiple
  };
}

let receiptGeneration = 0;
function resetReceiptEntry(item) {
  receiptGeneration++;
  $('receiptEntry').hidden = Boolean(item);
  $('receiptEntry').open = false;
  $('receiptText').value = '';
  $('receiptImage').value = '';
  $('receiptImage').disabled = false;
  $('receiptSuggestion').textContent = '';
  $('receiptStatus').textContent = '';
  $('applyReceipt').disabled = true;
}

function receiptSuggestion() {
  const candidate = parseStockReceipt($('receiptText').value);
  if (candidate.purchasedAt > todayUK()) candidate.purchasedAt = '';
  const parts = [
    ['Item',candidate.name], ['Brand',candidate.brand], ['Total',candidate.cost && gbp(Number(candidate.cost))],
    ['Purchase date',candidate.purchasedAt && dateLabel(candidate.purchasedAt)]
  ].filter(([, value])=>value);
  $('applyReceipt').disabled = candidate.multiple || parts.length===0;
  $('receiptSuggestion').innerHTML = candidate.multiple
    ? '<p>This looks like a multi-item receipt. Add the items separately or record a bulk order.</p>'
    : parts.length ? '<dl>'+parts.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>'
    : '<p>Add labelled details such as Item, Total paid and Purchase date.</p>';
  return candidate;
}

function initialiseReceiptEntry() {
  $('receiptText').addEventListener('input',receiptSuggestion);
  $('applyReceipt').onclick = () => {
    const candidate = receiptSuggestion();
    if (candidate.multiple || isReadOnly()) return;
    let applied = 0;
    for (const field of ['name','brand','cost','purchasedAt']) {
      const input = form.elements[field];
      if (candidate[field] && (!input.value || (field==='purchasedAt' && input.value===todayUK()))) {
        input.value = candidate[field];
        applied++;
      }
    }
    if (candidate.name && form.elements.name.value === candidate.name) {
      const facts = listingFacts({name:candidate.name});
      for (const field of ['garment','color','size']) {
        if (facts[field] && !form.elements[field].value) {
          form.elements[field].value = facts[field];
          applied++;
        }
      }
    }
    form.elements.name.dispatchEvent(new Event('input',{bubbles:true}));
    $('receiptEntry').open = false;
    toast(applied ? 'Suggestions added. Check the item, total and date before saving.' : 'Your existing entries were kept.');
  };
  $('receiptImage').onchange = async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (file.size>12000000) {
      $('receiptStatus').textContent = 'Choose a screenshot under 12 MB.';
      return;
    }
    const generation = ++receiptGeneration;
    const previous = $('receiptText').value;
    const current = () => generation===receiptGeneration && $('modal').open;
    let worker;
    let timeout;
    let expired = false;
    input.disabled = true;
    $('receiptStatus').textContent = 'Loading screenshot reader…';
    try {
      const {createWorker} = await import('/receipt-ocr.js');
      let rejectReader;
      const failed = new Promise((_,reject)=>{
        rejectReader = reject;
        timeout = setTimeout(()=>{
          expired = true;
          reject(new Error('Screenshot reader timed out.'));
        },45000);
      });
      const startup = createWorker('eng',1,{
        workerPath:'/receipt-ocr-worker.js',
        workerBlobURL:false,
        errorHandler:rejectReader,
        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/tesseract-core-lstm.wasm.js',
        langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
        logger:message=>{if(current() && message.status==='recognizing text') $('receiptStatus').textContent='Reading screenshot… '+Math.round(message.progress*100)+'%';}
      }).then(async loaded=>{
        if (expired) await loaded.terminate();
        return loaded;
      });
      worker = await Promise.race([startup,failed]);
      if (!current()) return;
      const {data} = await Promise.race([worker.recognize(file),failed]);
      if (!current()) return;
      if ($('receiptText').value!==previous) {
        $('receiptStatus').textContent = 'Your typed receipt text was kept.';
        return;
      }
      $('receiptText').value = data.text.trim().slice(0,12000);
      receiptSuggestion();
      $('receiptStatus').textContent = data.text.trim() ? 'Check the extracted text and correct any errors.' : 'No text found. Try a sharper screenshot or paste the receipt text.';
    } catch {
      if (current()) $('receiptStatus').textContent = 'Could not read this screenshot. Try a PNG or JPEG or paste the receipt text.';
    } finally {
      clearTimeout(timeout);
      if (worker) await worker.terminate().catch(()=>{});
      if (generation===receiptGeneration) input.disabled = false;
    }
  };
}
