import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { SessionCodec } from '../../backend/watchdog_api/identity';

test('admission browser: private deep link, real request approval and revocation, and unsent invitation controls',async()=>{
  const root=mkdtempSync(path.join(tmpdir(),'watchdog-admission-browser-'));
  const dbPath=path.join(root,'db.sqlite'),port=23000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;
  const signingKey=randomBytes(32).toString('hex');
  const server=spawn(process.execPath,['dist/server.cjs'],{detached:true,stdio:'pipe',env:{...process.env,
    PORT:String(port),NODE_ENV:'production',DB_PATH:dbPath,STORE_PATH:path.join(root,'store'),
    WATCHDOG_ALLOW_EPHEMERAL_STORAGE:'true',WATCHDOG_DIAGNOSTICS_MODE:'OFF',
    GOOGLE_OAUTH_CLIENT_ID:'browser-test.apps.googleusercontent.com',SESSION_SIGNING_KEY:signingKey,
    WATCHDOG_GRANTS:JSON.stringify({'owner@example.test':'developer'}),
  }});
  let logs='';server.stdout?.on('data',b=>{logs+=String(b);});server.stderr?.on('data',b=>{logs+=String(b);});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    let ready=false;
    for (let i=0;i<100;i++) {
      try {if((await fetch(base+'/api/auth/config')).ok){ready=true;break;}}catch{/* starting */}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.ok(ready,logs);
    // These cookies represent already verified identities in a test fixture.
    // OIDC signature/claim verification is exercised separately against RSA.
    // Browser interactions below use the real API, database and production UI.
    const update=(operation:(repo:PrincipalRepository)=>void)=>{
      const db=new Database(dbPath);db.pragma('foreign_keys=ON');
      try{operation(new PrincipalRepository(db));}finally{db.close();}
    };
    const at=new Date().toISOString();
    update(repo=>{
      repo.recordIdentity({id:'google:owner',email:'owner@example.test',displayName:'Fixture owner',at});repo.syncRoles('google:owner',['developer']);
      repo.recordIdentity({id:'google:applicant',email:'applicant@example.test',displayName:'Fixture applicant',at});
    });
    const codec=new SessionCodec(signingKey),expiry=Date.now()+60*60*1000;
    browser=await chromium.launch();
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    page.setDefaultTimeout(15000);
    await page.route('https://accounts.google.com/**',route=>route.abort());
    await page.goto(base+'/runs');await page.getByTestId('admission-gate').waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);
    assert.equal((await fetch(base+'/api/runs')).status,401);
    await context.addCookies([{name:'watchdog_session',value:codec.sign({sub:'applicant',email:'applicant@example.test',role:null,scope:'admission',exp:expiry}),url:base,httpOnly:true,sameSite:'Lax'}]);
    await page.reload();await page.getByText('Verified account:',{exact:false}).waitFor();
    await page.getByLabel('How do you intend to use WatchDog?',{exact:true}).fill('Study publicly available source changes in a fixture research project.');
    await page.getByRole('button',{name:'Submit request',exact:true}).click();
    await page.getByText("Your request is awaiting the owner's approval.",{exact:true}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);
    update(repo=>{
      assert.equal(repo.requestFor('google:applicant')?.status,'pending');
      repo.setGrant('applicant@example.test',['researcher'],true,'google:owner',new Date().toISOString());
    });
    await page.getByRole('button',{name:'Check approval',exact:true}).click();
    await page.getByRole('button',{name:'Enter workspace',exact:true}).click();
    await page.getByRole('navigation',{name:'Main navigation'}).waitFor();
    // Chromium treats loopback as a trusted context for production Secure
    // cookies; its standalone request client uses a stricter HTTP cookie jar.
    assert.equal(await page.evaluate(async()=>(await fetch('/api/runs')).status),200);
    update(repo=>repo.setGrant('applicant@example.test',[],false,'google:owner',new Date().toISOString()));
    await page.reload();await page.getByTestId('admission-gate').waitFor();
    await page.getByText('Access has been revoked.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).count(),0);
    assert.equal(await page.evaluate(async()=>(await fetch('/api/runs')).status),401);
    await context.clearCookies();
    await context.addCookies([{name:'watchdog_session',value:codec.sign({sub:'owner',email:'owner@example.test',role:'developer',exp:expiry}),url:base,httpOnly:true,sameSite:'Lax'}]);
    await page.goto(base+'/settings/access');await page.getByTestId('access-admin').waitFor();
    await page.getByLabel('Email',{exact:true}).fill('invitee@example.test');
    await page.getByLabel('Invitation context',{exact:true}).fill('Fixture invitation for public literature review.');
    await page.getByRole('button',{name:'Create invitation',exact:true}).click();
    const link=page.getByLabel('Invitation link (shown only now)',{exact:true});await link.waitFor();
    assert.match(await link.inputValue(),/\?invite=/);
    await page.getByRole('button',{name:'Revoke link',exact:true}).click();
    await page.getByText('Invitation link revoked.',{exact:false}).waitFor();
    const layout=await page.locator('main').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
    assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
    mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/admission-admin-mobile.png',fullPage:true});
    await context.close();
  } finally {
    await browser?.close();if(server.pid)try{process.kill(-server.pid,'SIGKILL');}catch{/* exited */}
    rmSync(root,{recursive:true,force:true});
  }
});
