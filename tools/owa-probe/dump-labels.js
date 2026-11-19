const { chromium } = require('playwright');
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const USER=process.env.OWA_USER, PASS=process.env.OWA_PASS, HINT='ILN-2026-4471';
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
 await p.waitForTimeout(7000);
 const labels=await p.evaluate(()=>Array.from(document.querySelectorAll('[aria-label],[title]'))
   .filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})
   .map(e=>({t:e.tagName,a:e.getAttribute('aria-label')||'',ti:e.getAttribute('title')||'',x:Math.round(e.getBoundingClientRect().x),y:Math.round(e.getBoundingClientRect().y)}))
   .filter(o=>o.a||o.ti));
 console.log('--- gorunur aria-label/title ('+labels.length+') ---');
 labels.forEach(o=>console.log(`${o.t} @${o.x},${o.y} aria="${o.a}" title="${o.ti}"`));
 await b.close();
})();
