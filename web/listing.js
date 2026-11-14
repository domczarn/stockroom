'use strict';
function listingFacts(item) {
  const name = item.name || '';
  const types = [
    [/qzip|quarter[ -]?zip/i, 'Quarter Zip'],
    [/hoodie/i, 'Hoodie'],
    [/windbreaker/i, 'Windbreaker'],
    [/\bjacket\b/i, 'Jacket'],
    [/zip up|full[ -]?zip/i, 'Full Zip Top'],
    [/\bshorts\b/i, 'Shorts'],
    [/\bjeans\b/i, 'Jeans'],
    [/\bpolo(?: shirt)?\b/i, 'Polo Shirt']
  ];
  const garment = item.garment || types.find(([pattern])=>pattern.test(name))?.[1] || '';
  // Colours mentioned only in a logo or trim are not reliable garment colours.
  const mainName = name.split(/[;|]/)[0].replace(/\b(?:black|navy|grey|gray|white|blue|red|green|beige|cream|brown|pink)\s+(?:logo|trim|stitching)\b/gi,'');
  const color = item.color || (mainName.match(/\b(black|navy|grey|gray|white|blue|red|green|beige|cream|brown|pink)\b/i)?.[1] || '');
  const size = item.size || name.match(/^\s*(XXL|XL|XS|S|M|L)\s*-/i)?.[1] || name.match(/\(\s*(XXL|XL|XS|S|M|L)\s*\)/i)?.[1] || '';
  return {garment,color:color ? color[0].toUpperCase()+color.slice(1).toLowerCase() : '',size};
}
function buildListing(item) {
  const clean = value => String(value || '').trim().replace(/\s+/g,' ');
  const facts = listingFacts(item);
  const name = clean(item.name)
    .replace(/^\s*(XXL|XL|XS|S|M|L)\s*-\s*/i,'')
    .replace(/\(\s*(XXL|XL|XS|S|M|L)\s*\)\s*$/i,'')
    .replace(/\bqzip\b|quarter[- ]?zip/gi,'Quarter Zip')
    .replace(/[;|]+/g,' ').replace(/\s+-\s+/g,' ').replace(/\s+/g,' ').trim();
  const includes = (text, part) => (' '+text.toLowerCase()+' ').includes(' '+part.toLowerCase()+' ');
  const brand = clean(item.brand);
  const core = [brand && !includes(name,brand) ? brand : '',name || facts.garment].filter(Boolean).join(' ');
  const size = clean(facts.size);
  const sizeLabel = size ? 'Size '+size : '';
  const title = [core, facts.color && !includes(core,facts.color) ? facts.color : '', sizeLabel && !includes(core,sizeLabel) ? sizeLabel : '']
    .filter(Boolean).join(' · ').slice(0,150).trim();
  const lines = [
    core,
    sizeLabel,
    facts.color && !includes(core,facts.color) ? 'Colour: '+facts.color : '',
    item.condition ? 'Condition: '+clean(item.condition) : '',
    item.flaws ? 'Wear / flaws: '+clean(item.flaws) : '',
    item.measurements ? 'Measurements: '+clean(item.measurements) : '',
    item.material ? 'Material: '+clean(item.material) : ''
  ].filter(Boolean);
  return {title,description:lines.join('\n')};
}
function listingChecks(item, title, description) {
  const facts = listingFacts(item);
  return [
    ['Brand',Boolean(item.brand)],
    ['Item type',Boolean(facts.garment)],
    ['Size',Boolean(facts.size)],
    ['Condition',Boolean(item.condition)],
    ['Wear / flaws checked',Boolean(item.flaws)],
    ['Own photos',Boolean(item.photos?.length)],
    ['Draft text',Boolean(title && description && !/\[[^\]]+\]/.test(description))]
  ];
}
