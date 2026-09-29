/* Translate authored UI strings only. Flow names, comments and formulas stay verbatim. */
const UI_LANGUAGE_KEY = 'prepflow.language';
const uiExportOptions = typeof UI_EXPORT_OPTIONS === 'undefined' ? null : UI_EXPORT_OPTIONS;
const UI_LANGUAGES = uiExportOptions?.languages || ['ja', ...Object.keys(UI_CATALOGS)];
const uiPreferenceKey = uiExportOptions ? UI_LANGUAGE_KEY + '.html.' + UI_LANGUAGES.join(',') + '.' + uiExportOptions.defaultLanguage : UI_LANGUAGE_KEY;
function normalizeUiLanguage(tag) {
  const base = String(tag || '').toLowerCase().replaceAll('_','-').split('-')[0];
  const locale = base === 'pt' ? 'pt-BR' : base;
  return UI_LANGUAGES.includes(locale) ? locale : null;
}
const uiServerConfig = JSON.parse(document.getElementById('server-config')?.textContent || '{}');
function detectUiLanguage() {
  const preferences = typeof navigator === 'undefined' ? [] :
    navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferences) {
    const language = normalizeUiLanguage(tag);
    if (language) return language;
  }
  return uiExportOptions?.defaultLanguage || (UI_LANGUAGES.includes('en') ? 'en' : UI_LANGUAGES[0]);
}
let uiLanguage = uiServerConfig.language;
try { if (!uiServerConfig.token) uiLanguage = localStorage.getItem(uiPreferenceKey); } catch {}
if (uiExportOptions && (!uiExportOptions.showSwitcher || !UI_LANGUAGES.includes(uiLanguage))) uiLanguage = uiExportOptions.defaultLanguage;
if (!UI_LANGUAGES.includes(uiLanguage)) uiLanguage = detectUiLanguage();
const uiStaticText = [], uiStaticAttributes = [], uiBindings = new Map();
const uiMessageOrigins = new Map();
const uiCatalog = () => UI_CATALOGS[uiLanguage] || {};
const uiTranslation = source => Object.hasOwn(uiCatalog(), source) ? uiCatalog()[source] : undefined;
const uiHasJapanese = value => /[ぁ-んァ-ヶ一-龯]/.test(value);
function uiText(source) {
  if (uiLanguage === 'ja') return source;
  const trimmed = source.trim();
  const translated = uiTranslation(source) ?? uiTranslation(trimmed);
  return translated === undefined ? source : uiTranslation(source) !== undefined ? translated :
    source.slice(0, source.indexOf(trimmed)) + translated + source.slice(source.indexOf(trimmed) + trimmed.length);
}
function uiAuthored(source) {
  if (!/<[a-z]/i.test(source)) return uiText(source);
  return source.replace(/(^|>)([^<]+)(?=<|$)/g, (_, start, text) => start + uiText(text))
    .replace(/\b(title|aria-label|placeholder)="([^"]*)"/g, (_, name, text) => `${name}="${uiText(text)}"`);
}
function ui(source, ...values) {
  const key = typeof source === 'string' ? source : source.map((part, index) => part + (index < values.length ? `{{${index}}}` : '')).join('');
  const substitute = text => typeof source === 'string' ? text : text.replace(/\{\{(\d+)\}\}/g, (_, index) => String(values[index] ?? ''));
  const translated = substitute(uiAuthored(key)), original = substitute(key);
  // Toasts/errors can outlive a language switch; retain their authored source.
  if (translated !== original && !/<[a-z]/i.test(key) && original.length < 4096) {
    uiMessageOrigins.set(translated, original);
    if (uiMessageOrigins.size > 512) uiMessageOrigins.delete(uiMessageOrigins.keys().next().value);
  }
  return translated;
}
// Labels in module-level dictionaries must reflect later language changes too.
function uiLabels(value) {
  return new Proxy(value, {get(target, key) {
    const item = Reflect.get(target, key);
    return typeof item === 'string' ? ui(item) : item && typeof item === 'object' ? uiLabels(item) : item;
  }});
}
const uiMessagePatterns = Object.keys(UI_CATALOGS.en || Object.values(UI_CATALOGS)[0] || {}).filter(key => key.includes('{{')).map(key => {
  const slots = [];
  const parts = key.split(/(\{\{\d+\}\})/).map(part => {
    const slot = /^\{\{(\d+)\}\}$/.exec(part);
    if (slot) { slots.push(slot[1]); return '([\\s\\S]*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return {pattern: new RegExp('^' + parts.join('') + '$'), slots, key};
});
// Used only for application-generated messages, never general flow content.
function uiMessage(source) {
  source = String(source ?? '');
  source = uiMessageOrigins.get(source) ?? source;
  if (uiLanguage === 'ja') return source;
  if (uiTranslation(source) !== undefined) return uiTranslation(source);
  for (const {pattern, slots, key} of uiMessagePatterns) {
    const match = pattern.exec(source);
    if (match) return (uiTranslation(key) ?? key).replace(/\{\{(\d+)\}\}/g, (_, slot) => match[slots.indexOf(slot) + 1] ?? '');
  }
  // Legacy server logs contain an authored prefix followed by a path/name.
  for (const [key, value] of Object.entries(uiCatalog())) {
    if (key.length >= 8 && /[:：]\s*$/.test(key) && source.startsWith(key)) return value + source.slice(key.length);
  }
  return source;
}
function uiBind(element, property, render) {
  if (!element) return;
  let bindings = uiBindings.get(element);
  if (!bindings) uiBindings.set(element, bindings = new Map());
  bindings.set(property, render);
  element[property] = render();
}
function uiCaptureStatic() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    if (!node.parentElement.closest('script,style') && uiHasJapanese(node.nodeValue)) uiStaticText.push([node, node.nodeValue]);
  }
  for (const element of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
    for (const name of ['title','aria-label','placeholder']) {
      const value = element.getAttribute(name);
      if (value && uiHasJapanese(value)) uiStaticAttributes.push([element, name, value]);
    }
  }
}
function uiRefresh() {
  document.documentElement.lang = uiLanguage;
  for (const [node, source] of uiStaticText) if (node.isConnected) node.nodeValue = uiText(source);
  for (const [element, name, source] of uiStaticAttributes) if (element.isConnected) element.setAttribute(name, uiText(source));
  for (const [element, bindings] of uiBindings) {
    if (!element.isConnected) { uiBindings.delete(element); continue; }
    if (element.closest('dialog') && !element.closest('dialog').open) continue;
    for (const [property, render] of bindings) element[property] = render();
  }
  for (const option of document.querySelectorAll('#language-menu [data-language]')) {
    option.setAttribute('aria-checked', String(option.dataset.language === uiLanguage));
  }
}
function setUiLanguage(language) {
  if (!UI_LANGUAGES.includes(language)) return;
  uiLanguage = language;
  try { localStorage.setItem(uiPreferenceKey, language); } catch {}
  uiRefresh();
  document.dispatchEvent(new CustomEvent('viewer-language-change'));
  if (uiServerConfig.token) {
    uiFetch('/api/language', {method:'POST', headers:{'Content-Type':'application/json','X-Viewer-Token':uiServerConfig.token},
      body:JSON.stringify({language})}).then(response => { if (!response.ok) throw new Error(); })
      .catch(() => { if (typeof toast === 'function') toast('表示言語を保存できませんでした。'); });
  }
}
function setupLanguageMenu() {
  if (uiExportOptions && !uiExportOptions.showSwitcher) return;
  const button = document.getElementById('language-button'), menu = document.getElementById('language-menu');
  function close(focus = false) { menu.hidden = true; button.setAttribute('aria-expanded','false'); if (focus) button.focus(); }
  button.onclick = () => { menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector(`[data-language="${uiLanguage}"]`).focus(); };
  menu.onclick = event => { const option = event.target.closest('[data-language]'); if (option) { setUiLanguage(option.dataset.language); close(true); } };
  document.addEventListener('click', event => { if (!event.target.closest('.language-picker')) close(); });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const options = [...menu.querySelectorAll('button')];
      const current = options.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
        (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
      options[next].focus();
    }
  });
  document.querySelector('.language-picker').addEventListener('focusout', event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); });
  uiRefresh();
}
// The local server uses this for native picker titles and the language of exported HTML.
async function uiFetch(input, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-Viewer-Language', uiLanguage);
  return fetch(input, {...options, headers});
}
uiCaptureStatic();
uiRefresh();
