import crypto from 'node:crypto';
const allowedOrigins = new Set(['https://myfcu.fcu.edu.tw']);
export const MYFCU_START_URL = 'https://myfcu.fcu.edu.tw/main/InfoMyFcuLogin.aspx?Redirect=%2Fmain%2FS3603%2FS360380_pmust.aspx';
const recordPath = '/main/S3603/S360380_pmust.aspx';
const loginPath = '/main/InfoMyFcuLogin.aspx';
const allowedHashes = new Set(['', '#/courseXd', '#/courseKind1', '#/courseXc', '#/courseKind23', '#/courseSelP', '#/courseSelPno']);
// Page identity only, not a network-navigation or request authorization policy.
// Reject redirect-like parameters and URL/path-valued parameters; never log values.
function safeHistoryQuery(query) {
  if (!query) return true;
  if (query.length > 2048) return false;
  const params=new URLSearchParams(query);
  for(const [key,value] of params) {
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || /redirect|return|next|target|callback|forward|dest|uri|url/i.test(key)) return false;
    if(value.length>512 || /[\\/\x00-\x1f]/.test(value) || /(?:https?:|javascript:|data:)/i.test(value)) return false;
  }
  return true;
}
export function validateMyFcuHistoryPage(input) {
  let u;try{u=new URL(input);}catch{return {ok:false,failedCheck:'INVALID_URL'};}
  if(u.protocol!=='https:')return {ok:false,failedCheck:'HTTPS_REQUIRED'};
  if(u.origin!=='https://myfcu.fcu.edu.tw'||u.username||u.password)return {ok:false,failedCheck:'ORIGIN_MISMATCH'};
  if(u.pathname!==recordPath)return {ok:false,failedCheck:'PATHNAME_MISMATCH'};
  if(!safeHistoryQuery(u.search))return {ok:false,failedCheck:'QUERY_REJECTED'};
  const split=u.hash.indexOf('?'),hash=split<0?u.hash:u.hash.slice(0,split);
  let decodedHash;try{decodedHash=decodeURIComponent(hash);}catch{return {ok:false,failedCheck:'HASH_REJECTED'};}
  if(decodedHash.length>512 || /[\\\x00-\x1f]/.test(decodedHash) || /(?:https?:|javascript:|data:|\/\/)/i.test(decodedHash))return {ok:false,failedCheck:'HASH_REJECTED'};
  if(!safeHistoryQuery(split<0?'':u.hash.slice(split+1)))return {ok:false,failedCheck:'QUERY_REJECTED'};
  return {ok:true,failedCheck:null};
}
export const isMyFcuHistoryPage = input => validateMyFcuHistoryPage(input).ok;
// Validation-only preparation. No launcher, login entry, HTTP request or credential handling.
export function isAllowedMyFcuUrl(input) {
  try {
    const url = new URL(input);
    if (!allowedOrigins.has(url.origin) || url.username || url.password) return false;
    if (url.pathname === loginPath) return !url.hash && [...url.searchParams.keys()].length === 1 && url.searchParams.get('Redirect') === recordPath;
    return url.pathname === recordPath && !url.search && allowedHashes.has(url.hash);
  } catch { return false; }
}
export function validateRealMode(env = process.env) {
  if (env.CONTROLLED_BROWSER_REAL_TEST !== 'true') return { enabled:false, ready:false, reason:'disabled' };
  if (env.CONTROLLED_BROWSER_MOCK === 'true') return { enabled:false, ready:false, reason:'mode-conflict' };
  return { enabled:true, ready:false, reason:'security-review-required' };
}

// Accept only the verified redirect target, including equivalent URL encoding.
// Duplicate, additional, or different parameters remain forbidden.
export function isKnownLoginQuery(url) {
  if (!url.search) return true;
  const entries=[...url.searchParams.entries()];
  return entries.length===1 && entries[0][0]==='Redirect' && entries[0][1]===recordPath;
}

// Preparation only: this policy is not an activation switch for personal login.
// Unknown POST endpoints, navigation targets and all other origins stay blocked.
export function allowedPersonalRequest(raw, method, navigation, context = {}) {
  try {
    const u = new URL(raw), start = new URL(MYFCU_START_URL);
    if (u.origin !== start.origin || u.username || u.password) return false;
    if (u.pathname === loginPath && ['GET','POST'].includes(method)) {
      if (u.hash || !isKnownLoginQuery(u)) return false;
      if (method === 'GET') return navigation;
      if (!context.mainFrame || !['starting','login'].includes(context.phase)) return false;
      const source = new URL(context.sourceUrl);
      return source.origin === start.origin && source.pathname === loginPath && !source.username && !source.password;
    }
    if (u.pathname === recordPath && navigation && method === 'GET') return !u.search && allowedHashes.has(u.hash);
    if (!navigation && method === 'GET' && ['/main/WebResource.axd','/main/ScriptResource.axd'].includes(u.pathname)) return true;
    return false;
  } catch { return false; }
}

// Only assets declared by an explicitly authorized official document are eligible.
// This is a per-request check, not a domain, directory, or navigation allowlist.
export async function isDeclaredMyFcuAsset(request, page, phase, {allowHistory=false} = {}) {
  try {
    if (!page || request.method() !== 'GET' || request.isNavigationRequest()) return false;
    const type=request.resourceType();
    const extensions={stylesheet:/\.css$/i,script:/\.js$/i,image:/\.(?:png|jpe?g|gif|svg|ico|webp)$/i};
    if (!extensions[type]) return false;
    const url=new URL(request.url()), start=new URL(MYFCU_START_URL);
    if (url.origin!==start.origin || url.username || url.password || !extensions[type].test(url.pathname)) return false;
    const frame=request.frame();if(frame!==page.mainFrame())return false;
    const source=new URL(frame.url());
    if(source.origin!==start.origin || source.username || source.password)return false;
    const login=source.pathname===loginPath && ['starting','login'].includes(phase);
    const history=allowHistory && source.pathname===recordPath && ['history','extracting'].includes(phase) && !source.search && allowedHashes.has(source.hash);
    if(!login && !history)return false;
    let timer;
    try {
      const declared = await Promise.race([
        frame.evaluate(async ({target,type})=>{
          const selectors={stylesheet:'link[rel~="stylesheet"][href]',script:'script[src]',image:'img[src],link[rel~="icon"][href]'};
          const declared=()=>[...document.querySelectorAll(selectors[type])].some(node=>{
            try { const value=node.getAttribute('src') || node.getAttribute('href');const actual=new URL(value,document.baseURI);actual.hash='';return actual.href===target; } catch {return false;}
          });
          // Chromium may request preloaded assets before the parser inserts their elements.
          for(let i=0;i<12;i++){if(declared())return true;await new Promise(resolve=>setTimeout(resolve,50));}
          return false;
        },{target:url.href,type}),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);}),
      ]);
      if (!declared) return false;
      const current=new URL(frame.url());
      return current.origin===start.origin && current.pathname===source.pathname && !current.username && !current.password && (current.pathname!==recordPath || (!current.search && allowedHashes.has(current.hash)));
    } finally {clearTimeout(timer);}
  } catch {return false;}
}

// Existing public-only callers retain their original restrictive contract.
export const isDeclaredLoginAsset = (request,page,phase) => isDeclaredMyFcuAsset(request,page,phase);

// Bound repeated blocked history XHR requests without logging URLs or bodies.
export function createHistoryPostRetryGuard(limit=12) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('invalid limit');
  const key=crypto.randomBytes(32),counts=new Map();
  return { record({url,sourceUrl,method,resourceType,navigation,mainFrame}) {
    try {
      const target=new URL(url),source=new URL(sourceUrl);
      if(method!=='POST' || resourceType!=='xhr' || navigation || !mainFrame || target.origin!=='https://myfcu.fcu.edu.tw' || target.username || target.password || source.origin!==target.origin || source.pathname!==recordPath || source.username || source.password)return {tracked:false,stop:false};
      const id=crypto.createHmac('sha256',key).update(target.origin).update('\0').update(target.pathname).digest('hex');
      if(!counts.has(id) && counts.size>=100)return {tracked:true,stop:true,count:limit};
      const count=(counts.get(id)??0)+1;counts.set(id,count);
      return {tracked:true,stop:count>=limit,count};
    } catch {return {tracked:false,stop:false};}
  }};
}
