/*
 * Exchange identity token'in YAPISINI incelemek icin (E5 / civi #8).
 * Imza BASILMAZ; yalniz header + claim'ler ve uzunluk raporlanir.
 */
const { chromium } = require('playwright');
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER=process.env.OWA_USER, PASS=process.env.OWA_PASS, HINT='ILN-2026-4471';
const NAMES=['Outlook Ajani','Outlook Ajanı','Ajan'];
const findFrame=p=>p.frames().find(f=>(f.url()||'').includes('taskpane.html'));
(async()=>{
 const b=await chromium.launch({headless:true});
 const c=await b.newContext({ignoreHTTPSErrors:true,userAgent:UA,viewport:{width:1680,height:1050},httpCredentials:{username:USER,password:PASS}});
 c.setDefaultTimeout(30000);
 const p=await c.newPage();
 await p.goto('https://mail.example.local/owa',{waitUntil:'domcontentloaded',timeout:60000});
 await p.waitForTimeout(2500);
 if(await p.locator('#username').count()){await p.fill('#username',USER);await p.fill('#password',PASS);
   await Promise.all([p.waitForNavigation({timeout:60000}).catch(()=>{}),p.evaluate(()=>{if(typeof clkLgn==='function')clkLgn();}).catch(()=>{})]);}
 await p.waitForTimeout(5000);
 await p.waitForFunction(h=>document.body&&document.body.innerText.includes(h),HINT,{timeout:90000});
 await p.locator(`text=${HINT}`).first().click({timeout:20000});
 await p.waitForTimeout(6000);
 for(const n of NAMES){const loc=p.locator(`[aria-label*="${n}" i]`);const cnt=await loc.count().catch(()=>0);let d=false;
   for(let i=0;i<cnt;i++){const el=loc.nth(i); if(!(await el.isVisible().catch(()=>false)))continue;
     await el.click({timeout:8000}).catch(()=>{}); await p.waitForTimeout(4000); if(findFrame(p)){d=true;break;}}
   if(d)break;}
 const fr=findFrame(p);
 if(!fr){console.log('panel acilmadi');await b.close();process.exit(1);}
 await p.waitForTimeout(3000);
 const out=await fr.evaluate(()=>new Promise(function(res){
   if(typeof Office==='undefined'||!Office.context||!Office.context.mailbox){res({hata:'Office yok'});return;}
   var t=setTimeout(function(){res({hata:'zaman asimi'});},20000);
   Office.context.mailbox.getUserIdentityTokenAsync(function(r){
     clearTimeout(t);
     if(r.status!=='succeeded'){res({hata:r.error&&r.error.message});return;}
     var tok=r.value, parca=tok.split('.');
     function dec(s){try{return JSON.parse(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'=='.slice(0,(4-s.length%4)%4)));}catch(e){return {cozulemedi:String(e)};}}
     res({tokenHam:tok,uzunluk:tok.length,parcaSayisi:parca.length,header:dec(parca[0]),claims:dec(parca[1]),imzaUzunluk:parca[2]?parca[2].length:0});
   });
 }));
 require("fs").writeFileSync(require("path").join(__dirname,"lab-creds-token.txt"), out.tokenHam || "", "utf8");
 delete out.tokenHam;
 console.log(JSON.stringify(out,null,2));
 await b.close();
})();
