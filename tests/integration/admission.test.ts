import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { buildIdentity, SessionCodec } from '../../backend/watchdog_api/identity';
import { buildAuthRouter, principalMiddleware, requireInstallationAccess, authErrorStatus } from '../../backend/watchdog_api/api/auth_routes';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}) as any,kid:'admission-test',alg:'RS256',use:'sig'};
const audience='admission-test.apps.googleusercontent.com';
const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(email:string,subject=email,claims:Record<string,unknown>={}) {
  const head=b64({alg:'RS256',kid:key.kid});
  const body=b64({iss:'https://accounts.google.com',aud:audience,sub:subject,email,email_verified:true,
    exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),...claims});
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`;
}

async function fixture() {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');runMigrations(db);
  const principals=new PrincipalRepository(db);
  const signingKey=randomBytes(32).toString('hex');
  const identity=await buildIdentity({GOOGLE_OAUTH_CLIENT_ID:audience,WATCHDOG_GRANTS:JSON.stringify({
    'owner@example.test':'developer','operator@example.test':'admin','legacy@example.test':'researcher',
  })},new SecretStore([new EnvSecretProvider({SESSION_SIGNING_KEY:signingKey})]),async()=>({
    ok:true,status:200,text:async()=>JSON.stringify({keys:[key]}),
  }));
  const app=express();app.use(express.json());
  const deps={identity,principals,secureCookies:false};
  app.use(principalMiddleware(deps));app.use('/api/auth',buildAuthRouter(deps));
  app.use('/api',requireInstallationAccess);app.get('/api/private',(_req,res)=>res.json({secret:true}));
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(authErrorStatus(error)??500).json({error:{code:error.code}}));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const request=async(path:string,cookie='',body?:unknown,headers:Record<string,string>={})=>fetch(`${base}${path}`,{
    method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const signin=async(email:string,claims:Record<string,unknown>={})=>{
    const response=await request('/api/auth/session','',{id_token:token(email,email,claims)});
    return {response,cookie:response.headers.get('set-cookie')?.split(';')[0]??'',body:await response.json()};
  };
  return {db,principals,identity,request,signin,signingKey,base,close:async()=>{
    await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();
  }};
}

test('admission: verified applicants never receive application capabilities before owner approval',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.request('/api/private')).status,401);
    const applicant=await f.signin('new@example.test');assert.equal(applicant.response.status,200);
    assert.equal(applicant.body.principal,null);
    assert.equal((await f.request('/api/private',applicant.cookie)).status,401);
    assert.equal((await f.request('/api/auth/me',applicant.cookie)).status,401);
    assert.equal((await f.request('/api/auth/admission/request','',{reason:'Useful research request.'})).status,401);
    assert.equal((await f.request('/api/auth/admission/request',applicant.cookie,{reason:'short'})).status,400);
    const request=await f.request('/api/auth/admission/request',applicant.cookie,{reason:'I would like to study public source changes.'});
    assert.equal(request.status,200);assert.equal(request.headers.get('cache-control'),'no-store');
    const status=await (await f.request('/api/auth/admission/status',applicant.cookie)).json();
    assert.equal(status.status,'pending');assert.equal(status.email,'new@example.test');
    const other=await f.signin('other@example.test');
    assert.equal((await (await f.request('/api/auth/admission/status',other.cookie)).json()).request,null);
    assert.equal((await f.request('/api/auth/admission/admin',applicant.cookie)).status,401);
    const owner=await f.signin('owner@example.test');
    assert.equal((await f.request('/api/auth/admission/grants',owner.cookie,{email:'new@example.test',roles:['researcher','responder'],active:true})).status,200);
    // The admission cookie still cannot access private APIs until an explicit
    // activation issues an application session; it can be activated without
    // trusting a newly supplied email or obtaining another Google token.
    assert.equal((await f.request('/api/private',applicant.cookie)).status,401);
    const activation=await f.request('/api/auth/admission/activate',applicant.cookie,{});assert.equal(activation.status,200);
    const cookie=activation.headers.get('set-cookie')!.split(';')[0];
    const me=await (await f.request('/api/auth/me',cookie)).json();
    assert.deepEqual(me.principal.roles,['researcher','responder']);assert.ok(me.capabilities.includes('responder.lookup'));
    assert.equal((await f.request('/api/private',cookie)).status,200);
  } finally {await f.close();}
});

test('admission: revocation and profile changes affect already signed sessions and override environment grants',async()=>{
  const f=await fixture();
  try {
    const owner=await f.signin('owner@example.test');const legacy=await f.signin('legacy@example.test');
    assert.equal((await f.request('/api/private',legacy.cookie)).status,200);
    await f.request('/api/auth/admission/grants',owner.cookie,{email:'legacy@example.test',roles:['responder'],active:true});
    const changed=await (await f.request('/api/auth/me',legacy.cookie)).json();
    assert.deepEqual(changed.principal.roles,['responder']);assert.ok(!changed.capabilities.includes('run.view'));
    await f.request('/api/auth/admission/grants',owner.cookie,{email:'legacy@example.test',roles:[],active:false});
    assert.equal((await f.request('/api/private',legacy.cookie)).status,401);
    assert.equal((await f.request('/api/auth/me',legacy.cookie)).status,401);
    const again=await f.signin('legacy@example.test');assert.equal(again.body.principal,null);
    assert.equal((await f.request('/api/auth/admission/activate',again.cookie,{})).status,403);
    assert.equal((await f.request('/api/private',again.cookie)).status,401);
    assert.equal((await f.request('/api/auth/admission/grants',owner.cookie,{email:'owner@example.test',roles:[],active:false})).status,409);
    assert.throws(()=>f.db.prepare('DELETE FROM admission_events').run(),/immutable admission event/);
  } finally {await f.close();}
});

test('admission: invitations are single-use email-bound requests, operational admin cannot assign roles',async()=>{
  const f=await fixture();
  try {
    const owner=await f.signin('owner@example.test');const operator=await f.signin('operator@example.test');
    assert.equal((await f.request('/api/auth/admission/grants',operator.cookie,{email:'new@example.test',roles:['developer'],active:true})).status,403);
    const created=await (await f.request('/api/auth/admission/invitations',operator.cookie,{email:'invitee@example.test',message:'Help with public literature review.',roles:['developer']})).json();
    const wrong=await f.signin('wrong@example.test');
    assert.equal((await f.request('/api/auth/admission/invitations/accept',wrong.cookie,{token:created.token})).status,404);
    const invitee=await f.signin('invitee@example.test');
    assert.equal((await f.request('/api/auth/admission/invitations/accept',invitee.cookie,{token:created.token})).status,200);
    assert.equal((await f.request('/api/auth/admission/invitations/accept',invitee.cookie,{token:created.token})).status,404);
    assert.equal((await f.request('/api/private',invitee.cookie)).status,401);
    assert.deepEqual(f.principals.get('google:invitee@example.test')!.roles,[]);
    const listings=await (await f.request('/api/auth/admission/admin',operator.cookie)).json();
    assert.equal(listings.invitations[0].token,undefined);assert.equal(listings.invitations[0].token_hash,undefined);
    const second=await (await f.request('/api/auth/admission/invitations',operator.cookie,{email:'invitee@example.test'})).json();
    await f.request(`/api/auth/admission/invitations/${second.invitation.id}/revoke`,operator.cookie,{});
    assert.equal((await f.request('/api/auth/admission/invitations/accept',invitee.cookie,{token:second.token})).status,404);
    const expired=f.principals.createInvitation('invitee@example.test','',owner.body.principal.id,'2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z');
    assert.equal((await f.request('/api/auth/admission/invitations/accept',invitee.cookie,{token:expired.token})).status,404);
  } finally {await f.close();}
});

test('admission: unverified or misaddressed tokens fail before identity storage and unsigned sessions fail closed',async()=>{
  const f=await fixture();
  try {
    const rejected=await f.signin('private-address@example.test',{email_verified:false});
    assert.equal(rejected.response.status,401);assert.ok(!JSON.stringify(rejected.body).includes('private-address@example.test'));
    assert.equal(f.principals.get('google:private-address@example.test'),undefined);
    const audienceMismatch=await f.signin('new@example.test',{aud:'different-client'});assert.equal(audienceMismatch.response.status,401);
    const proof=new SessionCodec(f.signingKey).sign({sub:'forged',email:'new@example.test',role:null,scope:'admission',exp:Date.now()+60_000});
    assert.equal((await f.request('/api/private',`watchdog_session=${proof}`)).status,401);
    const altered=new SessionCodec(randomBytes(32).toString('hex')).sign({sub:'owner@example.test',email:'owner@example.test',role:'developer',exp:Date.now()+60_000});
    assert.equal((await f.request('/api/private',`watchdog_session=${altered}`)).status,401);
  } finally {await f.close();}
});

test('admission: origin and JSON mutation checks protect sign-in, sign-out, grants and invitations',async()=>{
  const f=await fixture();
  try {
    const owner=await f.signin('owner@example.test');
    const writes:[string,unknown][]=[
      ['/api/auth/session',{id_token:token('attacker@example.test')}],
      ['/api/auth/signout',{}],
      ['/api/auth/admission/grants',{email:'new@example.test',roles:['developer'],active:true}],
      ['/api/auth/admission/invitations',{email:'new@example.test'}],
    ];
    for (const [path,body] of writes) {
      for (const headers of [{Origin:'https://attacker.example.test'}, {Origin:'https://sibling.example.test','Sec-Fetch-Site':'same-site'}, {'Sec-Fetch-Site':'cross-site'}]) {
        const response=await f.request(path,owner.cookie,body,headers);
        assert.equal(response.status,403,path);assert.equal(response.headers.get('set-cookie'),null);
      }
      assert.equal((await f.request(path,owner.cookie,body,{'Content-Type':'application/x-www-form-urlencoded'})).status,415,path);
    }
    assert.equal(f.principals.get('google:attacker@example.test'),undefined);
    assert.equal(f.principals.grant('new@example.test'),undefined);
    assert.equal(f.principals.invitations().length,0);
    assert.equal((await f.request('/api/auth/admission/invitations',owner.cookie,{email:'safe@example.test'},{Origin:f.base,'Sec-Fetch-Site':'same-origin'})).status,201);
  } finally {await f.close();}
});
