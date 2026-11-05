// Tagged template that escapes every interpolated value unless it came from `html`
// itself, so user text can't turn into markup anywhere in the app.

class Safe {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);

function render(value) {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  return value instanceof Safe ? value.value : esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Safe(out);
}

export const raw = (value) => new Safe(value);

// Notes with any http(s) URL turned into a link. Other schemes stay plain text.
export function linkify(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
  return html`${parts.map((part, i) => {
    if (i % 2 === 0) return part;
    return html`<a href="${part}" target="_blank" rel="noopener noreferrer">${part}</a>`;
  })}`;
}
