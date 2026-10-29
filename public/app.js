
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let isAdmin=false,staff=false,users=[],me=null,view='verify';

/* ---- core rules ---- */
const makeId=n=>'JW26.'+String(n).padStart(3,'0');
const addMonths=(iso,m)=>{const d=new Date(iso);d.setMonth(d.getMonth()+m);return d.toISOString()};
const info=u=>{const left=u.daysLeft!==undefined?u.daysLeft:Math.ceil((new Date(u.expiresAt)-Date.now())/864e5);return{active:left>0,left}};
const pill=u=>{const i=info(u);return i.active?`<span class="pill ${i.left<=30?'soon':'on'}">● Active${i.left<=30?' · expires soon':''}</span>`:`<span class="pill off">● Inactive</span>`};
const byId=id=>users.find(u=>u.id.toLowerCase()===String(id).trim().toLowerCase());
async function api(method,url,body){
  const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  let d=null;try{d=await r.json()}catch(e){}
  if(!r.ok)throw{message:(d&&d.error)||'Request failed ('+r.status+')',code:r.status};
  return d;
}
async function loadUsers(){users=await api('GET','/api/users')}
async function lookup(id){const x=String(id).trim();if(!/^JW26\.\d{3,}$/i.test(x))return null;try{return await api('GET','/api/verify/'+encodeURIComponent(x))}catch(e){if(e.code===404)return null;throw e}}

async function register(f){const u=await api('POST','/api/users',f);users.unshift(u);return u}

/* ---- QR ---- */
function qr(el,text,size=200){el.innerHTML='';try{new QRCode(el,{text,width:size,height:size,colorDark:'#0E1F3D',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H})}catch(e){el.textContent='QR unavailable — ID: '+text}}
function saveQr(el,id){const cv=el.querySelector('canvas');if(!cv)return;const a=document.createElement('a');a.href=cv.toDataURL('image/png');a.download=id+'-QR.png';document.body.appendChild(a);a.click();a.remove()}

/* ---- nav ---- */
function nav(){
  const t=!staff?[['verify','Verify status'],['login','Staff login']]:[['register','Register'],['profile','Profile'],['verify','Verify'],['admin',isAdmin?'Admin':'Users'],['logout','Log out']];
  $('#nav').innerHTML=t.map(([k,l])=>`<button data-v="${k}" ${k===view?'aria-current="page"':''}>${l}</button>`).join('');
  $('#nav').onclick=e=>{const v=e.target.dataset.v;if(v)go(v)};
}
function go(v,arg){if(!staff&&v!=='login')v='verify';view=v;nav();({register:vRegister,profile:async()=>{try{await loadUsers()}catch(e){}vProfile()},verify:()=>vVerify(arg),admin:async()=>{try{await loadUsers()}catch(e){}vAdmin()},login:vLogin,logout:async()=>{try{await api('POST','/api/logout')}catch(e){}location.reload()}})[v]();window.scrollTo(0,0)}

/* ---- views ---- */
function vRegister(){
  $('#app').innerHTML=`
  <div class="grid g2" style="align-items:start">
    <div><h1>Register</h1><p class="sub">Create your account to receive a unique JW26 ID and a personal QR code. Membership stays active for 12 months from registration.</p>
      <div class="card"><form id="f" novalidate>
        <label for="n">Full name</label><input id="n" autocomplete="name" required>
        <label for="e">Email</label><input id="e" type="email" autocomplete="email" required>
        <label for="p">Phone</label><input id="p" type="tel" autocomplete="tel" required>
        <label for="pl">Plate No.</label><input id="pl" autocapitalize="characters" autocomplete="off" placeholder="e.g. ABC-123DE" required>
        <div id="er" class="err" role="alert"></div>
        <button class="btn" id="sb" style="width:100%;margin-top:18px">Create account</button>
      </form></div></div>
    <div class="card"><h2 style="font-size:1.05rem">How it works</h2>
      <dl style="margin-top:14px;grid-template-columns:28px 1fr"><dt>1</dt><dd>Register with your details</dd><dt>2</dt><dd>Receive your unique ID (JW26.001, JW26.002 …)</dd><dt>3</dt><dd>Download your QR code</dd><dt>4</dt><dd>Show it to be verified — active for 12 months</dd></dl></div>
  </div>`;
  $('#f').onsubmit=async e=>{
    e.preventDefault();const er=$('#er');er.textContent='';
    const f={name:$('#n').value.trim(),email:$('#e').value.trim(),phone:$('#p').value.trim(),plate:$('#pl').value.trim().toUpperCase().replace(/\s+/g,' ')};
    if(f.name.length<2)return er.textContent='Please enter your full name.';
    if(!/^\S+@\S+\.\S+$/.test(f.email))return er.textContent='Please enter a valid email address.';
    if(f.phone.replace(/\D/g,'').length<7)return er.textContent='Please enter a valid phone number.';
    if(f.plate.replace(/[^A-Z0-9]/g,'').length<4)return er.textContent='Plate No. is required. Please enter a valid plate number.';
    if(users.some(u=>u.email.toLowerCase()===f.email.toLowerCase()))return er.textContent='This email is already registered.';
    $('#sb').disabled=true;$('#sb').textContent='Creating…';
    let u;
    try{u=await Promise.race([register(f),new Promise((_,r)=>setTimeout(()=>r({message:'Saving timed out. Please try again.'}),20000))])}
    catch(x){er.textContent=(x&&x.message?x.message:'Registration failed.')+(x&&x.code?' ['+x.code+']':'');$('#sb').disabled=false;$('#sb').textContent='Create account';return}
    me=u.id;vSuccess(u);
  };
}
function vSuccess(u){
  $('#app').innerHTML=`<div class="card center" style="max-width:480px;margin:0 auto"><span class="pill on">✓ Registration complete</span>
    <p class="sub" style="margin:14px auto 6px">Welcome, ${esc(u.name)}. Your unique ID is</p><div class="uid">${esc(u.id)}</div>
    <div style="margin:22px 0"><div class="qr" id="q"></div></div>
    <p class="sub" style="margin:0 auto 16px">Plate No. <b>${esc(u.plate||'—')}</b> · Active until ${fmt(u.expiresAt)}</p>
    <div class="row" style="justify-content:center"><button class="btn" id="d">Download QR</button><button class="btn ghost" id="cb">Certificate (PDF)</button><button class="btn ghost" id="pf">View profile</button></div></div>`;
  qr($('#q'),u.id);$('#d').onclick=()=>saveQr($('#q'),u.id);$('#pf').onclick=()=>go('profile');$('#cb').onclick=()=>openCert(u.id);
}
function vProfile(){
  const u=me&&byId(me);
  if(!u)return $('#app').innerHTML=`<h1>My profile</h1><p class="sub">Enter your ID to open your profile.</p><div class="card" style="max-width:420px"><label for="i">Your ID</label><input id="i" placeholder="JW26.001"><button class="btn" id="g" style="margin-top:16px;width:100%">Open profile</button><div id="er" class="err"></div></div>`,
    $('#g').onclick=()=>{const x=byId($('#i').value);if(x){me=x.id;vProfile()}else $('#er').textContent='No account found for that ID.'};
  const i=info(u);
  $('#app').innerHTML=`<h1>My profile</h1><p class="sub">Your membership details and QR code.</p>
  <div class="grid g2" style="align-items:start"><div class="card"><div class="row" style="justify-content:space-between"><div class="uid" style="font-size:1.8rem">${esc(u.id)}</div>${pill(u)}</div>
    <dl style="margin-top:20px"><dt>Name</dt><dd>${esc(u.name)}</dd><dt>Email</dt><dd>${esc(u.email)}</dd><dt>Phone</dt><dd>${esc(u.phone)}</dd><dt>Plate No.</dt><dd>${esc(u.plate||'—')}</dd><dt>Registered</dt><dd>${fmt(u.registeredAt)}</dd><dt>Expires</dt><dd>${fmt(u.expiresAt)}</dd><dt>Time left</dt><dd>${i.active?i.left+' days':'Expired'}</dd></dl></div>
    <div class="card center"><div class="qr" id="q"></div><p class="sub" style="margin:12px auto">Scan to verify ${esc(u.id)}</p><div class="row" style="justify-content:center"><button class="btn" id="d">Download QR</button><button class="btn ghost" id="cb">Certificate (PDF)</button></div><div class="row" style="justify-content:center;margin-top:10px"><button class="btn ghost" id="eb">Edit details</button><button class="btn ghost" id="rb">Renew 12 months</button></div></div></div>`;
  qr($('#q'),u.id);$('#d').onclick=()=>saveQr($('#q'),u.id);$('#cb').onclick=()=>openCert(u.id);$('#eb').onclick=()=>editUser(u.id);$('#rb').onclick=()=>renewUser(u.id);
}
function vVerify(pre){
  $('#app').innerHTML=`<h1>Verify status</h1><p class="sub">Enter or scan a JW26 ID to check whether the member is active.</p>
  <div class="card" style="max-width:560px"><form id="vf" class="row" style="flex-wrap:nowrap"><input id="vi" placeholder="JW26.001" autocapitalize="characters" autocomplete="off" aria-label="User ID"><button class="btn">Check</button></form></div><div id="vr"></div>`;
  const run=async id=>{if(!id.trim()){$('#vr').innerHTML='';return}$('#vr').innerHTML='<p class="sub" style="margin-top:16px">Checking…</p>';let u;try{u=await lookup(id)}catch(e){$('#vr').innerHTML=`<div class="vres nf" role="status"><h2>Please try again</h2><p>${esc(e.message)}</p></div>`;return}$('#vr').innerHTML=!id.trim()?'':!u?`<div class="vres nf" role="status"><h2>Not found</h2><p>No registered user matches “${esc(id)}”.</p></div>`:
    info(u).active?`<div class="vres on" role="status"><h2>✓ Active</h2><p><b>${esc(u.name)}</b> · ${esc(u.id)}<br>Plate No. ${esc(u.plate||'—')}<br>Valid until ${fmt(u.expiresAt)} (${info(u).left} days left)</p></div>`:
    `<div class="vres off" role="status"><h2>✕ Inactive</h2><p><b>${esc(u.name)}</b> · ${esc(u.id)}<br>Plate No. ${esc(u.plate||'—')}<br>Membership expired on ${fmt(u.expiresAt)}</p></div>`};
  $('#vf').onsubmit=e=>{e.preventDefault();run($('#vi').value)};
  if(pre){$('#vi').value=pre;run(pre)}else $('#vi').focus();
}
function vAdmin(){
  const a=users.filter(u=>info(u).active).length;
  $('#app').innerHTML=`<h1>Admin dashboard</h1><p class="sub">Manage registered users and check status. Status updates automatically when 12 months pass.</p>
  <div class="grid g3"><div class="card stat"><b>${users.length}</b><span>Total users</span></div><div class="card stat"><b style="color:var(--ok)">${a}</b><span>Active</span></div><div class="card stat"><b style="color:var(--bad)">${users.length-a}</b><span>Inactive</span></div></div>
  <div class="tools"><input id="s" placeholder="Search name, email or ID" aria-label="Search"><select id="fl" aria-label="Filter"><option value="">All</option><option value="a">Active</option><option value="i">Inactive</option></select><button class="btn ghost" id="ex">Export CSV</button></div>
  <div class="tw"><table><thead><tr><th>ID</th><th>Name</th><th>Plate No.</th><th>Email</th><th>Registered</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const draw=()=>{const q=$('#s').value.toLowerCase(),f=$('#fl').value;
    const l=users.filter(u=>(!f||(f==='a')===info(u).active)&&(u.name+u.email+u.id+(u.plate||'')).toLowerCase().includes(q)).sort((x,y)=>y.seq-x.seq);
    $('#tb').innerHTML=l.length?l.map(u=>`<tr><td><b>${esc(u.id)}</b></td><td>${esc(u.name)}</td><td>${esc(u.plate||'—')}</td><td>${esc(u.email)}</td><td>${fmt(u.registeredAt)}</td><td>${fmt(u.expiresAt)}</td><td>${pill(u)}</td><td class="acts"><button class="link" data-edit="${esc(u.id)}">Edit</button><button class="link" data-renew="${esc(u.id)}">Renew</button><button class="link" data-cert="${esc(u.id)}">Certificate</button><button class="link" data-id="${esc(u.id)}">Verify</button>${isAdmin?`<button class="link" data-del="${esc(u.id)}" style="color:var(--bad)">Delete</button>`:''}</td></tr>`).join(''):'<tr><td colspan="8" style="text-align:center;color:var(--mut);padding:30px">No users found</td></tr>'};
  draw();$('#s').oninput=draw;$('#fl').onchange=draw;
  $('#tb').onclick=e=>{const t=e.target.dataset;if(t.id)go('verify',t.id);if(t.del)confirmDelete(t.del);if(t.edit)editUser(t.edit);if(t.renew)renewUser(t.renew);if(t.cert)openCert(t.cert)};
  $('#ex').onclick=async()=>{const q=v=>'"'+String(v??'').replace(/^([=+\-@\t\r])/,"'$1").replace(/"/g,'""')+'"';const csv='ID,Name,Plate No.,Email,Phone,Registered,Expires,Status\n'+users.map(u=>[u.id,u.name,u.plate||'',u.email,u.phone,u.registeredAt,u.expiresAt,info(u).active?'Active':'Inactive'].map(q).join(',')).join('\n');try{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='jw26-users.csv';a.click()}catch(e){}};
}

function confirmDelete(id){
  const u=byId(id);if(!u)return;
  const o=document.createElement('div');o.className='ov';
  o.innerHTML=`<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dt"><h2 id="dt">Delete ${esc(u.id)}?</h2><p>${esc(u.name)} (Plate ${esc(u.plate||'—')}) will be permanently removed and will no longer verify. This ID will not be reused.</p><div id="de" class="err" role="alert"></div><div class="row" style="margin-top:18px"><button class="btn ghost" id="dc">Cancel</button><button class="btn" id="dy" style="background:#B3261E">Delete user</button></div></div>`;
  document.body.appendChild(o);
  const close=()=>o.remove();
  $('#dc').focus();$('#dc').onclick=close;o.onclick=e=>{if(e.target===o)close()};o.onkeydown=e=>{if(e.key==='Escape')close()};
  $('#dy').onclick=async()=>{
    const b=$('#dy');b.disabled=true;b.textContent='Deleting…';
    try{
      if(!isAdmin)throw {message:'Only admins can delete users.'};
      await api('DELETE','/api/users/'+encodeURIComponent(u.id));
      users=users.filter(x=>x.id!==u.id);if(me===u.id)me=null;close();vAdmin();
    }catch(x){$('#de').textContent=(x&&x.message?x.message:'Delete failed.')+(x&&x.code?' ['+x.code+']':'');b.disabled=false;b.textContent='Delete user'}
  };
}
function modal(html){
  const o=document.createElement('div');o.className='ov';
  o.innerHTML=`<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(o);
  const close=()=>o.remove();
  o.onclick=e=>{if(e.target===o)close()};o.onkeydown=e=>{if(e.key==='Escape')close()};
  return{close};
}
function refresh(){if(view==='admin')vAdmin();else if(view==='profile')vProfile()}
function openCert(id){window.open('/api/users/'+encodeURIComponent(id)+'/certificate','_blank')}
function editUser(id){
  const u=byId(id);if(!u)return;
  const m=modal(`<h2>Edit ${esc(u.id)}</h2><form id="ef" novalidate><label for="en">Full name</label><input id="en" value="${esc(u.name)}"><label for="ep">Phone</label><input id="ep" type="tel" value="${esc(u.phone)}"><label for="el">Plate No.</label><input id="el" autocapitalize="characters" value="${esc(u.plate||'')}"><div id="ee" class="err" role="alert"></div><div class="row" style="margin-top:18px"><button type="button" class="btn ghost" id="ec">Cancel</button><button class="btn" id="es">Save changes</button></div></form>`);
  $('#en').focus();$('#ec').onclick=m.close;
  $('#ef').onsubmit=async e=>{
    e.preventDefault();const er=$('#ee'),b=$('#es');er.textContent='';
    const f={name:$('#en').value.trim(),phone:$('#ep').value.trim(),plate:$('#el').value.trim().toUpperCase().replace(/\s+/g,' ')};
    if(f.name.length<2)return er.textContent='Please enter the full name.';
    if(f.phone.replace(/\D/g,'').length<7)return er.textContent='Please enter a valid phone number.';
    if(f.plate.replace(/[^A-Z0-9]/g,'').length<4)return er.textContent='Plate No. is required. Please enter a valid plate number.';
    b.disabled=true;b.textContent='Saving…';
    try{const r=await api('PATCH','/api/users/'+encodeURIComponent(u.id),f);users=users.map(x=>x.id===r.id?r:x);m.close();refresh()}
    catch(x){er.textContent=x.message;b.disabled=false;b.textContent='Save changes'}
  };
}
function renewUser(id){
  const u=byId(id);if(!u)return;
  const d=new Date(Math.max(new Date(u.expiresAt).getTime(),Date.now()));d.setFullYear(d.getFullYear()+1);
  const m=modal(`<h2>Renew ${esc(u.id)}?</h2><p>${esc(u.name)} (Plate ${esc(u.plate||'—')}) is ${info(u).active?'active until '+fmt(u.expiresAt):'inactive since '+fmt(u.expiresAt)}.<br>Adding 12 months sets the new expiry date to <b>${fmt(d)}</b>.</p><div id="rr" class="err" role="alert"></div><div class="row" style="margin-top:18px"><button class="btn ghost" id="rc">Cancel</button><button class="btn" id="ry">Renew 12 months</button></div>`);
  $('#rc').focus();$('#rc').onclick=m.close;
  $('#ry').onclick=async()=>{
    const b=$('#ry');b.disabled=true;b.textContent='Renewing…';
    try{const r=await api('POST','/api/users/'+encodeURIComponent(u.id)+'/renew');users=users.map(x=>x.id===r.id?r:x);m.close();refresh()}
    catch(x){$('#rr').textContent=x.message;b.disabled=false;b.textContent='Renew 12 months'}
  };
}

function vLogin(){
  $('#app').innerHTML=`<h1>Staff login</h1><p class="sub">Sign in to register and manage users.</p><div class="card" style="max-width:420px"><form id="lf"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required><div id="er" class="err" role="alert"></div><button class="btn" style="width:100%;margin-top:16px">Sign in</button></form></div>`;
  $('#lf').onsubmit=async e=>{e.preventDefault();try{await api('POST','/api/login',{password:$('#pw').value});location.reload()}catch(x){$('#er').textContent=x.message}};
  $('#pw').focus();
}

/* ---- boot ---- */
$('#app').innerHTML='<p class="sub">Loading…</p>';
(async()=>{
  try{const m=await api('GET','/api/me');staff=!!m.role;isAdmin=m.role==='admin'}catch(e){}
  if(staff){try{await loadUsers()}catch(e){}}
  go(staff?'register':'verify');
})();
