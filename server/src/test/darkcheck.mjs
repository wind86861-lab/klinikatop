import WebSocket from 'ws';
const [, , url, ct, out] = process.argv;
const t = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl, { perMessageDeflate: false });
let seq = 0; const pending = new Map(); const logs = [];
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
ws.on('message', (raw) => { const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') logs.push((m.params.exceptionDetails.exception?.description ?? '').slice(0, 120)); });
await new Promise((r) => ws.once('open', r));
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1100, deviceScaleFactor: 1, mobile: true });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try{localStorage.setItem('klinikatop.web','${ct}');localStorage.setItem('klinikatop.theme','dark')}catch(e){}
  (function(){var calls=[];
    var wa={initData:'',initDataUnsafe:{},version:'7.0',platform:'ios',colorScheme:'dark',themeParams:{},
      isExpanded:true,ready:function(){},expand:function(){},close:function(){},
      HapticFeedback:{impactOccurred:function(){},notificationOccurred:function(){},selectionChanged:function(){}},
      MainButton:{show:function(){},hide:function(){},setText:function(){},onClick:function(){},offClick:function(){},showProgress:function(){},hideProgress:function(){}},
      BackButton:{show:function(){},hide:function(){},onClick:function(){},offClick:function(){}},
      setHeaderColor:function(c){calls.push(['header',c])},setBackgroundColor:function(c){calls.push(['bg',c])},
      onEvent:function(){},offEvent:function(){}};
    var tg={};Object.defineProperty(tg,'WebApp',{value:wa,writable:false,configurable:false});
    Object.defineProperty(window,'Telegram',{value:tg,writable:false,configurable:false});
    window.__tgCalls=calls;})();` });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 7000));
const r = await send('Runtime.evaluate', { returnByValue: true, expression:
  'JSON.stringify({theme:document.documentElement.getAttribute("data-theme"),appBg:getComputedStyle(document.body).backgroundColor,tg:window.__tgCalls})' });
console.log(r.result.value);
console.log('xato:', logs.length ? logs.join(' | ') : 'yoq');
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
(await import('node:fs')).writeFileSync(out, Buffer.from(data, 'base64'));
ws.close();
