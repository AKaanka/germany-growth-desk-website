const LEGAL_LANGS = ['en', 'de', 'tr'];
const LEGAL_LANGUAGE_KEY = 'ggd-language';
const LEGAL_COMMON = {
  en:{back:'Back to website',privacy:'Privacy Policy',language:'Language selection'},
  de:{back:'Zurück zur Website',privacy:'Datenschutzerklärung',language:'Sprachauswahl'},
  tr:{back:'Web sitesine dön',privacy:'Gizlilik Politikası',language:'Dil seçimi'}
};

function initialLegalLanguage(){
  const query = new URLSearchParams(window.location.search).get('lang');
  if(LEGAL_LANGS.includes(query)) return query;
  try{
    const stored = localStorage.getItem(LEGAL_LANGUAGE_KEY);
    if(LEGAL_LANGS.includes(stored)) return stored;
  }catch(_error){}
  return 'en';
}

function setLegalLanguage(lang){
  if(!LEGAL_LANGS.includes(lang)) lang = 'en';
  const common = LEGAL_COMMON[lang];
  document.documentElement.lang = lang;
  document.title = window.PAGE_TITLES?.[lang] || document.title;
  const pageCopy = window.PAGE_COPY?.[lang];
  if(pageCopy){
    document.querySelector('[data-page-eyebrow]').textContent = pageCopy.eyebrow;
    document.querySelector('[data-page-title]').textContent = pageCopy.title;
    document.querySelector('[data-page-subtitle]').textContent = pageCopy.subtitle;
  }
  document.querySelectorAll('[data-lang-panel]').forEach(panel=>{
    panel.hidden = panel.getAttribute('data-lang-panel') !== lang;
  });
  document.querySelectorAll('.langs button').forEach(button=>{
    const active = button.dataset.lang === lang;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelector('.langs')?.setAttribute('aria-label', common.language);
  document.querySelectorAll('[data-common="back"]').forEach(el=>el.textContent=common.back);
  document.querySelectorAll('[data-common="privacy"]').forEach(el=>el.textContent=common.privacy);
  document.querySelectorAll('[data-page="home"]').forEach(a=>a.href=`index.html?lang=${lang}`);
  document.querySelectorAll('[data-page="privacy"]').forEach(a=>a.href=`privacy.html?lang=${lang}`);
  try{ localStorage.setItem(LEGAL_LANGUAGE_KEY, lang); }catch(_error){}
  const pageUrl = new URL(window.location.href);
  if(pageUrl.searchParams.has('lang')){
    pageUrl.searchParams.set('lang', lang);
    window.history.replaceState(null, '', pageUrl);
  }
}

document.querySelectorAll('.langs button').forEach(button=>{
  button.addEventListener('click', ()=>setLegalLanguage(button.dataset.lang));
});
setLegalLanguage(initialLegalLanguage());
