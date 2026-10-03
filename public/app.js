const DAYS=[["sat","شنبه"],["sun","یکشنبه"],["mon","دوشنبه"],["tue","سه‌شنبه"],["wed","چهارشنبه"],["thu","پنج‌شنبه"]];
const SHIFTS=[["m","صبح"],["e","عصر"]];
const DAYN=Object.fromEntries(DAYS), SHN=Object.fromEntries(SHIFTS);
const SPECS=["عمومی","ارتودنسی","کودکان","اندو (ریشه)","جراحی","پریو (لثه)","ایمپلنت","ترمیمی و زیبایی","پروتز"];
const ROLEN={doctor:"دکتر",assistant:"دستیار",reception:"منشی",insurance:"مسئول بیمه",lab:"لابراتوار"};
const fa=n=>Number(n).toLocaleString("fa-IR");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=()=>"r"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const emptyGrid=()=>Object.fromEntries(DAYS.map(([k])=>[k,{m:false,e:false}]));
const SHIFT_HOURS=4; // اپ ساعت دقیق شیفت را ذخیره نمی‌کند؛ برای گزارش ساعت، هر شیفت ۴ ساعت فرض می‌شود.
const faMonth=ts=>new Date(ts).toLocaleDateString("fa-IR-u-ca-persian",{year:"numeric",month:"2-digit"});
const todayISO=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
/* ---------- Jalali (Persian) calendar conversion — pure math, no library ---------- */
const PERSIAN_MONTHS=["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
function gregorianToJalali(gy,gm,gd){
  const g_d_m=[0,31,59,90,120,151,181,212,243,273,304,334];
  const gy2=(gm>2)?(gy+1):gy;
  let days=355666+(365*gy)+(Math.floor((gy2+3)/4))-(Math.floor((gy2+99)/100))+(Math.floor((gy2+399)/400))+gd+g_d_m[gm-1];
  let jy=-1595+(33*Math.floor(days/12053));
  days%=12053;
  jy+=4*Math.floor(days/1461);
  days%=1461;
  if(days>365){ jy+=Math.floor((days-1)/365); days=(days-1)%365; }
  const jm=(days<186)?1+Math.floor(days/31):7+Math.floor((days-186)/30);
  const jd=1+((days<186)?(days%31):((days-186)%30));
  return [jy,jm,jd];
}
function jalaliToGregorian(jy,jm,jd){
  jy+=1595;
  let days=-355668+(365*jy)+(Math.floor(jy/33)*8)+Math.floor(((jy%33)+3)/4)+jd+(jm<7?(jm-1)*31:((jm-7)*30)+186);
  let gy=400*Math.floor(days/146097);
  days%=146097;
  if(days>36524){ gy+=100*Math.floor(--days/36524); days%=36524; if(days>=365) days++; }
  gy+=4*Math.floor(days/1461);
  days%=1461;
  if(days>365){ gy+=Math.floor((days-1)/365); days=(days-1)%365; }
  let gd=days+1;
  const isLeap=y=>(y%4===0&&y%100!==0)||(y%400===0);
  const sal_a=[0,31,isLeap(gy)?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm; for(gm=1;gm<=12;gm++){ const v=sal_a[gm]; if(gd<=v) break; gd-=v; }
  return [gy,gm,gd];
}
function jalaliMonthLength(jy,jm){
  let njy=jy,njm=jm+1; if(njm>12){njm=1;njy++}
  const [gy,gm,gd]=jalaliToGregorian(njy,njm,1);
  const d=new Date(gy,gm-1,gd); d.setDate(d.getDate()-1);
  return gregorianToJalali(d.getFullYear(),d.getMonth()+1,d.getDate())[2];
}
function todayJalali(){ const d=new Date(); return gregorianToJalali(d.getFullYear(),d.getMonth()+1,d.getDate()); }

let db=null, sample=true, downloads=true;
let cfg=null, avail={}, sched=null, archive={}, patients={}, inventory={}, appts={}, loaded={cfg:false,avail:false,sched:false};
let patDraft={openId:null,name:"",text:"",noteText:"",noteErr:"",pending:null,msg:"",iName:"",iAge:"",iNid:"",iPhone:"",iDoc:"",iIns:"",iInsNum:"",iInsCap:"",editingInfo:false}, patErr="", patBusy=false, patMsg="", patListOpen=false;
let invDraft={name:"",unit:"",qty:"",minQty:""}, invErr="";
let apptDraft={name:"",doctor:"",jy:null,jm:null,jd:null,time:"",note:""}, apptErr="", apptMsg="";
let patSearch="", patFilter={doc:"",plan:"",sort:"new"};
let who=(()=>{try{return localStorage.getItem("who")||"manager"}catch(e){return "manager"}})();
let tab="schedule";
let staffDraft={}, staffParse={}, staffBusy=false, staffErr="";
let ruleDraft="", rulePending=null, ruleBusy=false, ruleErr="";
let clinicNameDraft=null;
let nameDraft={}, specDraft={}, rmArm=null, staffMsg="", staffMsgBad=false;

const $=s=>document.querySelector(s);
const byId=id=>cfg?.staff?.find(s=>s.id===id);
const nm=id=>byId(id)?.name||"همکار سابق";
const spec=id=>byId(id)?.specialty||"";
const ofRole=r=>(cfg?.staff||[]).filter(s=>s.role===r);

function errCopy(e){
  const c=e?.code;
  if(c==="not_granted") return "متن فهمیده نشد.";
  if(c==="rate_limited") return "درخواست‌ها زیاد شد. چند ثانیه صبر کنید و دوباره بزنید.";
  if(c==="invalid_json"||c==="empty_completion") return "متن فهمیده نشد. با جمله‌های ساده‌تر دوباره بنویسید.";
  if(c==="cancelled") return "";
  return "متن فهمیده نشد. ساده‌تر بنویسید.";
}

/* ---------- boot ---------- */

/* ---------- insurance (bimeh) ---------- */
function insuranceTab(){const toman=n=>fa(n)+" تومان";
  const list=[];
  for(const [pid,pat] of Object.entries(patients)){
    if(pat.insurance?.name) list.push({patient:pat.name,phone:pat.phone||"-",doctor:nm(pat.doctor),ins:pat.insurance.name,insNum:pat.insurance.number||"-",cap:pat.insurance.cap||0});
  }
  if(!list.length) return `<div class="panel"><p class="note">هنوز بیماری با بیمه ثبت نشده.</p></div>`;
  const byIns={};
  for(const item of list) { byIns[item.ins] = byIns[item.ins] || []; byIns[item.ins].push(item); }
  const sorted=Object.entries(byIns).sort((a,b)=>a[0].localeCompare(b[0],"fa"));
  let h=`<div class="panel"><div class="row" style="justify-content:space-between"><strong>بیماران براساس بیمه</strong><button class="btn" data-act="ins-xlsx">دانلود Excel</button></div></div>`;
  for(const [insName,pts] of sorted){
    const cnt=pts.length, sumCap=pts.reduce((s,p)=>s+(p.cap||0),0);
    const patIds=Object.entries(patients).filter(([_,p])=>p.insurance?.name===insName).map(([id])=>id);
    h+=`<div class="panel"><strong>${esc(insName)}</strong><p class="note" style="margin:4px 0 8px">${fa(cnt)} بیمار · سقف کل: ${toman(sumCap)}</p>
    <div class="scroll"><table class="ins-table"><thead><tr><th>بیمار</th><th>شمارهٔ بیمه</th><th>دکتر</th><th>سقف بیمه</th></tr></thead><tbody>
    ${pts.map(pt=>{const pid=patIds.find(id=>patients[id].name===pt.patient);return `<tr><td>${pid?`<button class="linkbtn" data-pat="${pid}">${esc(pt.patient)}</button>`:`<span>${esc(pt.patient)}</span>`}</td><td class="note">${esc(pt.insNum)}</td><td>${esc(pt.doctor)}</td><td>${toman(pt.cap||0)}</td></tr>`}).join("")}
    </tbody></table></div></div>`;
  }
  return h;
}
async function exportInsXlsx(){
  try{await loadVendor("xlsx")}catch(e){return}
  const list=[];
  for(const [pid,p] of Object.entries(patients)){
    if(p.insurance?.name) list.push({"بیمار":p.name,"بیمه":p.insurance.name,"شمارهٔ بیمه":p.insurance.number||"","دکتر":nm(p.doctor),"سقف بیمه":p.insurance.cap||0});
  }
  const ws=XLSX.utils.json_to_sheet(list);
  ws["!views"]=[{RTL:true}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"بیماران");
  try{await saveFile({filename:`بیمه-${todayISO()}.xlsx`,data:new Blob([XLSX.write(wb,{type:"array",bookType:"xlsx"})])})}catch(e){}
}


(async()=>{
  db=LDB;
  await SYNC.boot();
  SYNC.subscribe(()=>{ if(who==="manager") render(); });
  if(!LDB.hasData()) await seedDemo();
  else{
    if(!LDB.hasAny("patients")) await seedPatientsIfMissing();
    if(!LDB.hasAny("inventory")) await seedInventoryIfMissing();
  }
  { const c=(await LDB.doc("clinic/config").get()).data();
    if(c&&!c.staff.some(x=>x.role==="insurance")){ c.staff.push({id:"i1",name:"کامران",role:"insurance"}); c.usedIds=[...new Set([...(c.usedIds||[]),"i1"])]; await LDB.doc("clinic/config").set(c); }
    if(c&&!c.staff.some(x=>x.role==="lab")){ c.staff.push({id:"l1",name:"دلارام",role:"lab"}); c.usedIds=[...new Set([...(c.usedIds||[]),"l1"])]; await LDB.doc("clinic/config").set(c); } }
  { const INS=[["تامین‌اجتماعی",50e6],["بیمهٔ ملی",40e6],["رازی",60e6],[null,null]]; let n=0;
    for(const d of (await LDB.collection("patients").get()).docs){ const p=d.data(); if("insurance" in p) continue;
      const [name,cap]=INS[n++%INS.length]; p.insurance={name,number:name?String(100000000+Math.floor(Math.random()*9e8)):null,cap};
      await LDB.doc("patients/"+d.id).set(p); } }
  if(!LDB.hasAny("implants")){ cfg=(await LDB.doc("clinic/config").get()).data(); await IMP.seed(); }
  db.doc("clinic/config").onSnapshot(sn=>{cfg=sn.exists?sn.data():null;loaded.cfg=true;render()},()=>{});
  db.collection("avail").onSnapshot(q=>{avail={};q.docs.forEach(x=>avail[x.id]=x.data());loaded.avail=true;render()},()=>{});
  db.doc("clinic/schedule").onSnapshot(sn=>{sched=sn.exists?sn.data():null;loaded.sched=true;render()},()=>{});
  db.collection("requests").onSnapshot(q=>{reqs={};q.docs.forEach(x=>reqs[x.id]=x.data());render()},()=>{});
  db.collection("responses").onSnapshot(q=>{resps={};q.docs.forEach(x=>resps[x.id]=x.data());render()},()=>{});
  db.collection("docpref").onSnapshot(q=>{dprefs={};q.docs.forEach(x=>dprefs[x.id]=x.data());render()},()=>{});
  db.collection("archive").onSnapshot(q=>{archive={};q.docs.forEach(x=>archive[x.id]=x.data());render()},()=>{});
  db.collection("patients").onSnapshot(q=>{patients={};q.docs.forEach(x=>patients[x.id]=x.data());render();if(patDraft.openId&&!$("#sheet").hidden)renderPatientSheet()},()=>{});
  db.collection("inventory").onSnapshot(q=>{inventory={};q.docs.forEach(x=>inventory[x.id]=x.data());render()},()=>{});
  db.collection("appointments").onSnapshot(q=>{appts={};q.docs.forEach(x=>appts[x.id]=x.data());render()},()=>{});
  LAB.start();
  IMP.start();
  Shell.start();
})();

$("#whoSel").addEventListener("change",e=>{who=e.target.value;FB.act("who:"+who);reqErr="";staffErr="";try{localStorage.setItem("who",who)}catch(_){}render()});
{ /* منوی «من:»: فهرست دلخواه با عنوان گروه‌های پررنگ و متن راست‌چین (فهرست خود مرورگر قابل‌کنترل نیست) */
  const btn=$("#whoBtn"), list=$("#whoList");
  const setOpen=o=>{list.hidden=!o;btn.setAttribute("aria-expanded",String(o))};
  btn.addEventListener("click",e=>{e.stopPropagation();setOpen(list.hidden)});
  list.addEventListener("click",e=>{const o=e.target.closest("[data-who]"); if(!o) return; setOpen(false); const sel=$("#whoSel"); sel.value=o.dataset.who; sel.dispatchEvent(new Event("change")); btn.focus()});
  document.addEventListener("click",e=>{if(!list.hidden&&!e.target.closest(".whomenu")) setOpen(false)});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!list.hidden){setOpen(false);btn.focus()}});
}

function renderWho(){
  const sel=$("#whoSel"); if(!cfg) return;
  let h='<option value="manager">مدیر مجموعه</option>';
  for(const r of ["doctor","assistant","reception","insurance","lab"]){
    h+=`<optgroup label="${r==="insurance"?"مسئول بیمه":r==="lab"?"لابراتوار":ROLEN[r]+"ها"}">`+ofRole(r).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("")+"</optgroup>";
  }
  if(sel.dataset.sig!==h){sel.innerHTML=h;sel.dataset.sig=h}
  if(who!=="manager"&&!byId(who)) who="manager";
  sel.value=who;
  const grp=r=>r==="insurance"?"مسئول بیمه":r==="lab"?"لابراتوار":ROLEN[r]+"ها";
  const opt=(id,name)=>`<button type="button" class="opt" role="option" data-who="${id}" aria-selected="${who===id}">${esc(name)}</button>`;
  let lh=opt("manager","مدیر مجموعه");
  for(const r of ["doctor","assistant","reception","insurance","lab"]) lh+=`<div class="grp" role="presentation">${grp(r)}</div>`+ofRole(r).map(s=>opt(s.id,s.name)).join("");
  const L=$("#whoList"); if(L.dataset.sig!==lh){L.innerHTML=lh;L.dataset.sig=lh}
  $("#whoCur").textContent=who==="manager"?"مدیر مجموعه":nm(who);
}

function render(){
  if(!loaded.cfg||!loaded.avail||!loaded.sched) return;
  const app=$("#app");
  if(!cfg){app.innerHTML='<div class="panel">هنوز کارکنان تعریف نشده‌اند.</div>';return}
  renderWho();
  app.innerHTML = who==="manager"?managerView():staffView(who);
  syncStaffPage();
  bind();
}

/* ---------- staff view ---------- */
function gridHtml(grid,editable,prefix){
  let h='<div class="grid"><span></span>'+SHIFTS.map(([,n])=>`<span class="h">${n}</span>`).join("");
  for(const [k,n] of DAYS){
    h+=`<span class="d">${n}</span>`;
    for(const [sk,sn] of SHIFTS){
      const on=!!grid?.[k]?.[sk];
      h+= editable
        ? `<button class="cell" data-cell="${prefix}|${k}|${sk}" aria-pressed="${on}" aria-label="${n} ${sn}">${on?"هستم":"—"}</button>`
        : `<span class="cell" aria-pressed="${on}" style="cursor:default">${on?"هستم":"—"}</span>`;
    }
  }
  return h+"</div>";
}

function myShifts(id){
  if(!sched) return null;
  const out=[];
  for(const [k,n] of DAYS) for(const [sk,sn] of SHIFTS){
    const sl=sched.slots?.[k+"_"+sk]; if(!sl) continue;
    for(const p of sl.pairs||[]){
      if(p.d===id) out.push(`${n} ${sn}${p.u?"، یونیت "+fa(p.u):""}، با ${p.a?nm(p.a):"— بدون دستیار"}`);
      if(p.a===id) out.push(`${n} ${sn}${p.u?"، یونیت "+fa(p.u):""}، با ${nm(p.d)}`);
    }
    if((sl.reception||[]).includes(id)) out.push(`${n} ${sn}، پذیرش`);
    if((sl.free||[]).includes(id)) out.push(`${n} ${sn}، آنکال (حضوری نه؛ اگر لازم شد خبرت می‌کنیم)`);
  }
  return out;
}

/* پورتال افراد: صفحهٔ اصلی فقط هشدارها و چند دکمه است؛ هر دکمه یک برگهٔ تمام‌صفحه باز می‌کند */
let staffPage=null, staffPageWho=null;
function staffAvailHtml(id){
  const a=avail[id], p=staffParse[id];
  if(a?.confirmed && !p){
    return `<div class="panel"><p class="okline">حضور هفته بعدت ثبت شد.</p>${a.summary?`<p class="note">${esc(a.summary)}</p>`:""}${gridHtml(a.grid,false)}
      <p class="row" style="margin-top:12px"><button class="btn" data-act="staff-redo">تغییر حضور</button></p></div>`+requestPanel(id);
  }
  if(!p){
    return `<p class="lead">بنویس هفته بعد کدام روزها و شیفت‌ها هستی. لازم نیست فرم پر کنی؛ عادی بنویس.</p>
    <div class="panel">
      <label for="staffTxt" class="note">حضور هفته بعد</label>
      <textarea id="staffTxt" placeholder="مثلاً: شنبه و دوشنبه هستم، سه‌شنبه فقط صبح، پنج‌شنبه نیستم.">${esc(staffDraft[id]??a?.text??"")}</textarea>
      ${staffErr?`<p class="warn">${esc(staffErr)}</p>`:""}
      <p class="row" style="margin-top:10px"><button class="btn primary" data-act="staff-parse" ${staffBusy||!sample?"disabled":""}>${staffBusy?"در حال فهمیدن متن…":"بررسی متن"}</button>
      ${!sample?`<p class="note">فهمیدن متن در این نمایش در دسترس نیست.</p>`:""}
    </div>`;
  }
  return `<div class="panel pending">
    <strong>این‌طور فهمیدم. اگر درست نیست، روی خانه‌ها بزن تا عوضش کنی.</strong>
    ${p.summary?`<p class="note">${esc(p.summary)}</p>`:""}
    ${p.unclear?.length?`<p class="warn">مطمئن نبودم: ${p.unclear.map(esc).join("؛ ")}</p>`:""}
    ${gridHtml(p.grid,true,"s")}
    <p class="row" style="margin-top:12px">
      <button class="btn primary" data-act="staff-confirm">تأیید و ارسال</button>
      <button class="btn quiet" data-act="staff-back">ویرایش متن</button>
    </p></div>`;
}
function staffPages(id){
  const pages=[], add=(key,title,html,o={})=>{ if(html&&String(html).trim()) pages.push({key,title,html,...o}) };
  const a=avail[id], p=staffParse[id], ms=myShifts(id);
  add("shifts","شیفت‌های من",ms?`<div class="panel"><strong>شیفت‌های تو ${sched.published?`(نسخه ${fa(sched.rev||1)})`:`<span class="note">(پیش‌نویس؛ هنوز مدیر تأیید و ارسال نکرده)</span>`}</strong>`+
      (ms.length?`<ul>${ms.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:`<p class="note">در این برنامه شیفتی برایت نیست.</p>`)+
      (sched.published?`<p class="note" style="margin:8px 0 4px">برنامه کامل کلینیک:</p><div class="row">${exportBtns()}</div>`:"")+`${exportMsg?`<p class="warn" style="margin-top:8px">${esc(exportMsg)}</p>`:""}</div>`+monthPanel(id):"");
  const done=!!a?.confirmed&&!p;
  add("avail","حضور هفته بعد",staffAvailHtml(id)+myRequestsPanel(id),{attn:!done,sub:done?"ثبت شد":"هنوز نفرستادی"});
  add("patients","بیماران من",patientsPanel(id));
  add("intake","پذیرش بیمار جدید",patientIntakePanel(id));
  add("appts","نوبت‌ها",apptDoctorPanel(id)+apptAssistantPanel(id)+apptBookingPanel(id));
  const nl=LAB.badge(); add("lab","لابراتوار",LAB.staffPanel(id),{badge:nl});
  add("implant","ایمپلنت",IMP.staffPanel(id));
  return pages;
}
function staffView(id){
  const me=byId(id);
  let h=`<h2>سلام ${esc(me.name)}</h2>`;
  if(me.role==="insurance") return h+insuranceTab();
  if(me.role==="lab") return h+LAB.portal(id);
  h+=noticesPanel(id)+confirmPanel(id)+doctorSubPanel(id)+coverPanel(id);
  h+=`<div class="tiles">`+staffPages(id).map(pg=>`<button class="tile ${pg.attn?"attn":""}" data-page="${pg.key}">${pg.badge?`<span class="bd">${fa(pg.badge)}</span>`:""}${esc(pg.title)}${pg.sub?`<small>${pg.sub}</small>`:""}</button>`).join("")+`</div>`;
  return h;
}
function openStaffPage(key){
  const pg=who!=="manager"&&staffPages(who).find(x=>x.key===key); if(!pg) return;
  staffPage=key; staffPageWho=who;
  Shell.sheet(`<div class="pagehead"><button class="btn quiet" data-close-sheet>‹ بازگشت</button><strong>${esc(pg.title)}</strong></div><div id="pageBody">${pg.html}</div>`,null,{page:true,onClose:()=>{staffPage=null}});
  bind();
}
/* بعد از هر render، برگهٔ بازِ پورتال هم نو می‌شود (بدون پرش اسکرول) */
function syncStaffPage(){
  if(!staffPage) return;
  if(who==="manager"||staffPageWho!==who){ Shell.close(); return; }
  const pg=staffPages(who).find(x=>x.key===staffPage);
  if(!pg){ Shell.close(); return; }
  if(!Shell.refresh(pg.html)) staffPage=null;
}

async function staffParseRun(){
  const id=who, me=byId(id), text=(staffDraft[id]??"").trim();
  if(!text){staffErr="اول چیزی بنویس.";render();return}
  staffBusy=true;staffErr="";render();

  try{
    const r=NLU.availability(text); FB.nlu("availability",text,r);
    const g=emptyGrid();
    for(const [k] of DAYS) for(const [sk] of SHIFTS) g[k][sk]=r?.grid?.[k]?.[sk]===true;
    staffParse[id]={grid:g,orig:structuredClone(g),text,summary:String(r?.summary||""),unclear:[...(r.unclear||[]),...(r.misses||[]).map(m=>`این بخش را نفهمیدم: «${m}»`)].slice(0,6)};
  }catch(e){staffErr=errCopy(e)}
  staffBusy=false;render();
}

async function staffConfirm(){
  const id=who,p=staffParse[id];
  if(p.orig&&JSON.stringify(p.orig)!==JSON.stringify(p.grid)) FB.correction("availability",p.text,p.orig,p.grid);
  try{
    await db.doc("avail/"+id).set({staffId:id,text:staffDraft[id]??"",grid:p.grid,summary:p.summary,confirmed:true,updatedAt:Date.now()});
    delete staffParse[id]; render();
  }catch(e){staffErr="ذخیره نشد. دوباره بزن.";render()}
}

/* ---------- staff requests (after submitting) ---------- */
let reqDraft={}, reqPlan={}, reqBusy=false, reqErr="";
function requestPanel(id){
  const me=byId(id), isDoc=me.role==="doctor", pl=reqPlan[id];
  let h="";
  if(isDoc){
    const pr=(cfg.pairings?.[id]||[]).map(nm).join("، ")||"تعریف نشده";
    h+=`<div class="panel"><strong>تنظیمات همیشگی من</strong><p style="margin:6px 0 0">${esc(unitTxt(id))}<br>دستیارها: ${esc(pr)}</p></div>`;
  }
  h+=`<div class="panel ${pl?"pending":""}">`;
  if(!pl){
    const ph=isDoc?"مثلاً: سه‌شنبه صبح نمی‌توانم بیایم. دوشنبه می‌خواهم روی یونیت ۳ باشم. از این به بعد با سارا و نگار کار می‌کنم."
                  :"مثلاً: چهارشنبه عصر نمی‌توانم بیایم. پنج‌شنبه صبح هم می‌توانم بیایم.";
    h+=`<strong>درخواست یا تغییر</strong><p class="note" style="margin:2px 0 8px">${isDoc?"تغییر حضور، یونیت یا دستیار. سیستم می‌گوید شدنی است یا نه.":"تغییر حضور در طول هفته. سیستم اثرش را روی برنامه نشان می‌دهد."}</p>
      <textarea id="reqTxt" placeholder="${ph}">${esc(reqDraft[id]||"")}</textarea>
      ${reqErr?`<p class="warn">${esc(reqErr)}</p>`:""}
      <p class="row" style="margin-top:10px"><button class="btn primary" data-act="req-parse" ${reqBusy||!sample?"disabled":""}>${reqBusy?"در حال بررسی…":"بررسی"}</button></p>`;
  }else{
    const okN=pl.report.filter(r=>r.ok).length;
    h+=`<strong>نتیجه بررسی</strong><ul class="clean issues">${pl.report.map(r=>`<li style="color:${r.ok?"var(--ok)":"var(--warn)"}">${r.ok?"✓":"✗"} ${esc(r.text)}</li>`).join("")}</ul>
      <p class="row" style="margin-top:10px"><button class="btn primary" data-act="req-apply" ${okN?"":"disabled"}>${okN?"اعمال موارد شدنی":"چیزی برای اعمال نیست"}</button><button class="btn quiet" data-act="req-cancel">لغو</button></p>`;
  }
  return h+`</div>`;
}

async function reqParseRun(){
  const id=who, me=byId(id), text=(reqDraft[id]||"").trim(); if(!text){reqErr="اول چیزی بنویس.";render();return}
  reqBusy=true;reqErr="";render();
  const isDoc=me.role==="doctor";

  try{
    const r=NLU.request(text,id,cfg.staff); FB.nlu("request",text,r);
    reqPlan[id]=planRequest(id,Array.isArray(r?.actions)?r.actions:[],Array.isArray(r?.rejected)?r.rejected.map(String):[]);
  }catch(e){reqErr=errCopy(e)}
  reqBusy=false;render();
}

function planRequest(me,actions,rejected){
  const st={cfg:structuredClone(cfg),grid:structuredClone(avail[me]?.grid||emptyGrid()),sched:sched?structuredClone(sched):null};
  const report=rejected.map(t=>({ok:false,text:t}));
  const role=byId(me).role, isDoc=role==="doctor", chairs=st.cfg.settings.chairs;
  const UNITS=Array.from({length:chairs},(_,i)=>i+1);
  const dayOk=d=>d==null||DAYN[d], shOk=x=>x==null||SHN[x];
  const slotsOf=(d,x)=>DAYS.filter(([k])=>!d||k===d).flatMap(([k])=>SHIFTS.filter(([sk])=>!x||sk===x).map(([sk])=>[k,sk]));
  const lab=(k,sk)=>DAYN[k]+" "+SHN[sk];
  const nt=()=>(st.cfg.rules||[]).filter(r=>r.type==="not_together").map(r=>r.ids);
  const peopleOf=sl=>new Set([...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception]);
  const clash=(x,set)=>nt().some(([p,q])=>(p===x&&set.has(q))||(q===x&&set.has(p)));
  const unitRule=d=>(st.cfg.rules||[]).find(r=>r.type==="unit_pref"&&r.staff===d);
  const mgrUnit=d=>{const r=unitRule(d);return r&&r.by!=="self"?r:null};
  const isAvail=(id,k,sk)=>id===me?st.grid[k][sk]:(avail[id]?.confirmed&&avail[id].grid?.[k]?.[sk]);
  const slot=(k,sk)=>st.sched?.slots?.[k+"_"+sk];
  const log=[], notices=[], alerts=[], requests=[];
  const add=(ok,text)=>{report.push({ok,text});if(ok)log.push(text)};
  const notify=(to,text)=>{to=to.filter(x=>x&&x!==me);if(to.length)notices.push({id:uid(),at:Date.now(),to,text})};
  const alarm=(key,text)=>alerts.push({id:uid(),at:Date.now(),key,text,resolved:false});

  for(const a of actions){
    if(a?.op==="availability"&&dayOk(a.day)&&shOk(a.shift)&&typeof a.present==="boolean"){
      for(const [k,sk] of slotsOf(a.day,a.shift)){
        const L=lab(k,sk);
        if(st.grid[k][sk]===a.present) continue;
        st.grid[k][sk]=a.present;
        const sl=slot(k,sk);
        if(!sl){add(true,`${L}: حضورت ${a.present?"اضافه":"برداشته"} شد.`);continue}
        if(!a.present&&inSlot(sl,me)){
          st.grid[k][sk]=true;
          const dup=Object.values(reqs).some(r=>r.who===me&&r.key===k+"_"+sk&&r.status==="pending");
          if(dup){add(true,`${L}: درخواستت قبلاً فرستاده شده و منتظر تأیید مدیر است.`);continue}
          const oc=(role==="doctor"?(sl.spare||[]):(sl.free||[])).filter(x=>byId(x)?.role===role&&x!==me);
          const asked=oc.length?oc:cfg.staff.filter(x=>x.role===role&&x.id!==me&&!inSlot(sl,x.id)).map(x=>x.id);
          const myDoc=role==="assistant"?(sl.pairs.find(p=>p.a===me)?.d||null):null;
          requests.push({id:uid(),who:me,role,key:k+"_"+sk,at:Date.now(),status:"pending",text:reqDraft[me]||"",asked,askedOnCall:oc.length>0,doctor:myDoc});
          add(true,`${L}: درخواست نبودنت برای مدیر فرستاده شد. تا تأیید مدیر، شیفتت سر جایش است. ${oc.length?"از "+oc.map(nm).join("، ")+" که آنکال هستند":"از همکاران هم‌رده‌ات"} پرسیده شد که می‌توانند بیایند یا نه.`);
          continue;
        }
        if(!a.present){
          if(isDoc){
            sl.spare=(sl.spare||[]).filter(x=>x!==me);
            const i=sl.pairs.findIndex(p=>p.d===me);
            if(i<0){add(true,`${L}: حضورت برداشته شد.`);continue}
            const p=sl.pairs[i]; sl.pairs.splice(i,1);
            const ppl=peopleOf(sl);
            const sp=(sl.spare||[]).find(d=>{const r=unitRule(d);return !clash(d,ppl)&&(!r?.allowed?.length||r.allowed.includes(p.u))});
            if(sp){
              sl.spare=sl.spare.filter(x=>x!==sp); ppl.add(sp);
              let as=p.a&&(st.cfg.pairings?.[sp]||[]).includes(p.a)&&!clash(p.a,ppl)?p.a:null;
              if(!as){ if(p.a) sl.free.push(p.a); as=sl.free.find(x=>byId(x)?.role==="assistant"&&(st.cfg.pairings?.[sp]||[]).includes(x)&&!clash(x,ppl))||null; if(as) sl.free=sl.free.filter(x=>x!==as); }
              sl.pairs.push({d:sp,a:as,u:p.u}); sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99));
              notify([sp],`${L}: شما روی یونیت ${fa(p.u)} جایگزین ${nm(me)} شدید${as?"، با "+nm(as):"، فعلاً بدون دستیار"}.`);
              if(as) notify([as],`${L}: با ${nm(sp)} روی یونیت ${fa(p.u)} کار می‌کنی.`);
              if(p.a&&p.a!==as) notify([p.a],`${L}: ${nm(me)} نمی‌آید. فعلاً در فهرست آزاد هستی.`);
              if(!as) alarm(k+"_"+sk,`${L}: ${nm(sp)} جای ${nm(me)} آمد ولی دستیار آزاد ندارد.`);
              add(true,`${L}: از برنامه برداشته شدی. ${nm(sp)} جایگزین تو روی یونیت ${fa(p.u)} شد.`);
            }else{
              if(p.a){sl.free.push(p.a);notify([p.a],`${L}: ${nm(me)} نمی‌آید. فعلاً در فهرست آزاد هستی.`)}
              alarm(k+"_"+sk,`${L}: ${nm(me)} نمی‌آید و یونیت ${fa(p.u)} خالی شد. دکتر جایگزین در دسترس نبود.`);
              add(true,`${L}: از برنامه برداشته شدی. جایگزینی پیدا نشد و به مدیر خبر داده شد.`);
            }
          }else if(role==="assistant"){
            sl.free=sl.free.filter(x=>x!==me);
            const p=sl.pairs.find(p=>p.a===me);
            if(!p){add(true,`${L}: حضورت برداشته شد.`);continue}
            p.a=null;
            const ppl=peopleOf(sl);
            const rep=sl.free.find(x=>byId(x)?.role==="assistant"&&(st.cfg.pairings?.[p.d]||[]).includes(x)&&!clash(x,ppl));
            if(rep){p.a=rep;sl.free=sl.free.filter(x=>x!==rep);notify([rep],`${L}: جای ${nm(me)} با ${nm(p.d)} روی یونیت ${fa(p.u)} کار می‌کنی.`);notify([p.d],`${L}: ${nm(me)} نمی‌آید. ${nm(rep)} دستیار شماست.`);add(true,`${L}: حضورت برداشته شد. ${nm(rep)} جای تو با ${nm(p.d)} کار می‌کند.`)}
            else {notify([p.d],`${L}: ${nm(me)} نمی‌آید و فعلاً دستیار ندارید. مدیر در جریان است.`);alarm(k+"_"+sk,`${L}: ${nm(me)} نمی‌آید و ${nm(p.d)} بدون دستیار ماند.`+((()=>{const f=sl.free.filter(x=>byId(x)?.role==="assistant");return f.length?` ${f.map(nm).join(" و ")} آزادند ولی جزو دستیارهای مجاز ${nm(p.d)} نیستند؛ از «جاهای خالی» می‌توانید با یک کلیک بگذاریدشان.`:" دستیار آزادی نیست."})()));add(true,`${L}: حضورت برداشته شد، ولی جایگزینی پیدا نشد. به مدیر خبر داده شد.`)}
          }else{
            sl.free=sl.free.filter(x=>x!==me);
            if(!sl.reception.includes(me)){add(true,`${L}: حضورت برداشته شد.`);continue}
            sl.reception=sl.reception.filter(x=>x!==me);
            const ppl=peopleOf(sl);
            const rep=sl.free.find(x=>byId(x)?.role==="reception"&&!clash(x,ppl));
            if(rep){sl.reception.push(rep);sl.free=sl.free.filter(x=>x!==rep);notify([rep],`${L}: جای ${nm(me)} در پذیرش هستی.`);add(true,`${L}: حضورت برداشته شد. ${nm(rep)} جای تو در پذیرش است.`)}
            else {alarm(k+"_"+sk,`${L}: ${nm(me)} نمی‌آید و منشی جایگزین پیدا نشد.`);add(true,`${L}: حضورت برداشته شد، ولی منشی جایگزین پیدا نشد. به مدیر خبر داده شد.`)}
          }
        }else{
          if(isDoc){
            const used=new Set(sl.pairs.map(p=>p.u)), r=unitRule(me);
            let cand=UNITS.filter(u=>!used.has(u)&&(!r?.allowed?.length||r.allowed.includes(u)));
            if(r?.preferred?.length) cand.sort((x,y)=>(r.preferred.includes(y)?1:0)-(r.preferred.includes(x)?1:0));
            if(clash(me,peopleOf(sl))){st.grid[k][sk]=true;add(false,`${L}: یک قانون «با هم نباشند» با کسی در این شیفت داری؛ مدیر باید تصمیم بگیرد.`);continue}
            if(sl.pairs.some(p=>p.d===me)){add(true,`${L}: همین حالا در برنامه هستی.`);continue}
            if(!cand.length){sl.spare=[...new Set([...(sl.spare||[]),me])];add(true,`${L}: همه یونیت‌های ${r?.allowed?.length?"مجاز تو":"کلینیک"} پر است. در فهرست ذخیره قرار گرفتی؛ اگر یونیتی خالی شود، خودکار جایگزین می‌شوی.`);continue}
            const ppl=peopleOf(sl);
            const as=sl.free.find(x=>byId(x)?.role==="assistant"&&(st.cfg.pairings?.[me]||[]).includes(x)&&!clash(x,ppl));
            sl.pairs.push({d:me,a:as||null,u:cand[0]}); sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99));
            if(as){sl.free=sl.free.filter(x=>x!==as);notify([as],`${L}: با ${nm(me)} روی یونیت ${fa(cand[0])} کار می‌کنی.`)}
            add(true,`${L}: به برنامه اضافه شدی، یونیت ${fa(cand[0])}${as?"، با "+nm(as):"، ولی فعلاً دستیار آزاد نداری"}.`);
          }else{
            if(!sl.free.includes(me)) sl.free.push(me);
            add(true,`${L}: در فهرست «در دسترس» قرار گرفتی تا مدیر در صورت نیاز شیفت بدهد.`);
          }
        }
      }
      continue;
    }
    if(!isDoc){ if(a?.op) report.push({ok:false,text:"این نوع درخواست فقط برای دکترهاست."}); continue; }

    if(a?.op==="my_units"){
      const U=x=>Array.isArray(x)?[...new Set(x)].filter(u=>Number.isInteger(u)&&u>=1&&u<=chairs).sort((p,q)=>p-q):[];
      const al=U(a.allowed), pr=U(a.preferred).filter(u=>!al.length||al.includes(u));
      if(!al.length&&!pr.length){report.push({ok:false,text:"شماره یونیت معتبر نبود."});continue}
      if(mgrUnit(me)){report.push({ok:false,text:`مدیر یونیت تو را تعیین کرده (${unitTxt(me)}). برای تغییرش باید به مدیر بگویی.`});continue}
      st.cfg.rules=(st.cfg.rules||[]).filter(r=>!(r.type==="unit_pref"&&r.staff===me));
      const rule={id:uid(),type:"unit_pref",staff:me,allowed:al,preferred:pr,by:"self"};
      st.cfg.rules.push(rule);
      add(true,`از این به بعد: ${describe(rule).replace(/^«[^»]*» /,"")}. از ساخت بعدی برنامه اعمال می‌شود.`);
      continue;
    }
    if(a?.op==="my_assistants"&&Array.isArray(a.assistants)&&a.assistants.length&&a.assistants.every(x=>byId(x)?.role==="assistant")){
      const list=[...new Set(a.assistants)];
      const bad=list.filter(x=>nt().some(([p,q])=>(p===me&&q===x)||(q===me&&p===x)));
      if(bad.length){report.push({ok:false,text:`طبق قانون مدیر، با ${bad.map(nm).join("، ")} نمی‌توانی هم‌شیفت باشی.`})}
      const good=list.filter(x=>!bad.includes(x)); if(!good.length) continue;
      st.cfg.pairings=st.cfg.pairings||{}; st.cfg.pairings[me]=good;
      add(true,`از این به بعد دستیارهای تو: ${good.map(nm).join("، ")}. از ساخت بعدی برنامه اعمال می‌شود.`);
      continue;
    }
    if((a?.op==="week_unit"||a?.op==="week_assistant")&&dayOk(a.day)&&shOk(a.shift)){
      if(!st.sched){report.push({ok:false,text:"هنوز برنامه این هفته ساخته نشده. برای همیشه می‌توانی بگویی «از این به بعد…»."});continue}
      const mine=slotsOf(a.day,a.shift).filter(([k,sk])=>slot(k,sk)?.pairs.some(p=>p.d===me));
      if(!mine.length){report.push({ok:false,text:"در این زمان شیفتی در برنامه نداری."});continue}
      for(const [k,sk] of mine){
        const L=lab(k,sk), sl=slot(k,sk), p=sl.pairs.find(p=>p.d===me);
        if(a.op==="week_unit"){
          const u=a.unit;
          if(!Number.isInteger(u)||u<1||u>chairs){add(false,`${L}: یونیت ${fa(u)} وجود ندارد.`);continue}
          if(p.u===u){add(true,`${L}: همین حالا روی یونیت ${fa(u)} هستی.`);continue}
          const m=mgrUnit(me); if(m?.allowed?.length&&!m.allowed.includes(u)){add(false,`${L}: طبق قانون مدیر فقط روی یونیت ${m.allowed.map(fa).join("، ")} کار می‌کنی.`);continue}
          const occ=sl.pairs.find(q=>q.u===u);
          if(occ){const freeU=UNITS.filter(x=>!sl.pairs.some(q=>q.u===x));add(false,`${L}: یونیت ${fa(u)} دست ${nm(occ.d)} است.${freeU.length?" یونیت‌های خالی: "+freeU.map(fa).join("، "):""}`);continue}
          p.u=u; sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99)); if(p.a) notify([p.a],`${L}: یونیت ${nm(me)} به ${fa(u)} تغییر کرد.`); add(true,`${L}: یونیتت به ${fa(u)} تغییر کرد.`);
        }else{
          const as=a.assistant;
          if(byId(as)?.role!=="assistant"){add(false,"دستیار پیدا نشد.");break}
          if(p.a===as){add(true,`${L}: همین حالا با ${nm(as)} هستی.`);continue}
          if(!isAvail(as,k,sk)){add(false,`${L}: ${nm(as)} در این زمان حضور ندارد.`);continue}
          const other=sl.pairs.find(q=>q.a===as);
          if(other){add(false,`${L}: ${nm(as)} با ${nm(other.d)} است.`);continue}
          const ppl=peopleOf(sl); if(p.a) ppl.delete(p.a);
          if(clash(as,ppl)){add(false,`${L}: طبق قانون مدیر، ${nm(as)} نمی‌تواند در این شیفت باشد.`);continue}
          if(p.a) sl.free.push(p.a);
          sl.free=sl.free.filter(x=>x!==as); const prev=p.a; p.a=as;
          notify([as],`${L}: با ${nm(me)} روی یونیت ${fa(p.u)} کار می‌کنی.`); if(prev) notify([prev],`${L}: ${nm(me)} دستیار دیگری انتخاب کرد. فعلاً در فهرست آزاد هستی.`);
          add(true,`${L}: ${nm(as)} دستیار تو شد${prev?" و "+nm(prev)+" آزاد شد":""}.`);
        }
      }
      continue;
    }
    report.push({ok:false,text:"بخشی از درخواست فهمیده نشد."});
  }
  if(!report.length) report.push({ok:false,text:"تغییری در درخواست پیدا نشد."});
  return {st,report,log,notices,alerts,requests};
}

async function reqApply(){
  const id=who, pl=reqPlan[id]; if(!pl) return;
  try{
    const a=avail[id];
    await db.doc("avail/"+id).set({...(a||{staffId:id,text:"",summary:""}),grid:pl.st.grid,confirmed:true,updatedAt:Date.now()});
    if(JSON.stringify(pl.st.cfg)!==JSON.stringify(cfg)) await db.doc("clinic/config").set(pl.st.cfg);
    if(pl.st.sched){
      const s2=pl.st.sched; s2.log=[...(s2.log||[]),{who:id,at:Date.now(),text:reqDraft[id]||"",items:pl.log}].slice(-40);
      const peerN=(pl.requests||[]).flatMap(r=>{
        const out=[{id:uid(),at:Date.now(),to:r.asked,text:`درخواست حضور، ${keyLabel(r.key)}: ${coverWhat(r)}، جای ${nm(r.who)}. ${r.askedOnCall?"تو آنکال هستی؛":""} هستی یا نه؟ جوابت را در بخش «درخواست حضور» بزن.`}];
        if(r.doctor) out.push({id:uid(),at:Date.now(),to:[r.doctor],text:`${keyLabel(r.key)}: ${nm(r.who)} نمی‌تواند بیاید. ${r.asked.length?`از ${r.asked.map(nm).join("، ")} ${r.askedOnCall?"(آنکال) ":""}پرسیده شد؛ جوابشان را در بخش «دستیار جایگزین» می‌بینید و می‌توانید بگویید کدام را ترجیح می‌دهید.`:"فعلاً دستیار آزادی نیست؛ مدیر در جریان است."}`});
        return out;}).filter(n=>n.to.length);
      s2.notices=[...(s2.notices||[]),...pl.notices,...peerN].slice(-80); s2.alerts=[...(s2.alerts||[]),...pl.alerts].slice(-60);
      if(s2.published&&JSON.stringify(s2.slots)!==JSON.stringify(sched.slots)) s2.rev=(s2.rev||1)+1;
      for(const r of (pl.requests||[])) await db.doc("requests/"+r.id).set(r);
      s2.baseConflicts=[...new Set([...(s2.baseConflicts||[]),...checkConflicts(pl.st.cfg,s2).map(x=>x.text)])];
      await db.doc("clinic/schedule").set(s2);
    }
    delete reqPlan[id]; reqDraft[id]="";
  }catch(e){reqErr="ذخیره نشد. دوباره بزن.";delete reqPlan[id]}
  render();
}

/* ---------- manager view ---------- */
/* ---------- shared database (server sync) ---------- */
function syncBar(){
  if(!SYNC.enabled()) return `<div class="panel row" style="justify-content:space-between;align-items:center"><span class="note">اطلاعات فقط روی همین گوشی است.</span><button class="btn" data-act="sync-open">اتصال به سرور کلینیک</button></div>`;
  const st=SYNC.state();
  const txt=st.ok===false?`<span class="warn">${esc(st.err)}</span>`:st.ok?`<span class="okline">همگام با سرور${st.pending?` · ${fa(st.pending)} تغییر در صف ارسال`:""}</span>`:`<span class="note">در حال اتصال…</span>`;
  return `<div class="panel row" style="justify-content:space-between;align-items:center">${txt}<button class="btn quiet" data-act="sync-open">تنظیمات سرور</button></div>`;
}
function syncSheet(msg="",bad=false){
  const on=SYNC.enabled();
  Shell.sheet(`<h2>اطلاعات مشترک کلینیک</h2>
    ${on?`<p>این گوشی به سرور کلینیک وصل است. بیماران، انبار، نوبت‌ها، شیفت‌ها و ایمپلنت با بقیهٔ گوشی‌ها مشترک است.</p>
      <p class="note">عکس‌های اصلی OPG فقط روی گوشی‌ای که آپلود شده‌اند می‌مانند؛ تصویر کوچکشان همه‌جا دیده می‌شود.</p>
      <p class="row"><button class="btn" data-sync="now">همگام‌سازی همین الان</button><button class="btn quiet" data-sync="off">قطع اتصال این گوشی</button></p>`
    :`<p>با رمز کلینیک، این گوشی به سرور وصل می‌شود و اطلاعات بین همهٔ گوشی‌ها مشترک می‌شود.</p>
      <ul><li>اگر سرور خالی باشد، اطلاعات <strong>همین گوشی</strong> روی سرور می‌رود.</li><li>اگر سرور اطلاعات داشته باشد، اطلاعات این گوشی <strong>با اطلاعات سرور جایگزین</strong> می‌شود.</li></ul>
      <label class="note" for="syncPass">رمز کلینیک</label><input type="password" id="syncPass" autocomplete="current-password" style="display:block;width:100%;margin-top:4px">
      <p class="row" style="margin-top:8px"><button class="btn primary" data-sync="connect">اتصال</button></p>`}
    ${msg?`<p class="${bad?"warn":"okline"}">${esc(msg)}</p>`:""}`,root=>{
    root.querySelectorAll("[data-sync]").forEach(b=>b.onclick=async()=>{
      const a=b.dataset.sync;
      if(a==="now"){await SYNC.sync();const st=SYNC.state();return syncSheet(st.ok?"همگام شد.":st.err,!st.ok)}
      if(a==="off"){if(b.dataset.arm!=="1"){b.dataset.arm="1";b.textContent="مطمئنید؟ قطع شود";return} SYNC.disconnect();render();return syncSheet("اتصال این گوشی قطع شد. اطلاعات فعلی روی گوشی می‌ماند.")}
      if(a==="connect"){
        const pass=(root.querySelector("#syncPass").value||"").trim(); if(!pass) return syncSheet("رمز کلینیک را بنویس.",true);
        b.disabled=true; b.textContent="در حال اتصال…";
        try{const r=await SYNC.connect(pass); if(r==="downloaded") return location.reload(); render(); syncSheet("وصل شد. اطلاعات این گوشی روی سرور رفت.")}
        catch(e){syncSheet(e.code?e.message:"اتصال به سرور برقرار نشد. اینترنت را چک کن.",true)}
      }
    });
  });
}

/* ---------- feedback inbox (manager) ---------- */
let fbList=null, fbErr="", fbLoading=false, fbType="all", fbAt=0, fbShowDone=false;
const fbDoneIds=()=>{try{return new Set(JSON.parse(localStorage.getItem("fb_done")||"[]"))}catch(e){return new Set()}};
const fbUndoneIds=()=>{try{return new Set(JSON.parse(localStorage.getItem("fb_undone")||"[]"))}catch(e){return new Set()}};
const fbIsDone=e=>fbDoneIds().has(e.id)||(!!e.resolution&&!fbUndoneIds().has(e.id));
function fbSetDone(id,on){const s=fbDoneIds(),u=fbUndoneIds();if(on){s.add(id);u.delete(id)}else{s.delete(id);u.add(id)}try{localStorage.setItem("fb_done",JSON.stringify([...s]));localStorage.setItem("fb_undone",JSON.stringify([...u]))}catch(e){}}
async function loadFeedback(){
  if(fbLoading) return; fbLoading=true; fbErr=""; render();
  try{ fbList=await SYNC.feedback(); fbAt=Date.now(); }catch(e){ fbErr=e.code?e.message:"بازخوردها از سرور گرفته نشد. اینترنت را چک کن."; }
  fbLoading=false; render();
}
function feedbackTab(){
  if(!SYNC.enabled()) return `<div class="panel"><p>نظرها روی سرور کلینیک ذخیره می‌شوند. اول این گوشی را به سرور وصل کن.</p><button class="btn" data-act="sync-open">اتصال به سرور کلینیک</button></div>`;
  if(fbList===null&&!fbErr){ loadFeedback(); return `<div class="panel note">در حال گرفتن نظرها…</div>`; }
  const TN={feedback:"نظر",nlu_miss:"جملهٔ نفهمیده",nlu_correction:"اصلاح برداشت",error:"خطا"};
  const TABN={schedule:"برنامه",avail:"حضورها",rules:"قوانین",staff:"کارکنان",report:"گزارش",patients:"بیماران",appts:"نوبت‌ها",inventory:"انبار",insurance:"بیمه",implant:"ایمپلنت",feedback:"نظرها"};
  const KN={availability:"حضور",inventory_use:"مصرف انبار",patient:"پروندهٔ بیمار",note:"یادداشت بیمار",request:"درخواست",rules:"قوانین",weekly:"برنامهٔ هفتگی"};
  const who_=r=>r==="manager"?"مدیر مجموعه":r?nm(r):"—";
  const all_=(fbList||[]).filter(e=>fbType==="all"||e.type===fbType);
  const list=all_.filter(e=>!fbIsDone(e)), doneList=all_.filter(fbIsDone);
  const devs=[...new Set((fbList||[]).map(e=>e.device))];
  let h=`<div class="panel row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
    <span class="row" style="gap:6px;flex-wrap:wrap">${[["all","همه"],...Object.entries(TN)].map(([k,n])=>`<button class="btn ${fbType===k?"primary":"quiet"}" data-fbtype="${k}">${n} (${fa(k==="all"?(fbList||[]).length:(fbList||[]).filter(e=>e.type===k).length)})</button>`).join("")}</span>
    <span class="row" style="gap:8px">${fbAt?`<span class="note">آخرین تازه‌سازی ${new Date(fbAt).toLocaleTimeString("fa-IR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>`:""}<button class="btn" data-act="fb-reload" ${fbLoading?"disabled":""}>${fbLoading?"در حال گرفتن…":"تازه‌سازی"}</button></span></div>`;
  if(fbErr) h+=`<p class="warn">${esc(fbErr)}</p>`;
  const item=(e,isDone)=>{
    const txt=e.type==="feedback"?esc(e.text||""):e.type==="error"?esc(e.msg||"")+` <span class="note">${esc(e.src||"")}:${e.line||""}</span>`:`«${esc(e.text||"")}»`+(e.type==="nlu_miss"?`<div class="note">${esc([...(e.misses||[]),...(e.rejected||[]),...(e.unclear||[])].join(" | "))}</div>`:"");
    return `<div style="border-top:1px solid var(--line);padding:8px 0">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><strong>${TN[e.type]||e.type}${KN[e.kind]?` · ${KN[e.kind]}`:""}</strong><span class="note">${new Date(e.at).toLocaleString("fa-IR")}</span></div>
      <div style="margin:4px 0">${txt}</div>
      ${e.resolution?`<div class="okline" style="margin:4px 0">✔ ${esc(e.resolution)}</div>`:""}
      <div class="note">${e.user?`<strong>${esc(e.user)}</strong> · `:""}${esc(who_(e.role))} · صفحهٔ ${esc(TABN[e.tab]||e.tab||"—")} · گوشی ${fa(devs.indexOf(e.device)+1)} · نسخهٔ ${esc(e.v||"")}${e.standalone?" · اپ نصب‌شده":" · مرورگر"}</div>
      <div style="margin-top:4px"><button class="btn quiet" data-fbdone="${esc(e.id)}" data-on="${isDone?0:1}">${isDone?"برگرداندن به فهرست":"دیده شد"}</button></div>
    </div>`;};
  h+=`<div class="panel">`+(list.map(e=>item(e,false)).join("")||`<p class="note">${doneList.length?"همهٔ نظرها دیده شده‌اند.":"هنوز نظری نیامده."}</p>`)+`</div>`;
  if(doneList.length) h+=`<div class="panel"><button class="btn quiet" data-act="fb-done-toggle" aria-expanded="${fbShowDone}">${fbShowDone?"بستن":"نمایش"} دیده‌شده‌ها (${fa(doneList.length)})</button>${fbShowDone?doneList.map(e=>item(e,true)).join(""):""}</div>`;
  return h;
}

function managerView(){
  const nConf=newConflicts().length+(sched?.alerts||[]).filter(a=>!a.resolved).length+Object.values(reqs).filter(liveReq).length;
  const lowN=lowStockItems().length;
  const apptToday=Object.values(appts).filter(a=>a.date===todayISO()&&a.status==="scheduled").length;
  const tabs=[["schedule","برنامه"+(nConf?` (${fa(nConf)})`:"")],["avail","حضورها"],["rules","قوانین"],["staff","کارکنان"],["report","گزارش"],["patients","بیماران"],["appts","نوبت‌ها"+(apptToday?` (${fa(apptToday)})`:"")],["inventory","انبار"+(lowN?` (${fa(lowN)})`:"")],["insurance","بیمه"],["lab","لابراتوار"+(LAB.badge()?` (${fa(LAB.badge())})`:"")],["implant","ایمپلنت"+(IMP.badge()?` (${fa(IMP.badge())})`:"")],["feedback","نظرها"]];
  let h=syncBar()+topAlerts()+`<nav class="tabs" role="tablist">`+tabs.map(([k,n])=>`<button role="tab" data-tab="${k}" aria-selected="${tab===k}">${n}</button>`).join("")+`</nav>`;
  h+= tab==="schedule"?schedTab(): tab==="avail"?availTab(): tab==="rules"?rulesTab(): tab==="report"?reportTab(): tab==="patients"?patientsTab(): tab==="appts"?apptsTab(): tab==="inventory"?inventoryTab(): tab==="insurance"?insuranceTab(): tab==="lab"?LAB.tab(): tab==="feedback"?feedbackTab(): tab==="implant"?IMP.tab(): staffTab();
  return h;
}
/* ---------- monthly report ---------- */
function monthPanel(id){
  const t=monthlyTotals()[id]; if(!t?.shifts) return "";
  return `<div class="panel"><strong>شیفت‌های من این ماه</strong><p style="margin:6px 0 0">${fa(t.shifts)} شیفت، حدود ${fa(t.shifts*SHIFT_HOURS)} ساعت <span class="note">(بر اساس ${fa(SHIFT_HOURS)} ساعت برای هر شیفت)</span></p></div>`;
}
function monthlyTotals(){
  const cur=faMonth(Date.now()), out={};
  for(const w of Object.values(archive||{})){
    if(faMonth(w.at)!==cur) continue;
    for(const id in w.counts||{}){
      out[id]=out[id]||{shifts:0,name:w.staffNames?.[id]||nm(id),role:w.staffRoles?.[id]||byId(id)?.role||null};
      out[id].shifts+=w.counts[id];
    }
  }
  return out;
}
function reportTab(){
  const totals=monthlyTotals(), rows=Object.entries(totals).sort((a,b)=>b[1].shifts-a[1].shifts);
  let h=`<div class="panel"><strong>گزارش این ماه</strong><p class="note" style="margin:4px 0 0">جمع شیفت‌های هر نفر در هفته‌هایی که تا الان در این ماه «آرشیو» شده‌اند (با دکمه «شروع هفته جدید» در تب «حضورها»). ساعت‌ها فرضی است، بر اساس ${fa(SHIFT_HOURS)} ساعت برای هر شیفت.</p></div>`;
  if(!rows.length) return h+`<div class="panel"><p class="note">هنوز هفته‌ای در این ماه آرشیو نشده. وقتی «شروع هفته جدید» را بزنید، برنامه‌ی هفته‌ی جاری قبل از پاک شدن در گزارش ثبت می‌شود.</p></div>`;
  h+=`<div class="panel scroll"><table class="av"><thead><tr><th>نام</th><th>نقش</th><th>شیفت</th><th>ساعت تقریبی</th></tr></thead><tbody>`;
  for(const [id,t] of rows) h+=`<tr><td>${esc(t.name)}</td><td>${t.role?ROLEN[t.role]:"—"}</td><td>${fa(t.shifts)}</td><td>${fa(t.shifts*SHIFT_HOURS)}</td></tr>`;
  return h+`</tbody></table></div>`;
}

function missingList(){return (cfg.staff||[]).filter(s=>s.role!=="insurance"&&s.role!=="lab"&&!avail[s.id]?.confirmed)}

function schedTab(){
  const miss=missingList(), total=cfg.staff.filter(s=>s.role!=="insurance"&&s.role!=="lab").length;
  const openAl=!!sched&&((sched.alerts||[]).some(a=>!a.resolved));
  let h=sched?requestsPanel()+(openAl?alertsPanel():""):"";
  h+=`<div class="panel">
    <p style="margin:0 0 8px"><strong>${fa(total-miss.length)} از ${fa(total)} نفر</strong> حضور هفته بعد را فرستاده‌اند.</p>
    ${miss.length?`<p class="note" style="margin:0 0 12px">هنوز نفرستاده‌اند: ${miss.map(s=>esc(s.name)).join("، ")}</p>`:""}
    <div class="row">
      <button class="btn primary" data-act="build">${sched?"ساخت دوباره برنامه":"ساخت برنامه"}</button>
      ${sched?`<button class="btn" data-act="publish" ${sched.published?"disabled":""}>${sched.published?`منتشر شده (نسخه ${fa(sched.rev||1)})`:"تأیید و ارسال برای همه"}</button>${exportBtns()}`:""}
    </div></div>`;
  if(exportMsg) h+=`<p class="warn">${esc(exportMsg)}</p>`;
  if(!sched) return h+`<p class="note">وقتی حضورها رسید، «ساخت برنامه» را بزنید. برنامه با قوانین بخش «قوانین» چیده می‌شود.</p>`;
  {let used=0,tot=0;for(const k in sched.slots){used+=sched.slots[k].pairs.length;tot+=cfg.settings.chairs}
   h+=`<p><strong>پر بودن یونیت‌ها در هفته: ${fa(Math.round(100*used/Math.max(tot,1)))}٪</strong> <span class="note">(${fa(used)} از ${fa(tot)} یونیت‌شیفت)</span></p>`;}
  h+=conflictBanner();
  h+=gapsPanel();
  if(!openAl) h+=alertsPanel();
  if(sched.issues?.length) h+=`<div class="panel"><strong>نیاز به توجه</strong><ul class="clean issues">${sched.issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul></div>`;
  h+=`<div class="board">`+DAYS.map(([k,n])=>`<section class="day"><h3>${n}</h3><div class="shifts">`+SHIFTS.map(([sk,sn])=>{
    const sl=sched.slots?.[k+"_"+sk]||{pairs:[],reception:[],free:[]};
    const u=sl.pairs.length,ch=cfg.settings.chairs;
    let c=`<div class="shift"><h4>${sn}<span class="units ${u>=ch?"full":"gap"}">${fa(u)} از ${fa(ch)} یونیت</span></h4>`;
    if(!sl.pairs.length) c+=`<p class="note" style="margin:0">دکتری نیست</p>`;
    for(const p of sl.pairs) c+=`<div class="pair">${p.u?`<span class="unitno" title="یونیت">${fa(p.u)}</span>`:""}<span class="chip doctor">${esc(nm(p.d))}${spec(p.d)?`<span class="spec">${esc(spec(p.d))}</span>`:""}</span><span class="link"></span>${p.a?`<span class="chip assistant">${esc(nm(p.a))}</span>`:`<span class="chip missing">بدون دستیار</span>`}</div>`;
    c+=`<div class="pair">${sl.reception.length?sl.reception.map(r=>`<span class="chip reception">${esc(nm(r))}</span>`).join(""):`<span class="chip missing">بدون منشی</span>`}</div>`;
    {const oc=(sl.free||[]).filter(x=>byId(x)); if(oc.length) c+=`<div class="sub"><strong>آنکال</strong> (حضوری نیستند؛ در صورت نیاز خبر می‌شوند): ${oc.map(x=>esc(nm(x))).join("، ")}</div>`;}
    return c+`</div>`;
  }).join("")+`</div></section>`).join("")+`</div>`;
  if(sched.log?.length) h+=`<div class="panel" style="margin-top:16px"><strong>تغییرات بعد از ساخت برنامه</strong><ul class="clean issues">${[...sched.log].reverse().slice(0,15).map(l=>`<li><strong>${l.who==="manager"?"مدیر":esc(nm(l.who))}</strong> <span class="note">${new Date(l.at).toLocaleString("fa-IR",{weekday:"long",hour:"2-digit",minute:"2-digit"})}</span><br>${(l.items||[]).map(esc).join("<br>")}</li>`).join("")}</ul></div>`;
  h+=`<p class="note">ساخته شده: ${new Date(sched.generatedAt).toLocaleString("fa-IR")}</p>`;
  return h;
}

function availTab(){
  let h=`<div class="panel"><div class="row">
    <button class="btn" data-act="newweek">شروع هفته جدید</button>
    <button class="btn quiet" data-act="random">حضور تصادفی برای تست</button></div>
    <p class="note" style="margin:8px 0 0">«شروع هفته جدید» حضورها، قوانینِ فقط‌این‌هفته و برنامه قبلی را پاک می‌کند.</p></div>`;
  h+=`<div class="panel scroll"><table class="av"><thead><tr><th>نام</th>`+DAYS.map(([,n])=>`<th colspan="2">${n}</th>`).join("")+`</tr><tr><th></th>`+DAYS.map(()=>`<th class="note">ص</th><th class="note">ع</th>`).join("")+`</tr></thead><tbody>`;
  for(const r of ["doctor","assistant","reception"]){
    h+=`<tr class="rolehead"><td colspan="13">${r==="insurance"?"مسئول بیمه":ROLEN[r]+"ها"}</td></tr>`;
    for(const s of ofRole(r)){
      const a=avail[s.id];
      h+=`<tr><td>${esc(s.name)}${s.specialty?` <span class="note">(${esc(s.specialty)})</span>`:""}${a?.confirmed?"":' <span class="note">(نفرستاده)</span>'}</td>`+
        DAYS.map(([k])=>SHIFTS.map(([sk])=>`<td><span class="dot ${a?.confirmed&&a.grid?.[k]?.[sk]?"on":""}"></span></td>`).join("")).join("")+`</tr>`;
    }
  }
  return h+`</tbody></table></div>`;
}

function describe(r){
  const loc=(r.day?DAYN[r.day]:"هیچ روزی")+(r.shift?" "+SHN[r.shift]:"");
  switch(r.type){
    case "not_together": return `«${nm(r.ids[0])}» و «${nm(r.ids[1])}» در یک شیفت نباشند`;
    case "max_shifts": return `«${nm(r.staff)}» حداکثر ${fa(r.n)} شیفت در هفته`;
    case "require_specialty": {const where=r.per==="day"?(r.day?DAYN[r.day]:"هر روز"):((r.day?DAYN[r.day]:"هر")+" "+(r.shift?SHN[r.shift]:"شیفت"));return `${where} حداقل ${fa(r.n)} دکتر ${r.specialty} باشد`}
    case "unit_pref": {const L=u=>u.map(fa).join(" و ");const parts=[];if(r.allowed?.length)parts.push(`فقط روی یونیت ${L(r.allowed)}`);if(r.preferred?.length)parts.push(`ترجیحاً یونیت ${L(r.preferred)}`);return `«${nm(r.staff)}» ${parts.join("، ")} کار کند`+(r.by==="self"?" (انتخاب خودش)":"")}
    case "block": return `«${nm(r.staff)}» ${r.day||r.shift?loc:"هیچ"} شیفت نگیرد`+(r.temporary?" (فقط این هفته)":"");
  }
  return "قانون نامعلوم";
}
function describeAction(a){
  switch(a.op){
    case "add_rule": {const old=a.rule.type==="unit_pref"&&(cfg.rules||[]).find(r=>r.type==="unit_pref"&&r.staff===a.rule.staff);return (old?"جایگزین قانون قبلی: ":"قانون جدید: ")+describe(a.rule)}
    case "remove_rule": {const r=(cfg.rules||[]).find(x=>x.id===a.ruleId);return "حذف قانون: "+(r?describe(r):a.ruleId)}
    case "set_pairing": return `دستیارهای «${nm(a.doctor)}»: ${a.assistants.map(nm).join("، ")||"هیچ‌کس"}`;
    case "add_to_pairing": return `«${nm(a.assistant)}» به دستیارهای «${nm(a.doctor)}» اضافه شود`;
    case "remove_from_pairing": return `«${nm(a.assistant)}» از دستیارهای «${nm(a.doctor)}» حذف شود`;
    case "set_setting": return a.key==="chairs"?`حداکثر دکتر هم‌زمان در هر شیفت: ${fa(a.value)}`:`تعداد منشی در هر شیفت: ${fa(a.value)}`;
    case "set_specialty": return `تخصص «${nm(a.id)}»: ${a.specialty}`;
    case "remove_staff": return `«${nm(a.id)}» (${ROLEN[byId(a.id)?.role]}) به‌طور کامل از سیستم حذف شود: نام، حضور، قوانین، دستیاری دکترها، پیام‌ها و سابقه تغییراتش`;
    case "add_staff": return `«${a.name}» به‌عنوان ${ROLEN[a.role]}${a.specialty?" ("+a.specialty+")":""} اضافه شود`;
    case "rename": return `نام «${nm(a.id)}» به «${a.name}» تغییر کند`;
  }
  return "";
}

function unitTxt(id){const r=(cfg.rules||[]).find(x=>x.type==="unit_pref"&&x.staff===id);if(!r)return "یونیت: آزاد";const L=u=>u.map(fa).join("،");return "یونیت: "+(r.allowed?.length?"فقط "+L(r.allowed):"")+(r.allowed?.length&&r.preferred?.length?"، ":"")+(r.preferred?.length?"ترجیحاً "+L(r.preferred):"")}
function rulesTab(){
  let h=`<p class="lead">قانون را عادی بنویسید. قبل از ذخیره، برداشتم را نشانتان می‌دهم.</p>
  <div class="panel ${rulePending?"pending":""}">`;
  if(!rulePending){
    h+=`<label for="ruleTxt" class="note">قانون یا تغییر</label>
    <textarea id="ruleTxt" placeholder="مثلاً: زهرا دیگر اینجا کار نمی‌کند. دستیار جدیدمان رها است. دکتر احمدی فقط روی یونیت ۲ کار می‌کند. دکتر کریمی ترجیحاً یونیت ۳، ولی ۴ هم می‌شود. مریم و سارا با هم در یک شیفت نباشند.">${esc(ruleDraft)}</textarea>
    ${ruleErr?`<p class="warn">${esc(ruleErr)}</p>`:""}
    <p class="row" style="margin-top:10px"><button class="btn primary" data-act="rule-parse" ${ruleBusy||!sample?"disabled":""}>${ruleBusy?"در حال فهمیدن…":"بررسی"}</button></p>`;
  }else{
    h+=`<strong>این تغییرات اعمال می‌شود:</strong><ul>${rulePending.actions.map(a=>`<li>${esc(describeAction(a))}</li>`).join("")||"<li>هیچ تغییری</li>"}</ul>
    ${rulePending.rejected.length?`<p class="warn">انجام‌شدنی نیست: ${rulePending.rejected.map(esc).join("؛ ")}</p>`:""}
    ${rulePending.lines?.length?`<p style="margin:8px 0 4px"><strong>اثر روی برنامه این هفته:</strong></p><ul class="clean issues">${rulePending.lines.map(r=>`<li style="color:${r.ok?"var(--ok)":"var(--warn)"}">${r.ok?"✓":"✗"} ${esc(r.text)}</li>`).join("")}</ul>`:""}
    ${rulePending.impact==null?"":rulePending.impact.length?`<div class="warn" style="margin-bottom:10px"><strong>اثر روی برنامه فعلی:</strong> با این تغییر، برنامه‌ای که ساخته شده در ${fa(rulePending.impact.length)} مورد درست نیست و باید دوباره ساخته شود:<ul style="margin:4px 0 0">${rulePending.impact.slice(0,8).map(t=>`<li>${esc(t)}</li>`).join("")}</ul></div>`:`<p class="okline">با برنامه فعلی تداخلی ندارد.</p>`}
    <p class="row"><button class="btn primary" data-act="rule-apply" ${rulePending.actions.length?"":"disabled"}>اعمال</button><button class="btn quiet" data-act="rule-cancel">لغو</button></p>`;
  }
  h+=`</div>`;
  if(ruleAfter&&!rulePending) h+=`<div class="panel ${ruleAfter.includes("تداخل دارد")?"warn":""}"><span>${esc(ruleAfter)}</span>${ruleAfter.includes("تداخل دارد")?` <button class="btn" data-tab="schedule" style="margin-inline-start:8px">رفتن به برنامه</button>`:""}</div>`;
  h+=`<div class="panel"><strong>تنظیمات پایه</strong>
    <p style="margin:6px 0 0">حداکثر دکتر هم‌زمان (تعداد یونیت): <strong>${fa(cfg.settings.chairs)}</strong><br>منشی در هر شیفت: <strong>${fa(cfg.settings.receptionPerShift)}</strong></p>
    <div style="margin-top:10px"><label class="note" for="clinicNameInp">نام کلینیک (روی فاکتور چاپ می‌شود)</label>
      <div class="row" style="margin-top:4px"><input type="text" id="clinicNameInp" placeholder="مثلاً: کلینیک دندانپزشکی مهر" value="${esc(clinicNameDraft??cfg.settings.clinicName??"")}" style="flex:1 1 200px"><button class="btn quiet" data-act="clinic-name-save">ذخیره</button></div>
    </div></div>`;
  h+=`<div class="panel"><strong>قوانین فعال</strong>`+((cfg.rules||[]).length?`<div>`+cfg.rules.map(r=>`<div class="rule"><span>${esc(describe(r))}</span><button class="x" data-del="${r.id}" aria-label="حذف">حذف</button></div>`).join("")+`</div>`:`<p class="note">هنوز قانونی نیست.</p>`)+`</div>`;
  h+=`<div class="panel"><strong>دکترها، یونیت و دستیارهایشان</strong>`+ofRole("doctor").map(d=>`<div class="pair" style="margin-top:8px"><span class="chip doctor">${esc(d.name)}</span><span class="note">${esc(unitTxt(d.id))}</span><span class="link"></span>${(cfg.pairings?.[d.id]||[]).map(a=>`<span class="chip assistant">${esc(nm(a))}</span>`).join("")||'<span class="chip missing">تعریف نشده</span>'}</div>`).join("")+`</div>`;
  return h;
}

async function ruleParseRun(){
  const text=ruleDraft.trim(); if(!text){ruleErr="اول چیزی بنویسید.";render();return}
  ruleBusy=true;ruleErr="";render();
  const ctx={staff:cfg.staff,pairings:cfg.pairings,settings:cfg.settings,rules:(cfg.rules||[]).map(r=>({id:r.id,text:describe(r)}))};

  try{
    const r=NLU.rules(text,cfg.staff,cfg.settings); FB.nlu("rules",text,r);
    const acts=[],rej=Array.isArray(r?.rejected)?r.rejected.map(String):[];
    for(const a of (Array.isArray(r?.actions)?r.actions:[])){const v=validate(a); if(v) acts.push(v); else rej.push("یک تغییر با داده‌های کلینیک جور نبود و کنار گذاشته شد.")}
    {const sim=simulateRules(acts); rulePending={actions:acts,rejected:rej,impact:sim.impact,lines:sim.lines};}
  }catch(e){ruleErr=errCopy(e)}
  ruleBusy=false;render();
}

function validate(a){
  const is=(id,role)=>{const s=byId(id);return !!s&&(!role||s.role===role)};
  const dayOk=d=>d==null||DAYN[d], shOk=s=>s==null||SHN[s];
  if(a?.op==="add_rule"){
    const r=a.rule||{};
    if(r.type==="not_together"&&Array.isArray(r.ids)&&r.ids.length===2&&is(r.ids[0])&&is(r.ids[1])&&r.ids[0]!==r.ids[1]) return {op:"add_rule",rule:{id:uid(),type:"not_together",ids:r.ids}};
    if(r.type==="max_shifts"&&is(r.id)&&Number.isInteger(r.n)&&r.n>=0&&r.n<=12) return {op:"add_rule",rule:{id:uid(),type:"max_shifts",staff:r.id,n:r.n}};
    if(r.type==="require_specialty"&&SPECS.includes(r.specialty)&&["shift","day"].includes(r.per)&&dayOk(r.day)&&shOk(r.shift)&&Number.isInteger(r.n)&&r.n>=1&&r.n<=5) return {op:"add_rule",rule:{id:uid(),type:"require_specialty",specialty:r.specialty,per:r.per,day:r.day||null,shift:r.per==="shift"?(r.shift||null):null,n:r.n}};
    if(r.type==="unit_pref"&&is(r.id,"doctor")){
      const U=x=>Array.isArray(x)?[...new Set(x)].filter(u=>Number.isInteger(u)&&u>=1&&u<=cfg.settings.chairs).sort((a,b)=>a-b):[];
      const al=U(r.allowed), pr=U(r.preferred).filter(u=>!al.length||al.includes(u));
      if(al.length||pr.length) return {op:"add_rule",rule:{id:uid(),type:"unit_pref",staff:r.id,allowed:al,preferred:pr,by:"manager"}};
      return null;
    }
    if(r.type==="block"&&is(r.id)&&dayOk(r.day)&&shOk(r.shift)) return {op:"add_rule",rule:{id:uid(),type:"block",staff:r.id,day:r.day||null,shift:r.shift||null,temporary:!!r.temporary}};
    return null;
  }
  if(a?.op==="remove_rule"&&(cfg.rules||[]).some(x=>x.id===a.ruleId)) return {op:a.op,ruleId:a.ruleId};
  if(a?.op==="set_pairing"&&is(a.doctor,"doctor")&&Array.isArray(a.assistants)&&a.assistants.every(x=>is(x,"assistant"))) return {op:a.op,doctor:a.doctor,assistants:[...new Set(a.assistants)]};
  if((a?.op==="add_to_pairing"||a?.op==="remove_from_pairing")&&is(a.doctor,"doctor")&&is(a.assistant,"assistant")) return {op:a.op,doctor:a.doctor,assistant:a.assistant};
  if(a?.op==="set_setting"&&["chairs","receptionPerShift"].includes(a.key)&&Number.isInteger(a.value)&&a.value>=0&&a.value<=20) return {op:a.op,key:a.key,value:a.value};
  if(a?.op==="set_specialty"&&is(a.id,"doctor")&&SPECS.includes(a.specialty)) return {op:a.op,id:a.id,specialty:a.specialty};
  if(a?.op==="remove_staff"){ const id=is(a.id)?a.id:(cfg.staff.find(s=>s.name===a.id||s.name===a.name)?.id); if(id) return {op:a.op,id}; return null; }
  if(a?.op==="add_staff"&&typeof a.name==="string"&&a.name.trim()&&ROLEN[a.role]) return {op:a.op,name:a.name.trim().slice(0,40),role:a.role,specialty:a.role==="doctor"?(SPECS.includes(a.specialty)?a.specialty:"عمومی"):null};
  if(a?.op==="rename"&&is(a.id)&&typeof a.name==="string"&&a.name.trim()) return {op:a.op,id:a.id,name:a.name.trim().slice(0,40)};
  return null;
}

function applyRuleActions(src,actions){
  const c=structuredClone(src); c.rules=c.rules||[]; c.pairings=c.pairings||{};
  for(const a of actions){
    if(a.op==="add_rule"){ if(a.rule.type==="unit_pref") c.rules=c.rules.filter(r=>!(r.type==="unit_pref"&&r.staff===a.rule.staff)); c.rules.push(a.rule); }
    if(a.op==="remove_rule") c.rules=c.rules.filter(r=>r.id!==a.ruleId);
    if(a.op==="set_pairing") c.pairings[a.doctor]=a.assistants;
    if(a.op==="add_to_pairing"){const l=c.pairings[a.doctor]||[];if(!l.includes(a.assistant))l.push(a.assistant);c.pairings[a.doctor]=l}
    if(a.op==="remove_from_pairing") c.pairings[a.doctor]=(c.pairings[a.doctor]||[]).filter(x=>x!==a.assistant);
    if(a.op==="set_setting") c.settings[a.key]=a.value;
    if(a.op==="set_specialty"){const s=c.staff.find(x=>x.id===a.id);if(s)s.specialty=a.specialty}
    if(a.op==="rename"){const s=c.staff.find(x=>x.id===a.id);if(s)s.name=a.name}
    if(a.op==="remove_staff"){
      const p=c.staff.find(x=>x.id===a.id); if(!p) continue;
      c.usedIds=[...new Set([...(c.usedIds||[]),...c.staff.map(x=>x.id)])];
      c.staff=c.staff.filter(x=>x.id!==a.id); if(c.former) delete c.former;
      delete c.pairings[a.id]; for(const d in c.pairings) c.pairings[d]=c.pairings[d].filter(x=>x!==a.id);
      c.rules=c.rules.filter(r=>r.staff!==a.id&&!(r.ids||[]).includes(a.id));
    }
    if(a.op==="add_staff"){
      const pre={doctor:"d",assistant:"a",reception:"r"}[a.role];
      const used=[...c.staff,...(c.usedIds||[]).map(id=>({id}))].map(x=>x.id).filter(x=>x.startsWith(pre)).map(x=>+x.slice(1)||0);
      const id=pre+(Math.max(0,...used)+1);
      c.staff.push({id,name:a.name,role:a.role,...(a.specialty?{specialty:a.specialty}:{})});
      c.usedIds=[...new Set([...(c.usedIds||[]),id])];
      if(a.role==="doctor") c.pairings[id]=[];
    }
  }
  return c;
}
let ruleAfter="";
async function ruleApply(){
  const acts=rulePending.actions, sim=simulateRules(acts), c=sim.c;
  if(c.former) delete c.former;
  const imp=sim.impact, removed=acts.filter(a=>a.op==="remove_staff").map(a=>a.id), added=acts.filter(a=>a.op==="add_staff");
  try{
    if(sim.S&&removed.length){
      const S=sim.S; S.notices=[...(S.notices||[]),...sim.notices].slice(-80); S.alerts=[...(S.alerts||[]),...sim.alerts].slice(-60);
      S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:"",items:[...removed.map(id=>`یک ${ROLEN[byId(id)?.role]||"نفر"} از کارکنان حذف شد.`),...sim.lines.map(l=>l.text)]}].slice(-40);
      for(const id of removed) scrubPerson(S,id,nm(id));
      if(S.published&&sim.lines.length) S.rev=(S.rev||1)+1;
      S.baseConflicts=[...new Set([...(S.baseConflicts||[]),...checkConflicts(c,S).map(x=>x.text)])];
      await db.doc("clinic/schedule").set(S);
    }
    for(const id of removed){ try{await db.doc("avail/"+id).delete()}catch(e){} }
    await db.doc("clinic/config").set(c);rulePending=null;ruleDraft="";ruleAfter=(added.some(a=>a.role==="doctor")?"دکتر جدید اضافه شد؛ دستیارهایش را با پرامپت تعیین کنید (مثلاً «دکتر … با مریم و سارا کار می‌کند»). ":"")+(imp?.length?`ذخیره شد. این تغییر با برنامه فعلی ${fa(imp.length)} مورد تداخل دارد؛ در تب «برنامه» گزینه ساخت دوباره را ببینید.`:(sched?"ذخیره شد. با برنامه فعلی تداخلی ندارد و از ساخت بعدی هم رعایت می‌شود.":"ذخیره شد."));}catch(e){ruleErr="ذخیره نشد. دوباره بزنید.";rulePending=null}
  render();
}

function staffTab(){
  let h=`<p class="lead">نام‌ها و تخصص دکترها را عوض کنید و «ذخیره نام‌ها» را بزنید. «حذف» فرد را به‌طور کامل از سیستم برمی‌دارد.</p>${staffMsg?`<div class="panel ${staffMsgBad?"warn":""}">${esc(staffMsg)}</div>`:""}<div class="panel">`;
  for(const r of ["doctor","assistant","reception","insurance","lab"]){
    h+=`<div class="cathead">${r==="insurance"?"مسئول بیمه":r==="lab"?"لابراتوار":ROLEN[r]+"ها"} <span class="note" style="font-weight:400">(${fa(ofRole(r).length)})</span></div>`;
    for(const s of ofRole(r)) h+=`<div class="staffrow"><span class="tag">${ROLEN[r]}</span><input type="text" data-name="${s.id}" value="${esc(nameDraft[s.id]??s.name)}" aria-label="نام">${r==="doctor"?`<select data-spec="${s.id}" aria-label="تخصص">${SPECS.map(x=>`<option ${(specDraft[s.id]??s.specialty)===x?"selected":""}>${x}</option>`).join("")}</select>`:""}<button class="x" data-rm="${s.id}" aria-label="حذف ${esc(s.name)}">${rmArm===s.id?"مطمئنید؟ حذف کامل":"حذف"}</button></div>`;
  }
  return h+`<p class="row" style="margin-top:12px"><button class="btn primary" data-act="save-names">ذخیره نام‌ها</button></p></div>`;
}

/* ---------- scheduler ---------- */
function buildSchedule(bo={}){
  const rules=cfg.rules||[], S=cfg.staff, chairs=cfg.settings.chairs, recN=cfg.settings.receptionPerShift;
  const nt=rules.filter(r=>r.type==="not_together").map(r=>r.ids);
  const mx={}; rules.filter(r=>r.type==="max_shifts").forEach(r=>mx[r.staff]=Math.min(mx[r.staff]??99,r.n));
  const blocks=rules.filter(r=>r.type==="block");
  const load={}; S.forEach(s=>load[s.id]=0);
  const issues=[], slots={}, dayCount=Object.fromEntries(DAYS.map(([k])=>[k,{}]));
  if(bo.base){ for(const key in bo.base.slots){ if(bo.redo.has(key)) continue; const sl=bo.base.slots[key]; const k=key.split("_")[0];
      for(const p of sl.pairs){ load[p.d]=(load[p.d]||0)+1; if(p.a) load[p.a]=(load[p.a]||0)+1; const sp=spec(p.d); if(sp) dayCount[k][sp]=(dayCount[k][sp]||0)+1 }
      for(const r of sl.reception) load[r]=(load[r]||0)+1; } }
  const miss=missingList(); if(miss.length) issues.push("حضورشان نیامده و در برنامه نیستند: "+miss.map(s=>s.name).join("، "));
  const up={}; rules.filter(r=>r.type==="unit_pref").forEach(r=>up[r.staff]=r);
  const UNITS=Array.from({length:chairs},(_,i)=>i+1);
  const allowedU=d=>{const a=(up[d]?.allowed||[]).filter(u=>u<=chairs);return a.length?a:UNITS};
  const costU=(d,u)=>(up[d]?.preferred?.length&&!up[d].preferred.includes(u))?1:0;
  const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  function assignUnits(ds){
    const order=[...ds].sort((a,b)=>allowedU(a).length-allowedU(b).length);
    let best=null,bc=1e9;
    (function f(i,used,map,c){
      if(c>=bc) return;
      if(i===order.length){best={...map};bc=c;return}
      const d=order[i];
      for(const u of shuffle(allowedU(d))){ if(used.has(u)) continue; used.add(u);map[d]=u;f(i+1,used,map,c+costU(d,u));used.delete(u);delete map[d] }
    })(0,new Set(),{},0);
    return best;
  }
  const clash=(x,set)=>nt.some(([p,q])=>(p===x&&set.has(q))||(q===x&&set.has(p)));
  for(const [k,dn] of DAYS) for(const [sk,sn] of SHIFTS){
    const label=`${dn} ${sn}`;
    if(bo.base&&!bo.redo.has(k+"_"+sk)){slots[k+"_"+sk]=structuredClone(bo.base.slots[k+"_"+sk]);continue}
    const ok=id=>avail[id]?.confirmed&&avail[id].grid?.[k]?.[sk]&&!blocks.some(b=>b.staff===id&&(!b.day||b.day===k)&&(!b.shift||b.shift===sk))&&load[id]<(mx[id]??99);
    const byLoad=(a,b)=>load[a]-load[b];
    const people=new Set();
    // doctors: fill units, prefer required and missing specialties
    const reqs=rules.filter(r=>r.type==="require_specialty");
    const need=sp=>reqs.some(r=>r.specialty===sp&&(!r.day||r.day===k)&&(r.per==="shift"?((!r.shift||r.shift===sk)&&docs.filter(d=>spec(d)===sp).length<r.n):((dayCount[k][sp]||0)+docs.filter(d=>spec(d)===sp).length<r.n)));
    const docs=[];
    let cand=S.filter(s=>s.role==="doctor"&&ok(s.id)).map(s=>s.id);
    while(cand.length&&docs.length<chairs){
      cand=cand.filter(d=>{if(clash(d,people)){issues.push(`${label}: ${nm(d)} به‌خاطر یک قانون «با هم نباشند» حذف شد.`);return false}return true});
      if(!cand.length) break;
      const score=d=>(need(spec(d))?1000:0)+(docs.some(x=>spec(x)===spec(d))?0:10)-load[d];
      cand.sort((a,b)=>score(b)-score(a));
      const d=cand.shift();
      if(!assignUnits([...docs,d])){issues.push(`${label}: یونیت مجاز ${nm(d)} (${allowedU(d).map(fa).join("، ")}) پر است و جا نشد.`);continue}
      docs.push(d); people.add(d);
    }
    for(const d of cand) issues.push(`${label}: ظرفیت ${fa(chairs)} یونیت پر است و ${nm(d)} جا نشد (در فهرست ذخیره).`);
    const spare=S.filter(s=>s.role==="doctor"&&ok(s.id)&&!docs.includes(s.id)).map(s=>s.id);
    for(const d of docs){const sp=spec(d); if(sp) dayCount[k][sp]=(dayCount[k][sp]||0)+1}
    for(const r of reqs.filter(r=>r.per==="shift"&&(!r.day||r.day===k)&&(!r.shift||r.shift===sk))){
      const c=docs.filter(d=>spec(d)===r.specialty).length; if(c<r.n) issues.push(`${label}: دکتر ${r.specialty} لازم است ولی ${c?"کافی ":""}در دسترس نیست.`);
    }
    if(docs.length<chairs){
      const absent=S.filter(s=>s.role==="doctor"&&!docs.includes(s.id)&&!blocks.some(b=>b.staff===s.id&&(!b.day||b.day===k)&&(!b.shift||b.shift===sk))).map(s=>s.id).sort(byLoad).slice(0,3);
      issues.push(`${label}: ${fa(chairs-docs.length)} یونیت خالی است.`+(absent.length?` می‌شود از ${absent.map(nm).join("، ")} پرسید.`:""));
    }
    // assistants: best matching via DFS
    const astAvail=S.filter(s=>s.role==="assistant"&&ok(s.id)).map(s=>s.id);
    const opts=d=>(cfg.pairings?.[d]||[]).filter(a=>astAvail.includes(a)).sort(byLoad);
    const order=[...docs].sort((a,b)=>opts(a).length-opts(b).length);
    let best={n:-1,cost:1e9,map:{}},steps=0;
    (function dfs(i,used,map,n,cost){
      if(++steps>50000) return;
      if(n+(order.length-i)<best.n) return;
      if(i===order.length){if(n>best.n||(n===best.n&&cost<best.cost))best={n,cost,map:{...map}};return}
      const d=order[i];
      for(const a of opts(d)){
        if(used.has(a)) continue;
        const set=new Set([...people,...used]); if(clash(a,set)) continue;
        used.add(a);map[d]=a;dfs(i+1,used,map,n+1,cost+load[a]);used.delete(a);delete map[d];
      }
      dfs(i+1,used,map,n,cost);
    })(0,new Set(),{},0,0);
    const umap=assignUnits(docs)||{};
    for(const d of docs) if(costU(d,umap[d])) issues.push(`${label}: ${nm(d)} ترجیح یونیت ${up[d].preferred.map(fa).join(" یا ")} را داشت ولی روی یونیت ${fa(umap[d])} افتاد.`);
    const pairs=docs.map(d=>({d,a:best.map[d]||null,u:umap[d]||null})).sort((x,y)=>(x.u||99)-(y.u||99));
    for(const p of pairs){
      if(p.a){people.add(p.a);load[p.a]++}
      else issues.push(`${label}: برای ${nm(p.d)} دستیار مجاز و در دسترس پیدا نشد.`);
      load[p.d]++;
    }
    // reception
    const rec=[];
    if(docs.length){
      for(const r of S.filter(s=>s.role==="reception"&&ok(s.id)).map(s=>s.id).sort(byLoad)){
        if(rec.length>=recN) break;
        if(clash(r,people)) continue;
        rec.push(r);people.add(r);load[r]++;
      }
      if(rec.length<recN) issues.push(`${label}: ${fa(recN)} منشی لازم بود، ${fa(rec.length)} نفر پیدا شد.`);
    }
    const free=S.filter(s=>s.role!=="doctor"&&ok(s.id)&&!people.has(s.id)).map(s=>s.id);
    slots[k+"_"+sk]={pairs,reception:rec,free,spare};
  }
  for(const r of (rules.filter(r=>r.type==="require_specialty"&&r.per==="day")))
    for(const [k,dn] of DAYS){ if(r.day&&r.day!==k) continue; const c=dayCount[k][r.specialty]||0; if(c<r.n) issues.push(`${dn}: دکتر ${r.specialty} لازم است ولی ${fa(c)} نفر هست.`) }
  if(bo.base){ const labs=[...bo.redo].map(key=>{const [k,sk]=key.split("_");return DAYN[k]+" "+SHN[sk]+":"});
    return {slots,issues:[...new Set([...(bo.base.issues||[]).filter(i=>!labs.some(l=>i.startsWith(l))),...issues])]}; }
  return {slots,issues,generatedAt:Date.now(),published:false};
}

/* ---------- print ---------- */
function printHtml(){
  let t=`<h1 style="font-size:18px;margin:0 0 8px">برنامه شیفت هفته</h1><table style="border-collapse:collapse;width:100%;font-size:11px" dir="rtl"><thead><tr><th style="border:1px solid #000;padding:4px">روز</th><th style="border:1px solid #000;padding:4px">صبح</th><th style="border:1px solid #000;padding:4px">عصر</th></tr></thead><tbody>`;
  for(const [k,n] of DAYS){
    t+=`<tr><td style="border:1px solid #000;padding:4px;font-weight:700">${n}</td>`;
    for(const [sk] of SHIFTS){
      const sl=sched.slots[k+"_"+sk];
      t+=`<td style="border:1px solid #000;padding:4px;vertical-align:top">`+sl.pairs.map(p=>`${p.u?"یونیت "+fa(p.u)+": ":""}${esc(nm(p.d))}${spec(p.d)?" ("+esc(spec(p.d))+")":""} ← ${p.a?esc(nm(p.a)):"بدون دستیار"}`).join("<br>")+(sl.reception.length?`<br><em>منشی: ${sl.reception.map(x=>esc(nm(x))).join("، ")}</em>`:"")+`</td>`;
    }
    t+=`</tr>`;
  }
  return t+`</tbody></table>`;
}

/* ---------- export ---------- */
function exportBtns(){
  return `<button class="btn" data-act="pdf">دانلود PDF</button><button class="btn" data-act="xlsx">دانلود Excel</button><button class="btn quiet" data-act="print">چاپ</button>`;
}
let exportMsg="";
function tableRows(){
  const N=cfg.settings.chairs, rows=[];
  for(const [k,n] of DAYS) for(const [sk,sn] of SHIFTS){
    const sl=sched.slots[k+"_"+sk]||{pairs:[],reception:[]};
    const cells=[];
    for(let u=1;u<=N;u++){const p=sl.pairs.find(x=>x.u===u);cells.push(p?{d:nm(p.d),s:spec(p.d),a:p.a?nm(p.a):"بدون دستیار"}:null)}
    rows.push({day:n,shift:sn,cells,rec:sl.reception.map(nm),oc:(sl.free||[]).filter(x=>byId(x)).map(nm)});
  }
  return rows;
}
function pdfHtml(){
  const N=cfg.settings.chairs, rows=tableRows();
  const td="border:1px solid #444;padding:5px 6px;vertical-align:top;font-size:11px;line-height:1.6;text-align:right";
  let h=`<div dir="rtl" style="font-family:Vazirmatn,Tahoma,sans-serif;color:#000;background:#fff;padding:8px">
  <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;margin-bottom:8px;padding-bottom:4px"><strong style="font-size:18px">برنامه شیفت هفته</strong><span style="font-size:11px">نسخه ${fa(sched.rev||1)}، ${new Date().toLocaleDateString("fa-IR")}</span></div>
  <table style="border-collapse:collapse;width:100%"><thead><tr><th style="${td};background:#eee">روز</th><th style="${td};background:#eee">شیفت</th>`;
  for(let u=1;u<=N;u++) h+=`<th style="${td};background:#eee">یونیت ${fa(u)}</th>`;
  h+=`<th style="${td};background:#eee">منشی</th><th style="${td};background:#eee">آنکال</th></tr></thead><tbody>`;
  rows.forEach((r,i)=>{
    h+=`<tr>${i%2===0?`<td rowspan="2" style="${td};font-weight:700">${r.day}</td>`:""}<td style="${td}">${r.shift}</td>`;
    for(const c of r.cells) h+=`<td style="${td}">${c?`<b>${esc(c.d)}</b>${c.s?` <span style="color:#555">(${esc(c.s)})</span>`:""}<br>${esc(c.a)}`:`<span style="color:#999">خالی</span>`}</td>`;
    h+=`<td style="${td}">${r.rec.map(esc).join("<br>")||"—"}</td><td style="${td};color:#555">${r.oc.map(esc).join("<br>")||"—"}</td></tr>`;
  });
  return h+`</tbody></table></div>`;
}
async function downloadPdf(btn){
  try{await loadVendor("html2pdf")}catch(e){exportMsg="فایل ساخت PDF بارگذاری نشد. اینترنت را چک کنید و دوباره بزنید.";return render()}
  btn.disabled=true; btn.textContent="در حال ساخت PDF…";
  const box=document.createElement("div"); box.style.cssText="position:fixed;top:0;left:0;width:1120px;background:#fff;opacity:0;pointer-events:none;z-index:-1";
  box.innerHTML=pdfHtml(); document.body.appendChild(box);
  try{
    if(document.fonts) await document.fonts.ready;
    const blob=await html2pdf().set({margin:6,image:{type:"jpeg",quality:.95},html2canvas:{scale:2,backgroundColor:"#ffffff"},jsPDF:{unit:"mm",format:"a4",orientation:"landscape"}}).from(box.firstElementChild).outputPdf("blob");
    await saveFile({filename:"shift-schedule.pdf",data:blob}); exportMsg="";
  }catch(e){ if(e?.code!=="declined") exportMsg="ساخت یا ذخیره PDF انجام نشد. دوباره امتحان کنید."; }
  box.remove(); render();
}
async function downloadXlsx(){
  try{await loadVendor("xlsx")}catch(e){exportMsg="فایل ساخت Excel بارگذاری نشد. اینترنت را چک کنید و دوباره بزنید.";return render()}
  const N=cfg.settings.chairs, rows=tableRows();
  const grid=[["روز","شیفت",...Array.from({length:N},(_,i)=>"یونیت "+(i+1)),"منشی","آنکال"]];
  for(const r of rows) grid.push([r.day,r.shift,...r.cells.map(c=>c?`${c.d}${c.s?" ("+c.s+")":""} / ${c.a}`:"خالی"),r.rec.join("، "),r.oc.join("، ")]);
  const long=[["روز","شیفت","یونیت","دکتر","تخصص","دستیار"]];
  for(const r of rows) r.cells.forEach((c,i)=>{ if(c) long.push([r.day,r.shift,i+1,c.d,c.s,c.a]) });
  const rec=[["روز","شیفت","منشی"]]; for(const r of rows) for(const x of r.rec) rec.push([r.day,r.shift,x]);
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.aoa_to_sheet(grid); ws1["!cols"]=[{wch:10},{wch:6},...Array(N).fill(0).map(()=>({wch:30})),{wch:22},{wch:22}];
  const ws2=XLSX.utils.aoa_to_sheet(long); ws2["!cols"]=[{wch:10},{wch:6},{wch:6},{wch:18},{wch:14},{wch:14}];
  const ws3=XLSX.utils.aoa_to_sheet(rec); ws3["!cols"]=[{wch:10},{wch:6},{wch:14}];
  XLSX.utils.book_append_sheet(wb,ws1,"برنامه هفته"); XLSX.utils.book_append_sheet(wb,ws2,"دکتر و دستیار"); XLSX.utils.book_append_sheet(wb,ws3,"منشی‌ها");
  wb.Workbook={Views:[{RTL:true}]};
  try{ await saveFile({filename:"shift-schedule.xlsx",data:XLSX.write(wb,{bookType:"xlsx",type:"array"})}); exportMsg=""; }
  catch(e){ if(e?.code!=="declined") exportMsg="ذخیره Excel انجام نشد. دوباره امتحان کنید."; }
  render();
}
function doPrint(){ $("#printArea").innerHTML=pdfHtml(); try{window.print()}catch(e){} exportMsg="اگر پنجره چاپ باز نشد، PDF را دانلود و از آن چاپ بگیرید."; render(); }

/* ---------- notices for staff ---------- */
function seenAt(id){try{return +localStorage.getItem("seen_"+id)||0}catch(e){return 0}}
function noticesPanel(id){
  if(!sched) return "";
  const list=(sched.notices||[]).filter(n=>(n.to==="all"||(Array.isArray(n.to)&&n.to.includes(id)))&&n.at>seenAt(id));
  if(!list.length) return "";
  return `<div class="panel newbox"><strong>تازه‌ها</strong><ul class="clean issues">${list.slice(-8).reverse().map(n=>`<li>${esc(n.text)} <span class="note">${new Date(n.at).toLocaleString("fa-IR",{weekday:"long",hour:"2-digit",minute:"2-digit"})}</span></li>`).join("")}</ul><p class="row" style="margin-top:8px"><button class="btn quiet" data-act="seen">دیدم</button></p></div>`;
}
function confirmPanel(id){
  const list=(sched?.confirms||[]).filter(c=>(c.to||[]).includes(id)&&!c.responses?.[id]);
  if(!list.length) return "";
  return `<div class="panel confirmbox"><strong>نیاز به تأیید تو</strong>`+list.map(c=>{
    const L=keyLabel(c.key), asDoc=c.doctor===id;
    const what=asDoc?`روی یونیت ${fa(c.unit)}`:`به‌عنوان دستیار ${esc(nm(c.doctor))}`;
    return `<div style="border-top:1px solid var(--line);padding:8px 0">
      <p class="warntext">${L}: مدیر شما را ${what} گذاشت، ولی حضور این زمان را اعلام نکرده بودی. می‌آیی؟</p>
      <div class="row"><button class="btn primary" data-conf="1|${c.id}">می‌آیم</button><button class="btn danger" data-conf="0|${c.id}">نمی‌آیم</button></div>
    </div>`;
  }).join("")+`</div>`;
}
async function respondConfirm(cid,yes){
  const S=structuredClone(sched); const c=(S.confirms||[]).find(x=>x.id===cid); if(!c) return;
  c.responses=c.responses||{}; c.responses[who]=yes?"accepted":"rejected";
  const L=keyLabel(c.key);
  if(!yes){
    const roleTxt=who===c.doctor?"دکتر":"دستیار";
    S.alerts=[...(S.alerts||[]),{id:uid(),at:Date.now(),key:c.key,text:`${L}: ${nm(who)} (${roleTxt}) شیفتی را که بدون اعلام حضورش گذاشته بودید رد کرد.`,resolved:false}].slice(-60);
  }
  S.log=[...(S.log||[]),{who,at:Date.now(),text:"",items:[`${L}: ${yes?"شیفت اجباری را پذیرفت.":"شیفت اجباری را رد کرد."}`]}].slice(-40);
  try{await db.doc("clinic/schedule").set(S)}catch(e){}
}

/* ---------- manager alerts & weekly edits ---------- */
let mgrDraft="", mgrPlan=null, mgrBusy=false, mgrErr="";
function alertsPanel(){
  const open=(sched.alerts||[]).filter(a=>!a.resolved);
  let h=`<div class="panel ${mgrPlan?"pending":""}">`;
  h+= open.length?`<strong>هشدارها (${fa(open.length)})</strong><p class="note" style="margin:2px 0 6px">سیستم این‌ها را خودش نتوانست حل کند.</p>`+open.map(a=>`<div class="alert"><span>${esc(a.text)}</span><button class="x" data-close="${a.id}">بستن</button></div>`).join("")
    :`<strong>تغییر برنامه این هفته</strong>`;
  if(!mgrPlan){
    h+=`<label for="mgrTxt" class="note" style="display:block;margin-top:10px">دستور شما</label>
    <textarea id="mgrTxt" placeholder="مثلاً: زهرا اخراج شد. دکتر نوری را سه‌شنبه صبح روی یونیت ۲ بگذار. زهرا دوشنبه عصر دستیار دکتر کریمی باشد. آزاده را پنج‌شنبه عصر در پذیرش بگذار.">${esc(mgrDraft)}</textarea>
    ${mgrErr?`<p class="warn">${esc(mgrErr)}</p>`:""}
    <p class="row" style="margin-top:10px"><button class="btn primary" data-act="mgr-parse" ${mgrBusy||!sample?"disabled":""}>${mgrBusy?"در حال بررسی…":"بررسی"}</button></p>`;
  }else{
    const okN=mgrPlan.report.filter(r=>r.ok).length;
    h+=`<p style="margin:10px 0 4px"><strong>نتیجه بررسی</strong></p><ul class="clean issues">${mgrPlan.report.map(r=>`<li style="color:${r.ok?(r.warn?"var(--rec)":"var(--ok)"):"var(--warn)"}">${r.ok?(r.warn?"⚠":"✓"):"✗"} ${esc(r.text)}</li>`).join("")}</ul>
    <p class="row" style="margin-top:10px"><button class="btn primary" data-act="mgr-apply" ${okN?"":"disabled"}>${sched.published?"اعمال و ارسال برای افراد":"اعمال"}</button><button class="btn quiet" data-act="mgr-cancel">لغو</button></p>`;
  }
  return h+`</div>`;
}
function schedSummary(){
  const o={};
  for(const k in sched.slots){const sl=sched.slots[k];o[k]={units:sl.pairs.map(p=>({unit:p.u,doctor:p.d,assistant:p.a})),reception:sl.reception,free:sl.free,spare_doctors:sl.spare||[]}}
  return o;
}
function answerCount(role,day){
  if(!sched) return "هنوز برنامه این هفته ساخته نشده است.";
  let k=day;
  if(!k){
    const jsToKey={6:"sat",0:"sun",1:"mon",2:"tue",3:"wed",4:"thu",5:null};
    k=jsToKey[new Date().getDay()];
    if(!k) return "امروز جمعه است؛ کلینیک برنامه‌ای ندارد.";
  }
  const ids=new Set();
  for(const sk of ["m","e"]){
    const sl=sched.slots?.[k+"_"+sk]; if(!sl) continue;
    for(const p of sl.pairs||[]){ if(p.d) ids.add(p.d); if(p.a) ids.add(p.a); }
    for(const r of sl.reception||[]) ids.add(r);
  }
  const list=[...ids].filter(byId);
  if(role){
    const rs=list.filter(id=>byId(id).role===role);
    return `${DAYN[k]}: ${fa(rs.length)} ${ROLEN[role]}${rs.length?" ("+rs.map(nm).join("، ")+")":""} حضور ${rs.length===1?"دارد":"دارند"}.`;
  }
  const byRole=r=>list.filter(id=>byId(id).role===r).length;
  return `${DAYN[k]}: مجموعاً ${fa(list.length)} نفر حضور دارند (${fa(byRole("doctor"))} دکتر، ${fa(byRole("assistant"))} دستیار، ${fa(byRole("reception"))} منشی).`;
}
async function mgrParseRun(){
  const text=mgrDraft.trim(); if(!text){mgrErr="اول چیزی بنویسید.";return render()}
  mgrBusy=true;mgrErr="";render();

  try{
    const r=NLU.weekly(text,cfg.staff,cfg.settings); FB.nlu("weekly",text,r);
    const all=Array.isArray(r?.actions)?r.actions:[], rej=Array.isArray(r?.rejected)?r.rejected.map(String):[];
    const staffActs=[], ruleActs=[], edits=[], asks=[];
    const SYN={fire:"remove_staff",remove_person:"remove_staff",delete_staff:"remove_staff",staff_left:"remove_staff",leave:"remove_staff",hire:"add_staff",new_staff:"add_staff"};
    for(const a0 of all){
      const a=a0&&SYN[a0.op]?{...a0,op:SYN[a0.op],id:a0.id||a0.person}:(a0?.op==="remove_staff"&&!a0.id&&a0.person?{...a0,id:a0.person}:a0);
      if(a?.op==="ask_count"){asks.push(a);continue}
      if(a?.op==="remove_staff"||a?.op==="add_staff"){const v=validate(a); if(v) staffActs.push(v); else rej.push("یکی از افراد پیدا نشد.");}
      else if(a?.op==="block_week"){const v=validate({op:"add_rule",rule:{type:"block",id:a.id,day:a.day||null,shift:a.shift||null,temporary:true}}); if(v){ruleActs.push(v); edits.push(...DAYS.filter(([k])=>!a.day||k===a.day).map(([k])=>({op:"remove",person:a.id,day:k,shift:a.shift||null})))} else rej.push("یکی از افراد پیدا نشد.");}
      else if(a?.op==="add_rule"||["set_pairing","add_to_pairing","remove_from_pairing","set_setting","set_specialty","rename"].includes(a?.op)){const v=validate(a); if(v) ruleActs.push(v); else rej.push("یکی از تغییرها با داده‌های کلینیک جور نبود.");}
      else edits.push(a);
    }
    if(staffActs.length||ruleActs.length){
      const sim=simulateRules([...staffActs,...ruleActs]);
      const pm=planManager(edits,[],sim.S,sim.c);
      const head=[...staffActs,...ruleActs].map(a=>({ok:true,text:describeAction(a)}));
      mgrPlan={S:pm.S,report:[...rej.map(t=>({ok:false,text:t})),...head,...sim.lines,...pm.report],notices:[...sim.notices,...pm.notices],confirms:pm.confirms,alerts:sim.alerts,touched:pm.touched,log:[...head.map(h=>h.text),...sim.lines.map(l=>l.text),...pm.log],cfgNew:sim.c,staffActs,ruleActs};
    } else if(!edits.length&&!rej.length&&asks.length){
      mgrPlan={S:structuredClone(sched),report:[],notices:[],confirms:[],touched:[],log:[]};
    } else mgrPlan=planManager(edits,rej);
    if(asks.length) mgrPlan.report=[...asks.map(a=>({ok:true,text:answerCount(a.role,a.day)})),...mgrPlan.report];
  }catch(e){mgrErr=errCopy(e)}
  mgrBusy=false;render();
}
function planManager(actions,rejected,base=sched,conf=cfg){
  const S=structuredClone(base), chairs=conf.settings.chairs, UNITS=Array.from({length:chairs},(_,i)=>i+1);
  const report=rejected.map(t=>({ok:false,text:t})), notices=[], confirms=[], touched=new Set(), log=[];
  const add=(ok,text,warn)=>{report.push({ok,text,warn:!!warn});if(ok)log.push(text)};
  const notify=(to,text)=>{to=to.filter(Boolean);if(to.length)notices.push({id:uid(),at:Date.now(),to,text})};
  const nt=(conf.rules||[]).filter(r=>r.type==="not_together").map(r=>r.ids);
  const peopleOf=sl=>new Set([...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception]);
  const clash=(x,set)=>nt.some(([p,q])=>(p===x&&set.has(q))||(q===x&&set.has(p)));
  const unitRule=d=>(conf.rules||[]).find(r=>r.type==="unit_pref"&&r.staff===d);
  const declared=(id,k,sk)=>!!(avail[id]?.confirmed&&avail[id].grid?.[k]?.[sk]);
  const role=id=>conf.staff.find(s=>s.id===id)?.role;
  const drop=(sl,id)=>{sl.free=(sl.free||[]).filter(x=>x!==id);sl.spare=(sl.spare||[]).filter(x=>x!==id)};
  for(const a of actions){
    if(!a||!DAYN[a.day]||!(a.shift==null||SHN[a.shift])){report.push({ok:false,text:"بخشی از دستور روز یا شیفت معتبر نداشت."});continue}
    for(const [sk] of SHIFTS.filter(([x])=>!a.shift||x===a.shift)){
      const k=a.day, key=k+"_"+sk, L=DAYN[k]+" "+SHN[sk], sl=S.slots[key]; if(!sl) continue;
      sl.spare=sl.spare||[]; sl.free=sl.free||[];
      const warnAv=id=>declared(id,k,sk)?"":` (توجه: ${nm(id)} این زمان را اعلام نکرده بود)`;
      if(a.op==="place_doctor"){
        const d=a.doctor; if(role(d)!=="doctor"){add(false,"دکتر پیدا نشد.");break}
        if(sl.pairs.some(p=>p.d===d)){if(a.shift)add(true,`${L}: ${nm(d)} همین حالا در برنامه است.`);continue}
        if(!a.shift&&!declared(d,k,sk)&&SHIFTS.some(([x])=>declared(d,k,x))) continue;
        const ppl=peopleOf(sl); if(clash(d,ppl)){add(false,`${L}: ${nm(d)} طبق قانون «با هم نباشند» نمی‌تواند در این شیفت باشد.`);continue}
        const used=new Set(sl.pairs.map(p=>p.u)); let u=a.unit;
        if(u!=null){ if(!UNITS.includes(u)){add(false,`${L}: یونیت ${fa(u)} وجود ندارد.`);continue} if(used.has(u)){const o=sl.pairs.find(p=>p.u===u);add(false,`${L}: یونیت ${fa(u)} دست ${nm(o.d)} است. اول او را جابه‌جا یا حذف کنید.`);continue} }
        else { const r=unitRule(d); const c=UNITS.filter(x=>!used.has(x)&&(!r?.allowed?.length||r.allowed.includes(x))); if(!c.length){add(false,`${L}: یونیت خالی ${r?.allowed?.length?"و مجاز ":""}برای ${nm(d)} نیست.`);continue} u=c[0]; }
        ppl.add(d);
        const as=sl.free.find(x=>role(x)==="assistant"&&(conf.pairings?.[d]||[]).includes(x)&&!clash(x,ppl))||null;
        drop(sl,d); if(as) drop(sl,as);
        sl.pairs.push({d,a:as,u}); sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99)); touched.add(key);
        const isForced=!declared(d,k,sk);
        if(isForced) confirms.push({id:uid(),at:Date.now(),key,unit:u,doctor:d,assistant:as,to:[d,...(as?[as]:[])],responses:{}});
        else{ notify([d],`${L}: مدیر شما را روی یونیت ${fa(u)} گذاشت${as?"، با "+nm(as):""}.`); if(as) notify([as],`${L}: با ${nm(d)} روی یونیت ${fa(u)} کار می‌کنی.`); }
        add(true,`${L}: ${nm(d)} روی یونیت ${fa(u)}${as?"، با "+nm(as):"، بدون دستیار"}${warnAv(d)}`,isForced||!as);
      }else if(a.op==="remove"){
        const x=a.person, r=role(x); if(!r){add(false,"فرد پیدا نشد.");break}
        if(r==="doctor"){const i=sl.pairs.findIndex(p=>p.d===x); if(i<0){if(a.shift)add(false,`${L}: ${nm(x)} در برنامه نیست.`);continue} const p=sl.pairs.splice(i,1)[0]; if(p.a){sl.free.push(p.a);notify([p.a],`${L}: ${nm(x)} از برنامه برداشته شد. فعلاً در فهرست آزاد هستی.`)} notify([x],`${L}: مدیر شما را از برنامه برداشت.`); touched.add(key); add(true,`${L}: ${nm(x)} برداشته شد و یونیت ${fa(p.u)} خالی ماند.`,true)}
        else if(r==="assistant"){const p=sl.pairs.find(p=>p.a===x); if(!p){if(a.shift)add(false,`${L}: ${nm(x)} در برنامه نیست.`);continue} p.a=null; notify([x],`${L}: مدیر شما را از برنامه برداشت.`); notify([p.d],`${L}: ${nm(x)} دیگر دستیار شما نیست.`); touched.add(key); add(true,`${L}: ${nm(x)} برداشته شد و ${nm(p.d)} بدون دستیار ماند.`,true)}
        else {if(!sl.reception.includes(x)){if(a.shift)add(false,`${L}: ${nm(x)} در برنامه نیست.`);continue} sl.reception=sl.reception.filter(y=>y!==x); notify([x],`${L}: مدیر شما را از پذیرش برداشت.`); touched.add(key); add(true,`${L}: ${nm(x)} از پذیرش برداشته شد.`)}
      }else if(a.op==="set_assistant"){
        const d=a.doctor, as=a.assistant; if(role(d)!=="doctor"||role(as)!=="assistant"){add(false,"دکتر یا دستیار پیدا نشد.");break}
        const p=sl.pairs.find(q=>q.d===d); if(!p){if(a.shift)add(false,`${L}: ${nm(d)} در این شیفت نیست.`);continue}
        if(p.a===as){add(true,`${L}: ${nm(as)} همین حالا دستیار ${nm(d)} است.`);continue}
        const ppl=peopleOf(sl); if(p.a) ppl.delete(p.a); const other=sl.pairs.find(q=>q.a===as&&q!==p); if(other) ppl.delete(as);
        if(clash(as,ppl)){add(false,`${L}: ${nm(as)} طبق قانون «با هم نباشند» نمی‌تواند در این شیفت باشد.`);continue}
        const prev=p.a; if(prev) sl.free.push(prev); if(other){other.a=null;notify([other.d],`${L}: ${nm(as)} به ${nm(d)} منتقل شد و فعلاً دستیار ندارید.`)}
        drop(sl,as); p.a=as; touched.add(key);
        notify([as],`${L}: با ${nm(d)} روی یونیت ${fa(p.u)} کار می‌کنی.`); notify([d],`${L}: ${nm(as)} دستیار شماست.`); if(prev) notify([prev],`${L}: مدیر دستیار دیگری برای ${nm(d)} گذاشت. فعلاً در فهرست آزاد هستی.`);
        add(true,`${L}: ${nm(as)} دستیار ${nm(d)} شد${other?"، و "+nm(other.d)+" بدون دستیار ماند":""}${warnAv(as)}`,!!other||!declared(as,k,sk));
      }else if(a.op==="set_unit"){
        const d=a.doctor,u=a.unit; const p=sl.pairs.find(q=>q.d===d); if(!p){if(a.shift)add(false,`${L}: ${nm(d)} در این شیفت نیست.`);continue}
        if(!UNITS.includes(u)){add(false,`${L}: یونیت ${fa(u)} وجود ندارد.`);continue} if(p.u===u){add(true,`${L}: ${nm(d)} همین حالا روی یونیت ${fa(u)} است.`);continue}
        const o=sl.pairs.find(q=>q.u===u); const old=p.u; p.u=u; if(o){o.u=old; notify([o.d,o.a],`${L}: یونیت ${nm(o.d)} به ${fa(old)} تغییر کرد.`)}
        sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99)); touched.add(key); notify([d,p.a],`${L}: یونیت ${nm(d)} به ${fa(u)} تغییر کرد.`);
        add(true,`${L}: ${nm(d)} روی یونیت ${fa(u)}${o?"، و "+nm(o.d)+" روی یونیت "+fa(old):""}`);
      }else if(a.op==="add_reception"){
        const x=a.person; if(role(x)!=="reception"){add(false,"منشی پیدا نشد.");break}
        if(sl.reception.includes(x)){add(true,`${L}: ${nm(x)} همین حالا در پذیرش است.`);continue}
        if(clash(x,peopleOf(sl))){add(false,`${L}: ${nm(x)} طبق قانون «با هم نباشند» نمی‌تواند در این شیفت باشد.`);continue}
        drop(sl,x); sl.reception.push(x); touched.add(key); notify([x],`${L}: مدیر شما را در پذیرش گذاشت.`);
        add(true,`${L}: ${nm(x)} در پذیرش${warnAv(x)}`,!declared(x,k,sk));
      }else {report.push({ok:false,text:"بخشی از دستور فهمیده نشد."});break}
    }
  }
  if(!report.length&&base===sched) report.push({ok:false,text:"تغییری در دستور پیدا نشد. اگر منظورتان حذف کامل کسی است، بنویسید «… دیگر در کلینیک کار نمی‌کند» یا از تب «کارکنان» دکمه حذف را بزنید."});
  return {S,report,notices,confirms,touched:[...touched],log};
}
async function mgrApply(){
  const pl=mgrPlan, S=pl.S;
  if(pl.cfgNew){
    const removed=(pl.staffActs||[]).filter(a=>a.op==="remove_staff").map(a=>a.id);
    S.alerts=[...(S.alerts||[]),...(pl.alerts||[])].slice(-60);
    pl.log=pl.log.map(t=>t); for(const id of removed){ pl.log=pl.log.map(t=>t.split(nm(id)).join("همکار سابق")); }
    for(const id of removed) scrubPerson(S,id,nm(id));
    pl.notices=pl.notices.map(n=>({...n,to:(n.to||[]).filter(x=>!removed.includes(x))})).filter(n=>n.to.length);
    try{ for(const id of removed){ try{await db.doc("avail/"+id).delete()}catch(e){} } const c=pl.cfgNew; if(c.former) delete c.former; await db.doc("clinic/config").set(c); }
    catch(e){ mgrErr="ذخیره نشد. دوباره بزنید."; mgrPlan=null; return render(); }
  }
  S.alerts=(S.alerts||[]).map(a=>!a.resolved&&pl.touched.includes(a.key)?{...a,resolved:true}:a);
  S.notices=[...(S.notices||[]),...pl.notices].slice(-80);
  S.confirms=[...(S.confirms||[]),...(pl.confirms||[])].slice(-60);
  S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:pl.cfgNew?"":mgrDraft,items:pl.log}].slice(-40);
  if(S.published) S.rev=(S.rev||1)+1;
  S.baseConflicts=[...new Set([...(S.baseConflicts||[]),...checkConflicts(pl.cfgNew||cfg,S).map(x=>x.text)])];
  try{await db.doc("clinic/schedule").set(S);mgrPlan=null;mgrDraft=""}catch(e){mgrErr="ذخیره نشد. دوباره بزنید.";mgrPlan=null}
  render();
}

/* ---------- conflicts between schedule and rules ---------- */
function checkConflicts(c,S){
  if(!S?.slots) return [];
  const out=[], rules=c.rules||[], chairs=c.settings.chairs;
  const nmC=id=>c.staff.find(s=>s.id===id)?.name||id, spC=id=>c.staff.find(s=>s.id===id)?.specialty||"";
  const cnt={}, where={}, dayCnt={};
  for(const [k,dn] of DAYS) for(const [sk,sn] of SHIFTS){
    const key=k+"_"+sk, L=dn+" "+sn, sl=S.slots[key]; if(!sl) continue;
    const ppl=[...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception];
    for(const x of ppl){cnt[x]=(cnt[x]||0)+1;(where[x]=where[x]||[]).push(key)}
    const set=new Set(ppl);
    for(const r of rules){
      if(r.type==="not_together"&&set.has(r.ids[0])&&set.has(r.ids[1])) out.push({key,text:`${L}: «${nmC(r.ids[0])}» و «${nmC(r.ids[1])}» با هم در یک شیفت هستند.`});
      if(r.type==="block"&&set.has(r.staff)&&(!r.day||r.day===k)&&(!r.shift||r.shift===sk)) out.push({key,text:`${L}: «${nmC(r.staff)}» نباید شیفت داشته باشد.`});
      if(r.type==="unit_pref"&&r.allowed?.length){const p=sl.pairs.find(p=>p.d===r.staff); if(p&&!r.allowed.includes(p.u)) out.push({key,text:`${L}: «${nmC(r.staff)}» روی یونیت ${fa(p.u)} است، ولی فقط یونیت ${r.allowed.map(fa).join("، ")} مجاز است.`})}
      if(r.type==="require_specialty"&&r.per==="shift"&&(!r.day||r.day===k)&&(!r.shift||r.shift===sk)&&sl.pairs.length){const n=sl.pairs.filter(p=>spC(p.d)===r.specialty).length; if(n<r.n) out.push({key,text:`${L}: دکتر ${r.specialty} کم است.`})}
    }
    for(const p of sl.pairs){
      if(p.a&&c.pairings?.[p.d]&&!c.pairings[p.d].includes(p.a)) out.push({key,text:`${L}: «${nmC(p.a)}» جزو دستیارهای مجاز «${nmC(p.d)}» نیست.`});
      if(p.u>chairs) out.push({key,text:`${L}: یونیت ${fa(p.u)} دیگر وجود ندارد.`});
      const sp=spC(p.d); if(sp){dayCnt[k]=dayCnt[k]||{};dayCnt[k][sp]=(dayCnt[k][sp]||0)+1}
    }
    if(sl.pairs.length&&sl.reception.length<c.settings.receptionPerShift) out.push({key,text:`${L}: ${fa(c.settings.receptionPerShift)} منشی لازم است، ${fa(sl.reception.length)} نفر هست.`});
  }
  for(const r of rules){
    if(r.type==="max_shifts"&&(cnt[r.staff]||0)>r.n) out.push({keys:where[r.staff],text:`«${nmC(r.staff)}» ${fa(cnt[r.staff])} شیفت دارد، ولی حداکثر ${fa(r.n)} مجاز است.`});
    if(r.type==="require_specialty"&&r.per==="day") for(const [k,dn] of DAYS){ if(r.day&&r.day!==k) continue; if((dayCnt[k]?.[r.specialty]||0)<r.n) out.push({keys:[k+"_m",k+"_e"],text:`${dn}: دکتر ${r.specialty} کم است.`}) }
  }
  return out.map(o=>({keys:o.keys||[o.key],text:o.text}));
}
function newConflicts(){
  if(!sched) return [];
  const base=new Set(sched.baseConflicts||[]);
  return checkConflicts(cfg,sched).filter(x=>!base.has(x.text));
}
function conflictBanner(){
  const nc=newConflicts(); if(!nc.length) return "";
  const keys=[...new Set(nc.flatMap(x=>x.keys))];
  return `<div class="panel" style="border:2px solid var(--warn)">
    <strong style="color:var(--warn)">برنامه باید دوباره ساخته شود</strong>
    <p class="note" style="margin:2px 0 6px">قوانین بعد از ساخت برنامه عوض شده‌اند و برنامه فعلی در ${fa(nc.length)} مورد با آن‌ها نمی‌خواند:</p>
    <ul class="clean issues">${nc.slice(0,12).map(x=>`<li>${esc(x.text)}</li>`).join("")}${nc.length>12?`<li class="note">و ${fa(nc.length-12)} مورد دیگر</li>`:""}</ul>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" data-act="rebuild-part">ساخت دوباره فقط ${fa(keys.length)} شیفت درگیر</button>
      <button class="btn" data-act="build">ساخت دوباره کل برنامه</button>
      <button class="btn quiet" data-act="ignore-conf">نگه داشتن برنامه فعلی</button>
    </div>
    <p class="note" style="margin:8px 0 0">${sched.published?"ساخت دوباره شیفت‌های درگیر، بقیه برنامه را دست نمی‌زند و به افرادی که شیفتشان عوض شده خبر می‌دهد. ساخت دوباره کل برنامه نیاز به تأیید و ارسال دوباره دارد.":"می‌توانید با دستور در بخش «تغییر برنامه این هفته» هم دستی اصلاح کنید."}</p>
  </div>`;
}
function assignDesc(sl,id){
  const p=sl.pairs.find(p=>p.d===id); if(p) return `یونیت ${fa(p.u)}، با ${p.a?nm(p.a):"بدون دستیار"}`;
  const q=sl.pairs.find(p=>p.a===id); if(q) return `با ${nm(q.d)}، یونیت ${fa(q.u)}`;
  if(sl.reception.includes(id)) return "پذیرش";
  return null;
}
async function partialRebuild(btn){
  const nc=newConflicts(); const keys=[...new Set(nc.flatMap(x=>x.keys))]; if(!keys.length) return;
  btn.disabled=true;
  const nb=buildSchedule({base:sched,redo:new Set(keys)});
  const S=structuredClone(sched); S.slots=nb.slots; S.issues=nb.issues;
  const notices=[], changed=[];
  for(const key of keys){
    const [k,sk]=key.split("_"), L=DAYN[k]+" "+SHN[sk], o=sched.slots[key], n=S.slots[key];
    for(const s of cfg.staff){
      const a=assignDesc(o,s.id), b=assignDesc(n,s.id); if(a===b) continue;
      notices.push({id:uid(),at:Date.now(),to:[s.id],text:b?`${L}: برنامه‌ات عوض شد: ${b}.`:`${L}: شیفتت برداشته شد.`});
    }
    changed.push(L);
  }
  S.alerts=(S.alerts||[]).map(a=>!a.resolved&&keys.includes(a.key)?{...a,resolved:true}:a);
  S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:"",items:[`ساخت دوباره به‌خاطر تغییر قوانین: ${changed.join("، ")}`]}].slice(-40);
  S.notices=[...(S.notices||[]),...notices].slice(-80); if(S.published) S.rev=(S.rev||1)+1;
  S.baseConflicts=checkConflicts(cfg,S).map(x=>x.text);
  await db.doc("clinic/schedule").set(S);
}
function ruleImpact(actions){
  if(!sched) return null;
  const before=new Set([...(sched.baseConflicts||[]),...checkConflicts(cfg,sched).map(x=>x.text)]);
  return checkConflicts(applyRuleActions(cfg,actions),sched).filter(x=>!before.has(x.text)).map(x=>x.text);
}

/* ---------- staff leaving / joining ---------- */
function removeFromSched(S,c,id){
  const lines=[], notices=[], alerts=[];
  const person=cfg.staff.find(s=>s.id===id); if(!person||!S?.slots) return {lines,notices,alerts};
  const role=person.role, who=person.name;
  const roleOf=x=>c.staff.find(s=>s.id===x)?.role;
  const nt=(c.rules||[]).filter(r=>r.type==="not_together").map(r=>r.ids);
  const clash=(x,set)=>nt.some(([p,q])=>(p===x&&set.has(q))||(q===x&&set.has(p)));
  const peopleOf=sl=>new Set([...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception]);
  const unitRule=d=>(c.rules||[]).find(r=>r.type==="unit_pref"&&r.staff===d);
  const notify=(to,text)=>{to=to.filter(Boolean);if(to.length)notices.push({id:uid(),at:Date.now(),to,text})};
  for(const [k,dn] of DAYS) for(const [sk,sn] of SHIFTS){
    const key=k+"_"+sk, L=dn+" "+sn, sl=S.slots[key]; if(!sl) continue;
    sl.free=(sl.free||[]).filter(x=>x!==id); sl.spare=(sl.spare||[]).filter(x=>x!==id);
    if(role==="doctor"){
      const i=sl.pairs.findIndex(p=>p.d===id); if(i<0) continue;
      const p=sl.pairs.splice(i,1)[0], ppl=peopleOf(sl);
      const sp=sl.spare.find(d=>{const r=unitRule(d);return !clash(d,ppl)&&(!r?.allowed?.length||r.allowed.includes(p.u))});
      if(sp){
        sl.spare=sl.spare.filter(x=>x!==sp); ppl.add(sp);
        let as=p.a&&(c.pairings?.[sp]||[]).includes(p.a)&&!clash(p.a,ppl)?p.a:null;
        if(!as){ if(p.a) sl.free.push(p.a); as=sl.free.find(x=>roleOf(x)==="assistant"&&(c.pairings?.[sp]||[]).includes(x)&&!clash(x,ppl))||null; if(as) sl.free=sl.free.filter(x=>x!==as); }
        sl.pairs.push({d:sp,a:as,u:p.u}); sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99));
        notify([sp],`${L}: شما روی یونیت ${fa(p.u)} قرار گرفتید${as?"، با "+nm(as):""}.`); if(as) notify([as],`${L}: با ${nm(sp)} روی یونیت ${fa(p.u)} کار می‌کنی.`);
        if(p.a&&p.a!==as) notify([p.a],`${L}: ${who} دیگر در کلینیک نیست. فعلاً در فهرست آزاد هستی.`);
        lines.push({ok:true,text:`${L}: ${nm(sp)} جای ${who} روی یونیت ${fa(p.u)} می‌آید${as?"، با "+nm(as):"، بدون دستیار"}.`});
        if(!as) alerts.push({id:uid(),at:Date.now(),key,text:`${L}: ${nm(sp)} جای ${who} آمد ولی دستیار آزاد ندارد.`,resolved:false});
      }else{
        if(p.a){sl.free.push(p.a);notify([p.a],`${L}: ${who} دیگر در کلینیک نیست. فعلاً در فهرست آزاد هستی.`)}
        lines.push({ok:false,text:`${L}: یونیت ${fa(p.u)} خالی می‌ماند؛ دکتر جایگزین در دسترس نیست.`});
        alerts.push({id:uid(),at:Date.now(),key,text:`${L}: یونیت ${fa(p.u)} بعد از رفتن ${who} خالی ماند.`,resolved:false});
      }
    }else if(role==="assistant"){
      const p=sl.pairs.find(p=>p.a===id); if(!p) continue;
      p.a=null; const ppl=peopleOf(sl);
      const rep=sl.free.find(x=>roleOf(x)==="assistant"&&(c.pairings?.[p.d]||[]).includes(x)&&!clash(x,ppl));
      if(rep){p.a=rep;sl.free=sl.free.filter(x=>x!==rep);notify([rep],`${L}: با ${nm(p.d)} روی یونیت ${fa(p.u)} کار می‌کنی.`);notify([p.d],`${L}: ${nm(rep)} دستیار شماست.`);lines.push({ok:true,text:`${L}: ${nm(rep)} دستیار ${nm(p.d)} می‌شود.`})}
      else{notify([p.d],`${L}: ${who} دیگر در کلینیک نیست و فعلاً دستیار ندارید. مدیر در جریان است.`);lines.push({ok:false,text:`${L}: ${nm(p.d)} بدون دستیار می‌ماند؛ دستیار مجاز و آزاد نیست.`});alerts.push({id:uid(),at:Date.now(),key,text:`${L}: ${nm(p.d)} بعد از رفتن ${who} بدون دستیار ماند.`,resolved:false})}
    }else{
      if(!sl.reception.includes(id)) continue;
      sl.reception=sl.reception.filter(x=>x!==id); const ppl=peopleOf(sl);
      const rep=sl.free.find(x=>roleOf(x)==="reception"&&!clash(x,ppl));
      if(rep){sl.reception.push(rep);sl.free=sl.free.filter(x=>x!==rep);notify([rep],`${L}: در پذیرش هستی.`);lines.push({ok:true,text:`${L}: ${nm(rep)} در پذیرش جای ${who} می‌آید.`})}
      else{lines.push({ok:false,text:`${L}: منشی جایگزین در دسترس نیست.`});alerts.push({id:uid(),at:Date.now(),key,text:`${L}: بعد از رفتن ${who} منشی کم است.`,resolved:false})}
    }
  }
  return {lines,notices,alerts};
}
function simulateRules(actions){
  const c=applyRuleActions(cfg,actions);
  let S=sched?structuredClone(sched):null; const lines=[], notices=[], alerts=[];
  for(const a of actions.filter(a=>a.op==="remove_staff")){
    const r=removeFromSched(S,c,a.id); lines.push(...r.lines); notices.push(...r.notices); alerts.push(...r.alerts);
  }
  let impact=null;
  if(S){ const before=new Set([...(sched.baseConflicts||[]),...checkConflicts(cfg,sched).map(x=>x.text)]);
    impact=checkConflicts(c,S).filter(x=>!before.has(x.text)).map(x=>x.text); }
  return {c,S,lines,notices,alerts,impact};
}

function scrubPerson(S,id,name){
  const rep=t=>typeof t==="string"&&name?t.split(name).join("همکار سابق"):t;
  S.notices=(S.notices||[]).map(n=>({...n,to:n.to==="all"?"all":(n.to||[]).filter(x=>x!==id),text:rep(n.text)})).filter(n=>n.to==="all"||n.to.length);
  S.log=(S.log||[]).filter(l=>l.who!==id).map(l=>({...l,text:rep(l.text),items:(l.items||[]).map(rep)}));
  S.alerts=(S.alerts||[]).map(a=>({...a,text:rep(a.text)}));
  S.confirms=(S.confirms||[]).filter(c=>c.doctor!==id).map(c=>({...c,to:(c.to||[]).filter(x=>x!==id)}));
  S.issues=(S.issues||[]).map(rep); S.baseConflicts=(S.baseConflicts||[]).map(rep);
  for(const k in S.slots){const sl=S.slots[k]; sl.free=(sl.free||[]).filter(x=>x!==id); sl.spare=(sl.spare||[]).filter(x=>x!==id); sl.reception=sl.reception.filter(x=>x!==id); for(const p of sl.pairs) if(p.a===id) p.a=null; sl.pairs=sl.pairs.filter(p=>p.d!==id)}
}
/* ---------- absence requests & cover calls ---------- */
let reqs={}, resps={}, rsnDraft={};
const keyLabel=key=>{const [k,sk]=key.split("_");return DAYN[k]+" "+SHN[sk]};
function inSlot(sl,id){return !!sl&&(sl.pairs.some(p=>p.d===id||p.a===id)||sl.reception.includes(id))}
function eligible(r,id){
  const me=byId(id); if(!me||id===r.who||me.role!==r.role) return false;
  if(r.asked&&!r.asked.includes(id)) return false;
  return !inSlot(sched?.slots?.[r.key],id);
}
function volunteers(rid,can=true){return Object.values(resps).filter(x=>x.reqId===rid&&x.can===can).map(x=>x.staff).filter(id=>byId(id))}
function reqContext(r){
  const sl=sched?.slots?.[r.key]; if(!sl) return "";
  if(r.role==="doctor"){const p=sl.pairs.find(p=>p.d===r.who);return p?`یونیت ${fa(p.u)}${p.a?"، با "+nm(p.a):""}`:""}
  if(r.role==="assistant"){const p=r.kind==="gap"?sl.pairs.find(p=>p.d===r.doctor):sl.pairs.find(p=>p.a===r.who);return p?`دستیار ${nm(p.d)}، یونیت ${fa(p.u)}`:""}
  return "پذیرش";
}
function volCheck(r,id){
  const [k,sk]=r.key.split("_"), sl=sched.slots[r.key], notes=[]; let block=false;
  if(!(avail[id]?.confirmed&&avail[id].grid?.[k]?.[sk])) notes.push("این زمان را اعلام نکرده بود");
  const nt=(cfg.rules||[]).filter(x=>x.type==="not_together").map(x=>x.ids);
  const ppl=new Set([...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception]); ppl.delete(r.who);
  if(nt.some(([p,q])=>(p===id&&ppl.has(q))||(q===id&&ppl.has(p)))){notes.push("با قانون «با هم نباشند» تداخل دارد");block=true}
  if(r.role==="assistant"){const p=r.kind==="gap"?sl.pairs.find(p=>p.d===r.doctor):sl.pairs.find(p=>p.a===r.who); if(p&&!(cfg.pairings?.[p.d]||[]).includes(id)) notes.push(`جزو دستیارهای مجاز ${nm(p.d)} نیست`)}
  if(r.role==="doctor"){const p=sl.pairs.find(p=>p.d===r.who), ur=(cfg.rules||[]).find(x=>x.type==="unit_pref"&&x.staff===id); if(p&&ur?.allowed?.length&&!ur.allowed.includes(p.u)){notes.push(`فقط روی یونیت ${ur.allowed.map(fa).join("، ")} کار می‌کند`);block=true}}
  const b=(cfg.rules||[]).find(x=>x.type==="block"&&x.staff===id&&(!x.day||x.day===k)&&(!x.shift||x.shift===sk)); if(b){notes.push("طبق قانون مدیر در این زمان شیفت نمی‌گیرد");block=true}
  return {notes,block};
}
function applyCancelSlot(S,c,id,key,repl){
  const lines=[], notices=[], alerts=[];
  const sl=S.slots[key]; if(!sl) return {lines,notices,alerts};
  const L=keyLabel(key), who=nm(id), role=byId(id)?.role;
  const roleOf=x=>c.staff.find(s=>s.id===x)?.role;
  const nt=(c.rules||[]).filter(r=>r.type==="not_together").map(r=>r.ids);
  const clash=(x,set)=>nt.some(([p,q])=>(p===x&&set.has(q))||(q===x&&set.has(p)));
  const peopleOf=()=>new Set([...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception]);
  const unitRule=d=>(c.rules||[]).find(r=>r.type==="unit_pref"&&r.staff===d);
  const notify=(to,text)=>{to=to.filter(Boolean);if(to.length)notices.push({id:uid(),at:Date.now(),to,text})};
  const drop=x=>{sl.free=(sl.free||[]).filter(y=>y!==x);sl.spare=(sl.spare||[]).filter(y=>y!==x)};
  sl.free=sl.free||[]; sl.spare=sl.spare||[]; drop(id);
  if(role==="doctor"){
    const i=sl.pairs.findIndex(p=>p.d===id); if(i<0) return {lines,notices,alerts};
    const p=sl.pairs.splice(i,1)[0], ppl=peopleOf();
    const sp=repl||sl.spare.find(d=>{const r=unitRule(d);return !clash(d,ppl)&&(!r?.allowed?.length||r.allowed.includes(p.u))});
    if(sp){
      drop(sp); ppl.add(sp);
      let as=p.a&&(c.pairings?.[sp]||[]).includes(p.a)&&!clash(p.a,ppl)?p.a:null;
      if(!as){ if(p.a) sl.free.push(p.a); as=sl.free.find(x=>roleOf(x)==="assistant"&&(c.pairings?.[sp]||[]).includes(x)&&!clash(x,ppl))||null; if(as) drop(as); }
      sl.pairs.push({d:sp,a:as,u:p.u}); sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99));
      notify([sp],`${L}: شما روی یونیت ${fa(p.u)} جایگزین ${who} شدید${as?"، با "+nm(as):"، فعلاً بدون دستیار"}.`);
      if(as) notify([as],`${L}: با ${nm(sp)} روی یونیت ${fa(p.u)} کار می‌کنی.`);
      if(p.a&&p.a!==as) notify([p.a],`${L}: ${who} نمی‌آید. فعلاً در فهرست آزاد هستی.`);
      lines.push({ok:true,text:`${L}: ${nm(sp)} جای ${who} روی یونیت ${fa(p.u)}${as?"، با "+nm(as):"، بدون دستیار"}.`});
      if(!as) alerts.push({id:uid(),at:Date.now(),key,text:`${L}: ${nm(sp)} جای ${who} آمد ولی دستیار آزاد ندارد.`,resolved:false});
    }else{
      if(p.a){sl.free.push(p.a);notify([p.a],`${L}: ${who} نمی‌آید. فعلاً در فهرست آزاد هستی.`)}
      lines.push({ok:false,text:`${L}: یونیت ${fa(p.u)} خالی ماند.`});
      alerts.push({id:uid(),at:Date.now(),key,text:`${L}: ${who} نمی‌آید و یونیت ${fa(p.u)} خالی ماند.`,resolved:false});
    }
  }else if(role==="assistant"){
    const p=sl.pairs.find(p=>p.a===id); if(!p) return {lines,notices,alerts};
    p.a=null; const ppl=peopleOf();
    const rep=repl||sl.free.find(x=>roleOf(x)==="assistant"&&(c.pairings?.[p.d]||[]).includes(x)&&!clash(x,ppl));
    if(rep){drop(rep);p.a=rep;notify([rep],`${L}: جای ${who} با ${nm(p.d)} روی یونیت ${fa(p.u)} کار می‌کنی.`);notify([p.d],`${L}: ${who} نمی‌آید. ${nm(rep)} دستیار شماست.`);lines.push({ok:true,text:`${L}: ${nm(rep)} دستیار ${nm(p.d)} شد.`})}
    else{notify([p.d],`${L}: ${who} نمی‌آید و فعلاً دستیار ندارید.`);lines.push({ok:false,text:`${L}: ${nm(p.d)} بدون دستیار ماند.`});alerts.push({id:uid(),at:Date.now(),key,text:`${L}: ${nm(p.d)} بدون دستیار ماند.`,resolved:false})}
  }else{
    if(!sl.reception.includes(id)) return {lines,notices,alerts};
    sl.reception=sl.reception.filter(x=>x!==id); const ppl=peopleOf();
    const rep=repl||sl.free.find(x=>roleOf(x)==="reception"&&!clash(x,ppl));
    if(rep){drop(rep);sl.reception.push(rep);notify([rep],`${L}: جای ${who} در پذیرش هستی.`);lines.push({ok:true,text:`${L}: ${nm(rep)} در پذیرش جای ${who}.`})}
    else{lines.push({ok:false,text:`${L}: منشی کم است.`});alerts.push({id:uid(),at:Date.now(),key,text:`${L}: منشی جایگزین پیدا نشد.`,resolved:false})}
  }
  return {lines,notices,alerts};
}

/* manager side */
let dprefs={};
function coverWhat(r){
  const sl=sched?.slots?.[r.key]; if(!sl) return ROLEN[r.role];
  if(r.role==="assistant"){const p=r.kind==="gap"?sl.pairs.find(p=>p.d===r.doctor):(sl.pairs.find(p=>p.a===r.who)||sl.pairs.find(p=>p.d===r.doctor));return p?`کار با ${nm(p.d)} (یونیت ${fa(p.u)})`:"دستیاری"}
  if(r.role==="doctor"){const p=sl.pairs.find(p=>p.d===r.who);return p?`یونیت ${fa(p.u)}${p.a?"، با "+nm(p.a):""}`:"دکتر"}
  return "پذیرش";
}
function docPref(r){return dprefs[r.id]?.pick||null}
function askStatus(r){
  const asked=(r.asked||[]).filter(x=>byId(x));
  const extra=Object.values(resps).filter(x=>x.reqId===r.id&&!asked.includes(x.staff)&&byId(x.staff)).map(x=>x.staff);
  const pf=docPref(r);
  return [...asked,...extra].map(id=>{const x=resps[r.id+"__"+id];return {id,st:x?(x.can?"yes":"no"):"wait",pref:id===pf}}).sort((a,b)=>b.pref-a.pref);
}
function requestsPanel(){
  const pend=Object.values(reqs).filter(liveReq).sort((a,b)=>a.at-b.at);
  if(!pend.length) return "";
  const lab={yes:["✓ می‌آید","var(--ok)"],no:["✗ نمی‌آید","var(--warn)"],wait:["… منتظر جواب","var(--muted)"]};
  return `<div class="panel" style="border:2px solid var(--accent)"><strong>درخواست‌های نبودن (${fa(pend.length)})</strong><p class="note" style="margin:2px 0 8px">تا تأیید شما، شیفت فرد سر جایش می‌ماند.</p>`+
  pend.map(r=>{
    const sts=askStatus(r);
    return `<div style="border-top:1px solid var(--line);padding:10px 0">
      <div>${r.kind==="gap"?`<strong>${esc(nm(r.doctor))}</strong> ${esc(keyLabel(r.key))} دستیار ندارد`:`<strong>${esc(nm(r.who))}</strong> (${ROLEN[r.role]}): ${esc(keyLabel(r.key))} <span class="note">${esc(reqContext(r))}</span>`}</div>
      ${r.text?`<div class="note">«${esc(r.text)}»</div>`:""}
      <div class="note" style="margin-top:6px">${sts.length?`پیام رفت برای ${r.askedOnCall?"آنکال‌ها":"همکاران هم‌رده"}:`:"کسی آنکال یا در دسترس نبود که از او پرسیده شود."}</div>
      ${r.doctor?`<div style="margin-top:4px">${docPref(r)?`<strong>ترجیح ${esc(nm(r.doctor))}:</strong> ${esc(nm(docPref(r)))}`:dprefs[r.id]?`<span class="note">${esc(nm(r.doctor))}: فرقی نمی‌کند</span>`:`<span class="note">${esc(nm(r.doctor))} هنوز ترجیحی نگفته</span>`}</div>`:""}
      ${sts.map(x=>{const c=volCheck(r,x.id);return `<div class="row" style="margin:4px 0"><span class="chip ${r.role}">${esc(nm(x.id))}</span><span style="color:${lab[x.st][1]};font-weight:500">${lab[x.st][0]}</span>${x.pref?`<span style="font-weight:700">★ ترجیح دکتر</span>`:""}${c.notes.length?`<span class="note">(${esc(c.notes.join("؛ "))})</span>`:""}${x.st!=="no"?`<button class="btn ${x.st==="yes"?"primary":"quiet"}" data-rq="ok|${r.id}|${x.id}" ${c.block?"disabled":""}>تأیید با ${esc(nm(x.id))}</button>`:""}</div>`}).join("")}
      <div class="row" style="margin-top:8px"><button class="btn" data-rq="ok|${r.id}|">تأیید، جایگزین خودکار</button>
        <input type="text" id="rsn-${r.id}" placeholder="دلیل (اختیاری)" value="${esc(rsnDraft[r.id]||"")}" style="flex:1;min-width:120px">
        <button class="btn" style="border-color:var(--warn);color:var(--warn)" data-rq="no|${r.id}|">${r.kind==="gap"?"بستن درخواست":"رد: باید بیاید"}</button></div>
    </div>`}).join("")+`</div>`;
}
function topAlerts(){
  if(!sched) return "";
  const pend=Object.values(reqs).filter(liveReq).sort((a,b)=>a.at-b.at);
  const al=(sched.alerts||[]).filter(a=>!a.resolved), nc=newConflicts();
  if(!pend.length&&!al.length&&!nc.length) return "";
  const icon={yes:"✓",no:"✗",wait:"…"};
  let h=`<div class="panel" style="border:2px solid var(--warn);background:var(--warn-bg)"><strong style="color:var(--warn)">هشدارها</strong><ul class="clean issues" style="margin-top:4px">`;
  for(const r of pend){const sts=askStatus(r);h+=`<li>${r.kind==="gap"?`<strong>${esc(nm(r.doctor))}</strong> ${esc(keyLabel(r.key))} دستیار ندارد.`:`<strong>${esc(nm(r.who))}</strong> ${esc(keyLabel(r.key))} نمی‌آید.`} ${sts.length?"پیام رفت برای: "+sts.map(x=>`${esc(nm(x.id))} ${icon[x.st]}`).join("، "):"کسی برای پرسیدن نبود."}${docPref(r)?` ترجیح ${esc(nm(r.doctor))}: ${esc(nm(docPref(r)))}.`:""}</li>`}
  for(const a of al.slice(0,5)) h+=`<li>${esc(a.text)}</li>`;
  if(al.length>5) h+=`<li class="note">و ${fa(al.length-5)} هشدار دیگر</li>`;
  if(nc.length) h+=`<li>برنامه با قوانین جدید در ${fa(nc.length)} مورد نمی‌خواند.</li>`;
  h+=`</ul>${tab!=="schedule"?`<p class="row" style="margin-top:8px"><button class="btn" data-tab="schedule">رسیدگی</button></p>`:""}</div>`;
  return h;
}

async function approveRequest(rid,vol){
  const r=reqs[rid]; if(!r||!sched) return;
  if(r.kind==="gap"){
    const S=structuredClone(sched), sl=S.slots[r.key], L=keyLabel(r.key), p=sl?.pairs.find(p=>p.d===r.doctor);
    let pick=vol||docPref(r)||askStatus(r).find(x=>x.st==="yes")?.id||null;
    if(!p||p.a){await db.doc("requests/"+rid).update({status:"approved",resolvedAt:Date.now()});return}
    const notes=[];
    if(pick){p.a=pick; sl.free=(sl.free||[]).filter(x=>x!==pick);
      notes.push({id:uid(),at:Date.now(),to:[pick],text:`${L}: با ${nm(r.doctor)} روی یونیت ${fa(p.u)} کار می‌کنی.`},{id:uid(),at:Date.now(),to:[r.doctor],text:`${L}: ${nm(pick)} دستیار شماست.`});}
    const others=(r.asked||[]).filter(x=>x!==pick); if(others.length) notes.push({id:uid(),at:Date.now(),to:others,text:`${L}: ممنون؛ ${pick?"کس دیگری انتخاب شد":"لازم نشد"}.`});
    S.notices=[...(S.notices||[]),...notes].slice(-80);
    if(!slotGaps(S,r.key).some(g=>g.t==="asst")) S.alerts=(S.alerts||[]).map(a=>a.key===r.key&&!a.resolved?{...a,resolved:true}:a);
    S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:"",items:[pick?`${L}: ${nm(pick)} دستیار ${nm(r.doctor)} شد.`:`${L}: درخواست دستیار برای ${nm(r.doctor)} بسته شد.`]}].slice(-40);
    if(S.published) S.rev=(S.rev||1)+1;
    const [k,sk]=r.key.split("_");
    await db.doc("clinic/schedule").set(S);
    await db.doc("requests/"+rid).update({status:"approved",replacement:pick,resolvedAt:Date.now()});
    if(pick){const b=avail[pick];const g=b?structuredClone(b.grid):emptyGrid();g[k][sk]=true;await db.doc("avail/"+pick).set({...(b||{staffId:pick,text:"",summary:""}),grid:g,confirmed:true,updatedAt:Date.now()})}
    return;
  }
  const S=structuredClone(sched), L=keyLabel(r.key);
  const res=inSlot(S.slots[r.key],r.who)?applyCancelSlot(S,cfg,r.who,r.key,vol||null):{lines:[],notices:[],alerts:[]};
  const others=volunteers(rid).filter(v=>v!==vol);
  const notices=[...res.notices,{id:uid(),at:Date.now(),to:[r.who],text:`${L}: مدیر با نبودنت موافقت کرد${vol?"؛ "+nm(vol)+" جایت می‌آید":""}.`}];
  if(others.length) notices.push({id:uid(),at:Date.now(),to:others,text:`${L}: ممنون از اعلام آمادگی؛ ${vol?"جایگزین دیگری انتخاب شد":"لازم نشد"}.`});
  S.notices=[...(S.notices||[]),...notices].slice(-80); S.alerts=[...(S.alerts||[]),...res.alerts].slice(-60);
  S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:"",items:[`${L}: نبودن ${nm(r.who)} تأیید شد${vol?"، جایگزین: "+nm(vol):""}.`,...res.lines.map(l=>l.text)]}].slice(-40);
  if(S.published) S.rev=(S.rev||1)+1; S.baseConflicts=[...new Set([...(S.baseConflicts||[]),...checkConflicts(cfg,S).map(x=>x.text)])];
  const [k,sk]=r.key.split("_");
  try{
    await db.doc("clinic/schedule").set(S);
    await db.doc("requests/"+rid).update({status:"approved",replacement:vol||null,resolvedAt:Date.now()});
    const a=avail[r.who]; if(a){const g=structuredClone(a.grid);g[k][sk]=false;await db.doc("avail/"+r.who).update({grid:g})}
    if(vol){const b=avail[vol];const g=b?structuredClone(b.grid):emptyGrid();g[k][sk]=true;await db.doc("avail/"+vol).set({...(b||{staffId:vol,text:"",summary:""}),grid:g,confirmed:true,updatedAt:Date.now()})}
  }catch(e){mgrErr="ذخیره نشد. دوباره بزنید."}
}
async function rejectRequest(rid){
  const r=reqs[rid]; if(!r||!sched) return;
  if(r.kind==="gap"){const S=structuredClone(sched);S.notices=[...(S.notices||[]),{id:uid(),at:Date.now(),to:r.asked||[],text:`${keyLabel(r.key)}: ممنون؛ لازم نشد.`}].slice(-80);await db.doc("clinic/schedule").set(S);await db.doc("requests/"+rid).update({status:"rejected",resolvedAt:Date.now()});return}
  const L=keyLabel(r.key), reason=(rsnDraft[rid]||"").trim(), vols=volunteers(rid);
  const S=structuredClone(sched);
  S.notices=[...(S.notices||[]),{id:uid(),at:Date.now(),to:[r.who],text:`${L}: مدیر با نبودنت موافقت نکرد و شیفتت سر جایش است.${reason?" دلیل: "+reason:""}`},...(vols.length?[{id:uid(),at:Date.now(),to:vols,text:`${L}: ممنون از اعلام آمادگی؛ لازم نشد.`}]:[])].slice(-80);
  S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:"",items:[`${L}: درخواست نبودن ${nm(r.who)} رد شد.${reason?" دلیل: "+reason:""}`]}].slice(-40);
  try{await db.doc("clinic/schedule").set(S);await db.doc("requests/"+rid).update({status:"rejected",reason,resolvedAt:Date.now()});delete rsnDraft[rid]}catch(e){mgrErr="ذخیره نشد. دوباره بزنید."}
}

/* staff side */
function coverPanel(id){
  if(!sched) return "";
  const list=Object.values(reqs).filter(r=>liveReq(r)&&eligible(r,id));
  if(!list.length) return "";
  return `<div class="panel newbox"><strong>درخواست حضور</strong>`+list.map(r=>{
    const mine=resps[r.id+"__"+id];
    return `<div style="border-top:1px solid var(--line);padding:8px 0"><div><strong>${esc(keyLabel(r.key))}:</strong> ${esc(coverWhat(r))}</div><div class="note">${r.kind==="gap"?"دستیار ندارد":"جای "+esc(nm(r.who))}${r.askedOnCall?"؛ تو در این شیفت آنکال هستی":""}${r.doctor&&docPref(r)===id?`؛ <strong>${esc(nm(r.doctor))} تو را ترجیح داده</strong>`:""}</div>
      <div class="row" style="margin-top:6px"><button class="btn ${mine?.can===true?"primary":""}" data-cv="1|${r.id}">هستم</button><button class="btn ${mine?.can===false?"primary":"quiet"}" data-cv="0|${r.id}">نیستم</button>
      ${mine?`<span class="note">${mine.can?"اعلام آمادگی کردی؛ منتظر تصمیم مدیر.":"ثبت شد."}</span>`:""}</div></div>`}).join("")+`</div>`;
}
function doctorSubPanel(id){
  if(byId(id)?.role!=="doctor") return "";
  const list=Object.values(reqs).filter(r=>liveReq(r)&&r.doctor===id);
  const gaps=[]; if(sched) for(const [k,dn] of DAYS) for(const [sk,sn] of SHIFTS){const key=k+"_"+sk, p=sched.slots[key]?.pairs.find(p=>p.d===id); if(p&&!p.a&&!list.some(r=>r.key===key)) gaps.push({key,u:p.u,oc:onCallFor(key,id)})}
  if(!list.length&&!gaps.length) return "";
  const gapHtml=gaps.map(g=>`<div style="border-top:1px solid var(--line);padding:8px 0"><div><strong>${esc(keyLabel(g.key))}:</strong> دستیار ندارید (یونیت ${fa(g.u)}).</div>${g.oc.length?`<div class="note" style="margin:4px 0">آنکال‌های این شیفت: ${g.oc.map(x=>esc(nm(x))+((cfg.pairings?.[id]||[]).includes(x)?"":" (غیرهمیشگی)")).join("، ")}</div><button class="btn primary" data-gask="${g.key}|${id}">از آنکال‌ها بپرس</button>`:`<div class="note">در این شیفت آنکالی نیست؛ مدیر در جریان است.</div>`}</div>`).join("");
  const lab={yes:["✓ هست","var(--ok)"],no:["✗ نیست","var(--warn)"],wait:["… منتظر جواب","var(--muted)"]};
  return `<div class="panel newbox"><strong>دستیار جایگزین</strong>`+gapHtml+list.map(r=>{
    const sts=askStatus(r), pf=docPref(r), set=!!dprefs[r.id];
    return `<div style="border-top:1px solid var(--line);padding:8px 0"><div><strong>${esc(keyLabel(r.key))}:</strong> ${r.kind==="gap"?"دستیار ندارید.":esc(nm(r.who))+" نمی‌تواند بیاید."}</div>
      <div class="note" style="margin:4px 0">${sts.length?"آزادند و از آن‌ها پرسیده شد؛ هر کدام را ترجیح می‌دهید انتخاب کنید. تصمیم نهایی با مدیر است.":"فعلاً دستیار آزادی نیست؛ مدیر در جریان است."}</div>
      ${sts.map(x=>`<div class="row" style="margin:4px 0"><span class="chip assistant">${esc(nm(x.id))}</span><span style="color:${lab[x.st][1]}">${lab[x.st][0]}</span>${(cfg.pairings?.[id]||[]).includes(x.id)?"":`<span class="note">(جزو دستیارهای همیشگی شما نیست)</span>`}${x.st!=="no"?`<button class="btn ${pf===x.id?"primary":"quiet"}" data-dp="${r.id}|${x.id}">${pf===x.id?"★ ترجیح من":"ترجیح من"}</button>`:""}</div>`).join("")}
      ${sts.length?`<p class="row" style="margin-top:6px"><button class="btn ${set&&!pf?"primary":"quiet"}" data-dp="${r.id}|">فرقی نمی‌کند</button></p>`:""}</div>`}).join("")+`</div>`;
}
function myRequestsPanel(id){
  const list=Object.values(reqs).filter(r=>r.who===id).sort((a,b)=>b.at-a.at).slice(0,5);
  if(!list.length) return "";
  const st=r=>r.status==="pending"?`در انتظار تأیید مدیر${volunteers(r.id).length?`؛ ${fa(volunteers(r.id).length)} نفر اعلام آمادگی کرده‌اند`:""}`:r.status==="approved"?`تأیید شد${r.replacement?"؛ جایگزین: "+nm(r.replacement):""}`:`رد شد؛ باید بیایی${r.reason?". دلیل: "+r.reason:""}`;
  return `<div class="panel"><strong>درخواست‌های نبودن من</strong><ul class="clean issues">${list.map(r=>`<li style="color:${r.status==="rejected"?"var(--warn)":r.status==="approved"?"var(--ok)":"inherit"}">${esc(keyLabel(r.key))}: ${esc(st(r))}</li>`).join("")}</ul></div>`;
}

/* ---------- gaps & quick fixes ---------- */
function slotGaps(S,key){
  const sl=S.slots[key], out=[]; if(!sl) return out;
  sl.pairs.filter(p=>!p.a).forEach(p=>out.push({t:"asst",d:p.d,u:p.u}));
  const used=new Set(sl.pairs.map(p=>p.u));
  for(let u=1;u<=cfg.settings.chairs;u++) if(!used.has(u)) out.push({t:"unit",u});
  if(sl.pairs.length&&sl.reception.length<cfg.settings.receptionPerShift) out.push({t:"rec"});
  return out;
}
function slotClash(sl,x,exclude){
  const nt=(cfg.rules||[]).filter(r=>r.type==="not_together").map(r=>r.ids);
  const ppl=new Set([...sl.pairs.flatMap(p=>[p.d,p.a]).filter(Boolean),...sl.reception]); if(exclude) ppl.delete(exclude);
  return nt.some(([p,q])=>(p===x&&ppl.has(q))||(q===x&&ppl.has(p)));
}
function gapCands(key,g){
  const sl=sched.slots[key], free=(sl.free||[]).filter(x=>byId(x));
  if(g.t==="asst") return free.filter(x=>byId(x).role==="assistant"&&!slotClash(sl,x)).map(x=>({id:x,ok:(cfg.pairings?.[g.d]||[]).includes(x)})).sort((a,b)=>b.ok-a.ok);
  if(g.t==="rec") return free.filter(x=>byId(x).role==="reception"&&!slotClash(sl,x)).map(x=>({id:x,ok:true}));
  if(g.t==="unit") return (sl.spare||[]).filter(x=>byId(x)&&!slotClash(sl,x)).filter(x=>{const r=(cfg.rules||[]).find(y=>y.type==="unit_pref"&&y.staff===x);return !r?.allowed?.length||r.allowed.includes(g.u)}).map(x=>({id:x,ok:true}));
  return [];
}
function gapsPanel(){
  if(!sched) return "";
  const rows=[];
  for(const [k,dn] of DAYS) for(const [sk,sn] of SHIFTS){
    const key=k+"_"+sk, gs=slotGaps(sched,key); if(!gs.length) continue;
    for(const g of gs){
      const cands=gapCands(key,g);
      const what=g.t==="asst"?`${nm(g.d)} (یونیت ${fa(g.u)}) دستیار ندارد`:g.t==="unit"?`یونیت ${fa(g.u)} خالی است`:`منشی کم است`;
      let btns="";
      for(const c of cands){
        if(g.t==="asst"){
          btns+=`<button class="btn ${c.ok?"primary":""}" data-fix="asst|${key}|${g.d}|${c.id}|0">${esc(nm(c.id))}${c.ok?"":" (فقط این شیفت)"}</button>`;
          if(!c.ok) btns+=`<button class="btn quiet" data-fix="asst|${key}|${g.d}|${c.id}|1">${esc(nm(c.id))} + مجاز همیشگی</button>`;
        }else if(g.t==="unit") btns+=`<button class="btn" data-fix="unit|${key}|${c.id}|${g.u}|0">${esc(nm(c.id))}</button>`;
        else btns+=`<button class="btn" data-fix="rec|${key}|${c.id}||0">${esc(nm(c.id))}</button>`;
      }
      const notAllowed=g.t==="asst"&&cands.length&&!cands.some(c=>c.ok);
      if(g.t==="asst"&&cands.length) btns+=pendingGapReq(key,g.d)?`<span class="note">از آنکال‌ها پرسیده شده؛ جواب‌ها در «درخواست‌ها»</span>`:`<button class="btn quiet" data-gask="${key}|${g.d}">از آنکال‌ها بپرس</button>`;
      rows.push(`<div style="border-top:1px solid var(--line);padding:8px 0"><div><strong>${dn} ${sn}:</strong> ${esc(what)}</div>
        ${cands.length?`<div class="note" style="margin:4px 0">${notAllowed?`در دسترس هستند ولی جزو دستیارهای مجاز ${esc(nm(g.d))} نیستند:`:"در دسترس:"}</div><div class="row">${btns}</div>`:`<div class="note">کسی در این زمان آزاد نیست${g.t==="unit"?"":"؛ می‌توانید با دستور بالا از شیفت دیگری کسی را بیاورید"}.</div>`}</div>`);
    }
  }
  if(!rows.length) return "";
  const withC=rows.filter(r=>r.includes("data-fix")).length;
  return `<details class="panel" ${withC?"open":""}><summary><strong>جاهای خالی (${fa(rows.length)})</strong>${withC?` <span class="note">${fa(withC)} مورد با یک کلیک پر می‌شود</span>`:""}</summary>${rows.join("")}</details>`;
}
async function quickFix(t,key,a,b,always){
  const S=structuredClone(sched), sl=S.slots[key], L=keyLabel(key), notices=[]; let item="";
  if(!sl) return;
  const drop=x=>{sl.free=(sl.free||[]).filter(y=>y!==x);sl.spare=(sl.spare||[]).filter(y=>y!==x)};
  const note=(to,text)=>notices.push({id:uid(),at:Date.now(),to:[to],text});
  if(t==="asst"){ const p=sl.pairs.find(p=>p.d===a); if(!p||p.a) return; p.a=b; drop(b); note(b,`${L}: با ${nm(a)} روی یونیت ${fa(p.u)} کار می‌کنی.`); note(a,`${L}: ${nm(b)} دستیار شماست.`); item=`${L}: ${nm(b)} دستیار ${nm(a)} شد${always==="1"?" و از این به بعد جزو دستیارهای مجازش است":""}.`; }
  if(t==="unit"){ const u=+b; if(sl.pairs.some(p=>p.u===u)) return; drop(a);
    const as=(sl.free||[]).find(x=>byId(x)?.role==="assistant"&&(cfg.pairings?.[a]||[]).includes(x)&&!slotClash(sl,x)); if(as) drop(as);
    sl.pairs.push({d:a,a:as||null,u}); sl.pairs.sort((x,y)=>(x.u||99)-(y.u||99));
    note(a,`${L}: روی یونیت ${fa(u)} قرار گرفتید${as?"، با "+nm(as):""}.`); if(as) note(as,`${L}: با ${nm(a)} روی یونیت ${fa(u)} کار می‌کنی.`);
    item=`${L}: ${nm(a)} روی یونیت ${fa(u)}${as?"، با "+nm(as):""}.`; }
  if(t==="rec"){ if(sl.reception.includes(a)) return; sl.reception.push(a); drop(a); note(a,`${L}: در پذیرش هستی.`); item=`${L}: ${nm(a)} در پذیرش.`; }
  if(!slotGaps(S,key).length) S.alerts=(S.alerts||[]).map(x=>x.key===key&&!x.resolved?{...x,resolved:true}:x);
  S.log=[...(S.log||[]),{who:"manager",at:Date.now(),text:"",items:[item]}].slice(-40);
  S.notices=[...(S.notices||[]),...notices].slice(-80); if(S.published) S.rev=(S.rev||1)+1;
  S.baseConflicts=[...new Set([...(S.baseConflicts||[]),...checkConflicts(cfg,S).map(x=>x.text)])];
  try{
    if(always==="1"){const c=structuredClone(cfg);c.pairings=c.pairings||{};const l=c.pairings[a]||[];if(!l.includes(b))l.push(b);c.pairings[a]=l;await db.doc("clinic/config").set(c)}
    await db.doc("clinic/schedule").set(S);
  }catch(e){mgrErr="ذخیره نشد. دوباره بزنید.";render()}
}

/* ---------- gap asks (doctor without assistant, no one cancelled) ---------- */
const liveReq=r=>r.status==="pending"&&(r.kind==="gap"?!!byId(r.doctor):!!byId(r.who));
function pendingGapReq(key,doctor){return Object.values(reqs).find(r=>r.kind==="gap"&&r.status==="pending"&&r.key===key&&r.doctor===doctor)}
function onCallFor(key,doctor){const sl=sched?.slots?.[key];if(!sl)return[];return (sl.free||[]).filter(x=>byId(x)?.role==="assistant"&&!slotClash(sl,x))}
async function createGapAsk(key,doctor,by){
  if(pendingGapReq(key,doctor)) return;
  const asked=onCallFor(key,doctor); if(!asked.length) return;
  const r={id:uid(),kind:"gap",who:null,role:"assistant",doctor,key,at:Date.now(),status:"pending",text:"",asked,askedOnCall:true,by};
  const L=keyLabel(key), p=sched.slots[key].pairs.find(p=>p.d===doctor);
  const S=structuredClone(sched);
  S.notices=[...(S.notices||[]),
    {id:uid(),at:Date.now(),to:asked,text:`درخواست حضور، ${L}: کار با ${nm(doctor)}${p?" (یونیت "+fa(p.u)+")":""}. تو آنکال هستی؛ هستی یا نه؟ جوابت را در بخش «درخواست حضور» بزن.`},
    ...(by!==doctor?[{id:uid(),at:Date.now(),to:[doctor],text:`${L}: برای شما دستیار نیست؛ از ${asked.map(nm).join("، ")} (آنکال) پرسیده شد. در بخش «دستیار جایگزین» می‌توانید ترجیحتان را بگویید.`}]:[])].slice(-80);
  S.log=[...(S.log||[]),{who:by,at:Date.now(),text:"",items:[`${L}: برای ${nm(doctor)} از آنکال‌ها (${asked.map(nm).join("، ")}) پرسیده شد.`]}].slice(-40);
  await db.doc("requests/"+r.id).set(r);
  await db.doc("clinic/schedule").set(S);
}

/* ---------- patients (dentist plan & treatment notes) ---------- */
const ARCHN={upper:"فک بالا",lower:"فک پایین"};
function findPlanMatch(plan,a){
  return plan.find(it=>it.status==="pending"&&
    (a.tooth?it.tooth===a.tooth:(a.arch?(it.arch===a.arch&&!it.tooth):(!it.tooth&&!it.arch)))&&
    (a.tx?it.tx===a.tx:!it.tx));
}
function applyPlanActions(plan,actions){
  const p=[...plan], results=[];
  for(const a of actions){
    const m=findPlanMatch(p,a);
    if(a.op==="remove_plan"){
      if(m){ p.splice(p.indexOf(m),1); results.push({item:m,outcome:"removed"}); }
      else results.push({item:a,outcome:"not_found"});
      continue;
    }
    if(m){
      if(a.status==="done"&&m.status!=="done"){ m.status="done"; m.doneAt=Date.now(); results.push({item:m,outcome:"done"}); }
      else results.push({item:m,outcome:"unchanged"});
    } else {
      const it={id:uid(),tooth:a.tooth,arch:a.arch,tx:a.tx,label:a.label,text:a.text,status:a.status,addedAt:Date.now(),doneAt:a.status==="done"?Date.now():null,price:null};
      p.push(it); results.push({item:it,outcome:"added"});
    }
  }
  return {plan:p,results};
}
function planItemLabel(it){
  const loc=it.tooth?`دندان ${fa(it.tooth)}`:it.arch?ARCHN[it.arch]:"";
  return `${esc(it.label||it.text)}${loc?" ("+esc(loc)+")":""}`;
}
function patientsPanel(id){
  if(byId(id)?.role!=="doctor") return "";
  const mine=Object.entries(patients).filter(([,p])=>p.doctor===id).sort((a,b)=>b[1].createdAt-a[1].createdAt);
  let h=`<div class="panel"><strong>بیماران من</strong>`;
  if(!mine.length) h+=`<p class="note" style="margin:6px 0 0">هنوز بیماری ثبت نشده.</p>`;
  else{
    h+=`<p class="row" style="margin-top:8px"><button class="btn quiet" data-act="pat-list-toggle" aria-expanded="${patListOpen}">${patListOpen?"بستن فهرست بیماران":"نمایش بیماران من ("+fa(mine.length)+")"}</button></p>`;
    if(patListOpen) h+=`<div style="overflow-x:auto"><table class="av" style="min-width:0"><thead><tr><th>نام</th><th>تاریخ ثبت</th><th>اقلام طرح</th></tr></thead><tbody>${mine.map(([pid,p])=>`<tr><td><button class="linkbtn" data-pat="${pid}">${esc(p.name)}</button></td><td>${new Date(p.createdAt).toLocaleDateString("fa-IR")}</td><td>${fa((p.plan||[]).length)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  h+=`<div style="margin-top:10px">
    <label class="note" for="newPatName">بیمار جدید</label>
    <input type="text" id="newPatName" placeholder="اسم بیمار" value="${esc(patDraft.name||"")}">
    <textarea id="newPatText" placeholder="مثلاً: دندان ۱۴ عصب کشی لازم داره، دندون ۲۲ باید کشیده بشه، جرمگیری بالا و پایین هم لازمه.">${esc(patDraft.text||"")}</textarea>
    ${patMsg?`<p class="okline" style="margin-top:8px">${patMsg}</p>`:""}
    ${patErr?`<p class="warn">${esc(patErr)}</p>`:""}
    <p class="row" style="margin-top:8px"><button class="btn primary" data-act="pat-new" ${patBusy?"disabled":""}>ثبت بیمار جدید</button></p>
  </div></div>`;
  return h;
}
function patientIntakePanel(id){
  if(byId(id)?.role!=="assistant") return "";
  const docs=ofRole("doctor");
  if(!docs.length) return "";
  let h=`<div class="panel"><strong>پذیرش بیمار جدید</strong><p class="note" style="margin:4px 0 8px">مشخصات بیمار را مثل فرم کاغذی وارد کن و دکترش را مشخص کن. فقط اسم و دکتر لازم است؛ بقیه اختیاری است.</p>
    <label class="note" for="intakeName">اسم بیمار</label>
    <input type="text" id="intakeName" placeholder="اسم بیمار" value="${esc(patDraft.iName||"")}">
    <label class="note" for="intakeDoc" style="display:block;margin-top:8px">دکتر</label>
    <select id="intakeDoc">${docs.map(d=>`<option value="${d.id}" ${(patDraft.iDoc||docs[0].id)===d.id?"selected":""}>${esc(d.name)}</option>`).join("")}</select>
    ${PF.fields("i",{},patDraft.pf)}
    ${patMsg?`<p class="okline" style="margin-top:8px">${patMsg}</p>`:""}
    ${patErr?`<p class="warn">${esc(patErr)}</p>`:""}
    <p class="row" style="margin-top:8px"><button class="btn primary" data-act="pat-intake" ${patBusy?"disabled":""}>ثبت بیمار</button></p>
  </div>`;
  return h;
}
function outcomeMsg(results){
  return results.map(r=>{
    const L=planItemLabel(r.item);
    if(r.outcome==="added") return `✚ ${L} به برنامه اضافه شد.`;
    if(r.outcome==="done") return `✓ ${L} تیک خورد.`;
    if(r.outcome==="removed") return `− ${L} حذف شد.`;
    if(r.outcome==="not_found") return `موردی برای حذف پیدا نشد.`;
    return `${L} از قبل تو برنامه بود؛ چیزی عوض نشد.`;
  }).join(" ");
}
function openPatientSheet(pid){
  patDraft.openId=pid; patDraft.noteText=""; patDraft.noteErr=""; patDraft.pending=null; patDraft.msg=""; patDraft.editingInfo=false; patDraft.opgMsg="";
  renderPatientSheet();
}
function planItemsPlain(p){ return p.plan.length?p.plan.map(it=>`${it.status==="done"?"✓":"—"} ${planItemLabel(it)}`).join("<br>"):"کاری ثبت نشده"; }
function patientPdfHtml(p){
  return `<div dir="rtl" style="font-family:Vazirmatn,Tahoma,sans-serif;color:#000;background:#fff;padding:16px;width:760px">
    <div style="border-bottom:2px solid #000;margin-bottom:12px;padding-bottom:8px">
      <div style="font-size:20px;font-weight:800">${esc(p.name)}</div>
      <div style="font-size:13px;color:#333;margin-top:6px">${esc(nm(p.doctor))}</div>
    </div>
    ${PF.pdf(p)}
    <div style="margin-top:10px"><strong style="font-size:14px">برنامه‌ی درمان</strong>
      <table style="border-collapse:collapse;width:100%;margin-top:6px;font-size:12px"><thead><tr><th style="border:1px solid #444;padding:5px;background:#eee;width:80px">وضعیت</th><th style="border:1px solid #444;padding:5px;background:#eee">کار</th><th style="border:1px solid #444;padding:5px;background:#eee;width:100px">قیمت</th></tr></thead><tbody>
      ${p.plan.length?p.plan.map(it=>`<tr><td style="border:1px solid #444;padding:5px;text-align:center;color:${it.status==="done"?"#1e7a3c":"#b3261e"}">${it.status==="done"?"انجام‌شده":"باقی‌مانده"}</td><td style="border:1px solid #444;padding:5px">${planItemLabel(it)}</td><td style="border:1px solid #444;padding:5px;text-align:center">${it.price?fa(it.price):"—"}</td></tr>`).join(""):`<tr><td colspan="3" style="border:1px solid #444;padding:5px;text-align:center;color:#999">کاری ثبت نشده</td></tr>`}
      </tbody></table>
    </div>
    ${(()=>{const fin=patientFinance(p);return fin.cost||fin.paid?`<div style="margin-top:10px;font-size:12px"><strong>هزینه‌ی کارهای انجام‌شده: </strong>${fa(fin.cost)} تومان — <strong>پرداخت‌شده: </strong>${fa(fin.paid)} تومان — <strong>مانده: </strong>${fin.balance>0?fa(fin.balance)+" تومان بدهکار":fin.balance<0?fa(-fin.balance)+" تومان طلبکار":"تسویه"}</div>`:"";})()}
    ${PF.consent()}
    <div style="margin-top:16px;font-size:10px;color:#999">تاریخ چاپ: ${new Date().toLocaleDateString("fa-IR")}</div>
  </div>`;
}
async function patientDownloadPdf(pid,btn){
  const p=patients[pid]; if(!p) return;
  try{await loadVendor("html2pdf")}catch(e){patErr="فایل ساخت PDF بارگذاری نشد. اینترنت را چک کنید و دوباره بزنید.";return renderPatientSheet()}
  const orig=btn.textContent; btn.disabled=true; btn.textContent="در حال ساخت PDF…";
  const box=document.createElement("div"); box.style.cssText="position:fixed;top:0;left:0;background:#fff;opacity:0;pointer-events:none;z-index:-1";
  box.innerHTML=patientPdfHtml(p); document.body.appendChild(box);
  try{
    if(document.fonts) await document.fonts.ready;
    const blob=await html2pdf().set({margin:8,image:{type:"jpeg",quality:.95},html2canvas:{scale:2,backgroundColor:"#ffffff"},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(box.firstElementChild).outputPdf("blob");
    await saveFile({filename:`بیمار-${p.name}.pdf`,data:blob});
  }catch(e){ if(e?.code!=="declined") patErr="ساخت یا ذخیره PDF انجام نشد. دوباره امتحان کنید."; }
  box.remove(); renderPatientSheet();
}
function patientPrint(pid){
  const p=patients[pid]; if(!p) return;
  $("#printArea").innerHTML=patientPdfHtml(p);
  try{window.print()}catch(e){}
}
function invoiceHtml(p,pay){
  const clinicName=cfg.settings?.clinicName||"کلینیک دندانپزشکی";
  const doneItems=p.plan.filter(it=>it.status==="done"&&it.price);
  const fin=patientFinance(p);
  return `<div dir="rtl" style="font-family:Vazirmatn,Tahoma,sans-serif;color:#000;background:#fff;padding:20px;width:700px">
    <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px">
      <div style="font-size:20px;font-weight:800">${esc(clinicName)}</div>
      <div style="font-size:13px;color:#555;margin-top:4px">فاکتور پرداخت</div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:10px">
      <div>بیمار: <strong>${esc(p.name)}</strong><br>دکتر: ${esc(nm(p.doctor))}</div>
      <div style="text-align:left">تاریخ: ${apptDateLabel(pay.date)}<br>شماره فیش: ${esc(pay.id.slice(-6))}</div>
    </div>
    <table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:8px"><thead><tr><th style="border:1px solid #444;padding:5px;background:#eee">شرح خدمت</th><th style="border:1px solid #444;padding:5px;background:#eee;width:110px">قیمت (تومان)</th></tr></thead><tbody>
      ${doneItems.length?doneItems.map(it=>`<tr><td style="border:1px solid #444;padding:5px">${planItemLabel(it)}</td><td style="border:1px solid #444;padding:5px;text-align:center">${fa(it.price)}</td></tr>`).join(""):`<tr><td colspan="2" style="border:1px solid #444;padding:5px;text-align:center;color:#999">موردی ثبت نشده</td></tr>`}
    </tbody></table>
    <div style="margin-top:14px;font-size:13px;border-top:1px solid #444;padding-top:8px">
      <div style="display:flex;justify-content:space-between"><span>جمع هزینه‌ی کارهای انجام‌شده:</span><strong>${fa(fin.cost)} تومان</strong></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px"><span>مبلغ این فیش (${esc(pay.method||"—")}):</span><strong>${fa(pay.amount)} تومان</strong></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px"><span>مجموع پرداخت‌شده تاکنون:</span><strong>${fa(fin.paid)} تومان</strong></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:15px;border-top:1px dashed #999;padding-top:6px"><span>مانده حساب:</span><strong style="color:${fin.balance>0?"#b3261e":"#1e7a3c"}">${fin.balance>0?fa(fin.balance)+" تومان بدهکار":fin.balance<0?fa(-fin.balance)+" تومان طلبکار":"تسویه"}</strong></div>
    </div>
    ${pay.note?`<div style="margin-top:10px;font-size:12px;color:#555">یادداشت: ${esc(pay.note)}</div>`:""}
    <div style="margin-top:24px;font-size:10px;color:#999;text-align:center">تاریخ چاپ: ${new Date().toLocaleDateString("fa-IR")}</div>
  </div>`;
}
async function invoiceDownloadPdf(pid,payId,btn){
  const p=patients[pid]; if(!p) return;
  const pay=(p.payments||[]).find(x=>x.id===payId); if(!pay) return;
  try{await loadVendor("html2pdf")}catch(e){patErr="فایل ساخت PDF بارگذاری نشد. اینترنت را چک کنید و دوباره بزنید.";return renderPatientSheet()}
  btn.disabled=true; const orig=btn.textContent; btn.textContent="در حال ساخت PDF…";
  const box=document.createElement("div"); box.style.cssText="position:fixed;top:0;left:0;background:#fff;opacity:0;pointer-events:none;z-index:-1";
  box.innerHTML=invoiceHtml(p,pay); document.body.appendChild(box);
  try{
    if(document.fonts) await document.fonts.ready;
    const blob=await html2pdf().set({margin:8,image:{type:"jpeg",quality:.95},html2canvas:{scale:2,backgroundColor:"#ffffff"},jsPDF:{unit:"mm",format:"a4",orientation:"portrait"}}).from(box.firstElementChild).outputPdf("blob");
    await saveFile({filename:`فاکتور-${p.name}-${pay.date}.pdf`,data:blob});
  }catch(e){ if(e?.code!=="declined") patErr="ساخت یا ذخیره PDF انجام نشد. دوباره امتحان کنید."; }
  box.remove(); renderPatientSheet();
}
function invoicePrint(pid,payId){
  const p=patients[pid]; if(!p) return;
  const pay=(p.payments||[]).find(x=>x.id===payId); if(!pay) return;
  $("#printArea").innerHTML=invoiceHtml(p,pay);
  try{window.print()}catch(e){}
}
function renderPatientSheet(){
  const p=patients[patDraft.openId]; if(!p) return;
  const isMgr=who==="manager";
  const canEditPlan=byId(who)?.role==="doctor";
  const exportRow=`<div class="row" style="margin:8px 0"><button class="btn" data-act="pat-pdf">دانلود PDF</button><button class="btn quiet" data-act="pat-print">چاپ</button></div>`;
  const showEdit=!isMgr||patDraft.editingInfo;
  const info=showEdit?`${PF.fields("e",p)}
    ${isMgr?"":`<p class="row" style="margin-top:8px"><button class="btn quiet" data-act="pat-info-save">ذخیره اطلاعات</button></p>`}
    ${PF.allergyText(p)?`<p class="warn" style="margin-top:6px"><strong>⚠ حساسیت: </strong>${esc(PF.allergyText(p))}</p>`:""}`
    :PF.view(p);
  const rows=p.plan.map(it=>!canEditPlan?`<div class="row" style="justify-content:space-between;align-items:flex-start;border-top:1px solid var(--line);padding:6px 0">
      <span style="color:${it.status==="done"?"var(--ok)":"var(--warn)"};${it.status==="done"?"text-decoration:line-through":"font-weight:600"}">${it.status==="done"?"✓ ":""}${planItemLabel(it)}</span>
      <span class="note">${it.price?fa(it.price)+" تومان":"—"}</span>
    </div>`:`<div class="row" style="justify-content:space-between;align-items:flex-start;border-top:1px solid var(--line);padding:6px 0;flex-wrap:wrap">
      <label class="row" style="gap:6px;align-items:flex-start"><input type="checkbox" data-tog="${it.id}" ${it.status==="done"?"checked":""}><span style="color:${it.status==="done"?"var(--ok)":"var(--warn)"};${it.status==="done"?"text-decoration:line-through":"font-weight:600"}">${planItemLabel(it)}</span></label>
      <span class="row" style="gap:6px"><input type="number" min="0" step="1000" data-price="${it.id}" value="${it.price||""}" placeholder="قیمت (تومان)" style="width:120px"><button class="x" data-delitem="${it.id}">حذف</button></span>
    </div>`).join("")||`<p class="note">هنوز کاری برای این بیمار ثبت نشده.</p>`;
  let body=`<h2>${esc(p.name)}</h2><p class="note" style="margin:0 0 4px">${esc(nm(p.doctor))}</p>${exportRow}${info}${LAB.sheetPanel(p)}<div class="clean">${rows}</div>
    <div style="margin-top:12px">`;
  if(canEditPlan){
    if(patDraft.pending){
      body+=`<strong>این‌طور فهمیدم:</strong><ul class="clean issues">${patDraft.pending.items.map(x=>`<li>${x.op==="remove_plan"?"حذف: ":x.status==="done"?"✓ انجام‌شده: ":"نیاز: "}${planItemLabel(x)}</li>`).join("")}${(patDraft.pending.invActions||[]).map(a=>{const it=inventory[a.item],short=it&&(it.qty-a.qty)<0;return `<li>📦 ${fa(a.qty)} ${esc(it?.unit||"")} ${esc(it?.name||"")} از انبار کم می‌شه${short?' <strong style="color:var(--warn)">(موجودی کافی نیست!)</strong>':""}</li>`}).join("")}${(patDraft.pending.allergyActions||[]).map(a=>`<li>${a.negative?"آلرژی: ندارد":`⚠ آلرژی: ${esc(a.value)}`}</li>`).join("")}</ul>
        ${patDraft.pending.rejected.length?`<p class="warn">${patDraft.pending.rejected.map(esc).join("؛ ")}</p>`:""}
        <p class="row" style="margin-top:8px"><button class="btn primary" data-act="pat-apply">تأیید</button><button class="btn quiet" data-act="pat-cancel-note">لغو</button></p>`;
    } else {
      body+=(patDraft.msg?`<p class="okline" style="margin:0 0 8px">${patDraft.msg}</p>`:"")+
        `<label class="note" for="patNoteTxt">یادداشت جدید</label>
        <textarea id="patNoteTxt" placeholder="مثلاً: دندون ۱۴ رو عصب کشی کردم. یا: دندان ۹ هم پوسیدگی داره.">${esc(patDraft.noteText||"")}</textarea>
        ${patDraft.noteErr?`<p class="warn">${esc(patDraft.noteErr)}</p>`:""}
        <p class="row" style="margin-top:8px"><button class="btn primary" data-act="pat-parse">بررسی</button></p>`;
    }
  }
  body+=`</div>`;
  body+=`<hr><div class="row" style="justify-content:space-between"><strong>OPG و تصاویر</strong><label class="btn">📷 آپلود OPG<input type="file" id="patOpg" accept="image/*" multiple hidden></label></div>
    ${patDraft.opgMsg?`<p class="${patDraft.opgBad?"warn":"okline"}">${esc(patDraft.opgMsg)}</p>`:""}
    <div class="imp-opgs">${(p.opg||[]).map(o=>`<figure><button data-popg="${o.id}"><img src="${o.thumb}" alt="OPG"></button><figcaption>${esc(o.date)} <button class="x" data-popg-del="${o.id}">حذف</button></figcaption></figure>`).join("")||`<p class="note">هنوز تصویری آپلود نشده.</p>`}</div>`;
  body+=`<hr>`+financeHtml(p);
  if(isMgr) body+=`${patErr?`<p class="warn">${esc(patErr)}</p>`:""}<p class="row" style="margin-top:16px"><button class="btn ${patDraft.editingInfo?"primary":"quiet"}" data-act="pat-toggle-edit">${patDraft.editingInfo?"ذخیره و پایان ویرایش":"ویرایش اطلاعات"}</button></p>`;
  Shell.sheet(body,root=>{
    root.querySelectorAll("[data-tog]").forEach(cb=>cb.onchange=()=>toggleItem(patDraft.openId,cb.dataset.tog));
    root.querySelectorAll("[data-delitem]").forEach(b=>b.onclick=()=>deleteItem(patDraft.openId,b.dataset.delitem));
    root.querySelectorAll("[data-price]").forEach(i=>i.onchange=()=>setItemPrice(patDraft.openId,i.dataset.price,Math.max(0,Math.floor(+i.value||0))));
    root.querySelectorAll("[data-delpay]").forEach(b=>b.onclick=()=>deletePayment(b.dataset.delpay));
    root.querySelectorAll("[data-inv]").forEach(b=>b.onclick=()=>{const [payId,mode]=b.dataset.inv.split("|"); mode==="pdf"?invoiceDownloadPdf(patDraft.openId,payId,b):invoicePrint(patDraft.openId,payId)});
    root.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>act(b.dataset.act,b));
    const po=root.querySelector("#patOpg"); if(po) po.onchange=()=>patOpgUpload([...po.files]);
    root.querySelectorAll("[data-popg]").forEach(b=>b.onclick=()=>patOpgView(b.dataset.popg));
    root.querySelectorAll("[data-popg-del]").forEach(b=>b.onclick=()=>{if(b.dataset.arm!=="1"){b.dataset.arm="1";b.textContent="مطمئنید؟";return}patOpgDel(b.dataset.popgDel)});
    const t=root.querySelector("#patNoteTxt"); if(t) t.oninput=e=>{patDraft.noteText=e.target.value;patDraft.msg=""};
    const pa=root.querySelector("#payAmount"); if(pa) pa.oninput=e=>payDraft.amount=e.target.value;
    const pm=root.querySelector("#payMethod"); if(pm) pm.onchange=e=>payDraft.method=e.target.value;
    const pn=root.querySelector("#payNote"); if(pn) pn.oninput=e=>payDraft.note=e.target.value;
    const pd=root.querySelector("#payDay"); if(pd) pd.onchange=e=>payDraft.jd=+e.target.value;
    const pmo=root.querySelector("#payMonth"); if(pmo) pmo.onchange=e=>{payDraft.jm=+e.target.value;renderPatientSheet()};
    const pyr=root.querySelector("#payYear"); if(pyr) pyr.onchange=e=>{payDraft.jy=+e.target.value;renderPatientSheet()};
  });
}
async function patOpgUpload(files){
  const pid=patDraft.openId, p=structuredClone(patients[pid]); if(!p) return;
  const {IDB,shrink}=IMP.files; p.opg=p.opg||[]; patDraft.opgBad=false;
  for(const f of files){
    if(!f.type.startsWith("image/")){patDraft.opgBad=true;patDraft.opgMsg="فقط فایل تصویری قابل آپلود است.";continue}
    try{const full=await shrink(f,2000,.85), thumb=await shrink(f,240,.7), id="popg"+uid();
      await IDB.put(id,full); p.opg.push({id,name:f.name.slice(0,60),date:new Date().toLocaleDateString("fa-IR"),thumb});}
    catch(e){patDraft.opgBad=true;patDraft.opgMsg="ذخیره تصویر انجام نشد (شاید حافظه گوشی پر است)."}
  }
  if(!patDraft.opgBad) patDraft.opgMsg="تصویر ذخیره شد.";
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}
async function patOpgView(id){
  const p=patients[patDraft.openId], o=(p.opg||[]).find(x=>x.id===id); let src=null; try{src=await IMP.files.IDB.get(id)}catch(e){} src=src||o?.thumb;
  Shell.sheet(`<h2>OPG — ${esc(p.name)}</h2><p class="note">${esc(o?.date||"")}</p><img src="${src}" alt="OPG" style="width:100%;border-radius:8px;background:#000">
    <p class="row" style="margin-top:8px"><button class="btn" data-back>بازگشت به پرونده</button><a class="btn quiet" href="${src}" download="OPG-${esc(p.name)}.jpg">ذخیره تصویر</a></p>`,root=>{root.querySelector("[data-back]").onclick=renderPatientSheet});
}
async function patOpgDel(id){
  const pid=patDraft.openId, p=structuredClone(patients[pid]); p.opg=(p.opg||[]).filter(x=>x.id!==id);
  try{await IMP.files.IDB.del(id)}catch(e){} patDraft.opgMsg="تصویر حذف شد."; patDraft.opgBad=false;
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}
async function patInfoSave(){
  const pid=patDraft.openId, p=structuredClone(patients[pid]); if(!p) return;
  Object.assign(p,PF.read("e"));
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}
async function patToggleEdit(){
  if(patDraft.editingInfo) await patInfoSave();
  patDraft.editingInfo=!patDraft.editingInfo;
  renderPatientSheet();
}
async function toggleItem(pid,itemId){
  const p=structuredClone(patients[pid]); if(!p) return;
  const it=p.plan.find(x=>x.id===itemId); if(!it) return;
  it.status=it.status==="done"?"pending":"done"; it.doneAt=it.status==="done"?Date.now():null;
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}
async function deleteItem(pid,itemId){
  const p=structuredClone(patients[pid]); if(!p) return;
  p.plan=p.plan.filter(x=>x.id!==itemId);
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}
async function setItemPrice(pid,itemId,price){
  const p=structuredClone(patients[pid]); if(!p) return;
  const it=p.plan.find(x=>x.id===itemId); if(!it) return;
  it.price=price>0?price:null;
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}

/* ---------- patient finance (treatment cost + payments) ---------- */
let payDraft={amount:"",jy:null,jm:null,jd:null,method:"",note:""}, payErr="";
function patientFinance(p){
  const cost=p.plan.filter(it=>it.status==="done").reduce((s,it)=>s+(it.price||0),0);
  const paid=(p.payments||[]).reduce((s,pay)=>s+(pay.amount||0),0);
  return {cost,paid,balance:cost-paid};
}
function paymentRowHtml(pay,canManage){
  return `<div style="border-top:1px solid var(--line);padding:6px 0;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
    <div><strong>${fa(pay.amount)} تومان</strong> <span class="note">${apptDateLabel(pay.date)}</span>${pay.method?` <span class="note">(${esc(pay.method)})</span>`:""}${pay.note?`<div class="note">${esc(pay.note)}</div>`:""}</div>
    <div class="row">
      <button class="btn quiet" data-inv="${pay.id}|pdf" style="padding:2px 8px">فاکتور PDF</button>
      <button class="btn quiet" data-inv="${pay.id}|print" style="padding:2px 8px">چاپ فاکتور</button>
      ${canManage?`<button class="x" data-delpay="${pay.id}">حذف</button>`:""}
    </div>
  </div>`;
}
function paymentFormHtml(){
  if(payDraft.jy==null){ const [jy,jm,jd]=todayJalali(); payDraft.jy=jy; payDraft.jm=jm; payDraft.jd=jd; }
  const dLen=jalaliMonthLength(payDraft.jy,payDraft.jm);
  if(payDraft.jd>dLen) payDraft.jd=dLen;
  const todayJy=todayJalali()[0];
  const faYear=y=>Number(y).toLocaleString("fa-IR",{useGrouping:false});
  const dayOpts=Array.from({length:dLen},(_,i)=>i+1).map(d=>`<option value="${d}" ${payDraft.jd===d?"selected":""}>${fa(d)}</option>`).join("");
  const monthOpts=PERSIAN_MONTHS.map((n,i)=>`<option value="${i+1}" ${payDraft.jm===i+1?"selected":""}>${n}</option>`).join("");
  const yearOpts=[todayJy-1,todayJy,todayJy+1].map(y=>`<option value="${y}" ${payDraft.jy===y?"selected":""}>${faYear(y)}</option>`).join("");
  return `<div style="margin-top:10px">
    <label class="note">ثبت پرداخت جدید</label>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:4px">
      <input type="number" min="0" step="1000" id="payAmount" placeholder="مبلغ (تومان)" value="${esc(payDraft.amount)}" style="flex:1 1 120px">
      <select id="payMethod" style="flex:1 1 130px">${["","نقد","کارت به کارت","کارتخوان","چک"].map(m=>`<option value="${m}" ${(payDraft.method||"")===m?"selected":""}>${m||"نحوه پرداخت…"}</option>`).join("")}</select>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:8px">
      <select id="payDay" style="flex:1 1 60px">${dayOpts}</select>
      <select id="payMonth" style="flex:1 1 100px">${monthOpts}</select>
      <select id="payYear" style="flex:1 1 70px">${yearOpts}</select>
    </div>
    <input type="text" id="payNote" placeholder="یادداشت (اختیاری)" value="${esc(payDraft.note||"")}" style="margin-top:8px;width:100%">
    ${payErr?`<p class="warn">${esc(payErr)}</p>`:""}
    <p class="row" style="margin-top:8px"><button class="btn primary" data-act="pay-add">ثبت پرداخت</button></p>
  </div>`;
}
function financeHtml(p){
  const canManage=who==="manager"||byId(who)?.role==="reception";
  const fin=patientFinance(p);
  const bal=fin.balance;
  const balTxt=bal>0?`${fa(bal)} تومان بدهکار`:bal<0?`${fa(-bal)} تومان طلبکار`:"تسویه";
  const pays=(p.payments||[]).slice().sort((a,b)=>b.at-a.at);
  return `<div style="margin-top:12px"><strong>امور مالی</strong>
    <div class="row" style="flex-wrap:wrap;gap:16px;margin-top:8px;font-size:.92rem">
      <div>هزینه‌ی کارهای انجام‌شده: <strong>${fa(fin.cost)} تومان</strong></div>
      <div>پرداخت‌شده: <strong style="color:var(--ok)">${fa(fin.paid)} تومان</strong></div>
      <div>مانده: <strong style="color:${bal>0?"var(--warn)":"var(--ok)"}">${balTxt}</strong></div>
    </div>
    ${pays.length?pays.map(pay=>paymentRowHtml(pay,canManage)).join(""):`<p class="note" style="margin-top:8px">هنوز پرداختی ثبت نشده.</p>`}
    ${canManage?paymentFormHtml():""}
  </div>`;
}
async function addPayment(){
  const pid=patDraft.openId, p=structuredClone(patients[pid]); if(!p) return;
  const amount=Math.max(0,Math.floor(+($("#payAmount")?.value)||0));
  const method=($("#payMethod")?.value||"").trim(), note=($("#payNote")?.value||"").trim();
  if(!amount){payErr="مبلغ را بنویس.";return renderPatientSheet()}
  const [gy,gm,gd]=jalaliToGregorian(payDraft.jy,payDraft.jm,payDraft.jd);
  const date=gy+"-"+String(gm).padStart(2,"0")+"-"+String(gd).padStart(2,"0");
  p.payments=[...(p.payments||[]),{id:uid(),amount,date,method,note,at:Date.now()}];
  await db.doc("patients/"+pid).set(p); patients[pid]=p;
  payDraft={amount:"",jy:null,jm:null,jd:null,method:"",note:""}; payErr="";
  renderPatientSheet();
}
async function deletePayment(payId){
  const pid=patDraft.openId, p=structuredClone(patients[pid]); if(!p) return;
  p.payments=(p.payments||[]).filter(x=>x.id!==payId);
  await db.doc("patients/"+pid).set(p); patients[pid]=p; renderPatientSheet();
}
async function patNewRun(){
  const name=($("#newPatName")?.value||"").trim(), text=($("#newPatText")?.value||"").trim();
  if(!name){patErr="اول اسم بیمار را بنویس.";return render()}
  patBusy=true; patErr=""; patMsg=""; render();
  try{
    const r=NLU.patientNote(text); FB.nlu("patient",text,r);
    const allActions=Array.isArray(r?.actions)?r.actions:[];
    const planActions=allActions.filter(a=>a.op==="upsert_plan"||a.op==="remove_plan");
    const allergyAction=allActions.find(a=>a.op==="set_allergy");
    const invList=Object.entries(inventory).map(([id,it])=>({id,name:it.name}));
    const ri=NLU.inventoryUsage(text,invList);
    const pid=uid(), {plan,results}=applyPlanActions([],planActions);
    await db.doc("patients/"+pid).set({id:pid,doctor:who,name,createdAt:Date.now(),plan,allergies:allergyAction?allergyAction.value:null});
    const invResults=[];
    for(const a of (Array.isArray(ri?.actions)?ri.actions:[])){
      const it=inventory[a.item]; if(!it) continue;
      const newQty=it.qty-a.qty, upd={...it,qty:newQty,updatedAt:Date.now()};
      await db.doc("inventory/"+a.item).set(upd); inventory[a.item]=upd;
      invResults.push({item:upd,qty:a.qty,short:newQty<0});
    }
    patDraft.name=""; patDraft.text="";
    patMsg=(results.length?outcomeMsg(results):"بیمار جدید ثبت شد.")+" "+
      (invResults.length?invResults.map(x=>`📦 ${fa(x.qty)} ${esc(x.item.unit)} ${esc(x.item.name)} از انبار کم شد${x.short?' <strong style="color:var(--warn)">(موجودی منفی شد)</strong>':""}.`).join(" "):"هیچ ماده‌ی مصرفی‌ای از انبار کم نشد.")+
      (allergyAction?` ${allergyAction.negative?"آلرژی: ندارد.":`⚠ آلرژی ثبت شد: ${esc(allergyAction.value)}`}`:"");
    const rejs=[...(Array.isArray(r?.rejected)?r.rejected:[]),...(Array.isArray(ri?.rejected)?ri.rejected:[])];
    if(rejs.length) patErr=rejs.join("؛ ");
  }catch(e){patErr=errCopy(e)}
  patBusy=false; render();
}
async function patIntakeRun(){
  const name=($("#intakeName")?.value||"").trim();
  const docId=$("#intakeDoc")?.value;
  if(!name){patErr="اول اسم بیمار را بنویس.";return render()}
  if(!docId){patErr="یک دکتر انتخاب کن.";return render()}
  const x=PF.read("i");
  patBusy=true; patErr=""; patMsg=""; render();
  try{
    const pid=uid();
    await db.doc("patients/"+pid).set({...x, id:pid, doctor:docId, name, createdAt:Date.now(), plan:[]});
    patDraft.iName=""; patDraft.pf={}; patDraft.iDoc=docId;
    patMsg=`بیمار «${esc(name)}» برای ${esc(nm(docId))} ثبت شد.`;
  }catch(e){patErr=errCopy(e)}
  patBusy=false; render();
}
async function patNoteParseRun(){
  const text=(patDraft.noteText||"").trim(); if(!text){patDraft.noteErr="اول چیزی بنویس.";return renderPatientSheet()}
  patDraft.noteErr="";
  const r=NLU.patientNote(text); FB.nlu("patient",text,r);
  const invList=Object.entries(inventory).map(([id,it])=>({id,name:it.name}));
  const ri=NLU.inventoryUsage(text,invList); FB.nlu("inventory_use",text,{misses:[]});
  const allActions=Array.isArray(r?.actions)?r.actions:[];
  const items=allActions.filter(a=>a.op==="upsert_plan"||a.op==="remove_plan");
  const allergyActions=allActions.filter(a=>a.op==="set_allergy");
  const invActions=Array.isArray(ri?.actions)?ri.actions:[];
  if(!items.length&&!invActions.length&&!allergyActions.length){patDraft.noteErr=(Array.isArray(r?.rejected)&&r.rejected.length?r.rejected.join("؛ "):"چیزی نفهمیدم. ساده‌تر بنویس (مثلاً «دندان ۱۴ عصب کشی کردم»).");return renderPatientSheet()}
  patDraft.pending={items,invActions,allergyActions,rejected:[...(Array.isArray(r?.rejected)?r.rejected:[]),...(Array.isArray(ri?.rejected)?ri.rejected:[])]};
  renderPatientSheet();
}
async function patApplyRun(){
  const pid=patDraft.openId, p=structuredClone(patients[pid]); if(!p||!patDraft.pending) return;
  const {plan,results}=applyPlanActions(p.plan,patDraft.pending.items);
  p.plan=plan;
  const allergyAction=(patDraft.pending.allergyActions||[])[0];
  if(allergyAction) p.allergies=allergyAction.value;
  await db.doc("patients/"+pid).set(p); patients[pid]=p;
  const invResults=[];
  for(const a of (patDraft.pending.invActions||[])){
    const it=inventory[a.item]; if(!it) continue;
    const newQty=it.qty-a.qty, upd={...it,qty:newQty,updatedAt:Date.now()};
    await db.doc("inventory/"+a.item).set(upd); inventory[a.item]=upd;
    invResults.push({item:upd,qty:a.qty,short:newQty<0});
  }
  patDraft.pending=null; patDraft.noteText="";
  patDraft.msg=outcomeMsg(results)+" "+(invResults.length?invResults.map(r=>`📦 ${fa(r.qty)} ${esc(r.item.unit)} ${esc(r.item.name)} از انبار کم شد${r.short?' <strong style="color:var(--warn)">(موجودی منفی شد؛ انبار را اصلاح کن)</strong>':""}.`).join(" "):"هیچ ماده‌ی مصرفی‌ای از انبار کم نشد.")+
    (allergyAction?` ${allergyAction.negative?"آلرژی: ندارد.":`⚠ آلرژی ثبت شد: ${esc(allergyAction.value)}`}`:"");
  renderPatientSheet();
}
function patientsTab(){
  const q=NLU.norm(patSearch||""), F=patFilter, planLen=p=>(p.plan||[]).length, left=p=>(p.plan||[]).filter(it=>it.status!=="done").length;
  const planOk=p=>F.plan===""||(F.plan==="left"?left(p)>0:F.plan==="done"?planLen(p)>0&&left(p)===0:planLen(p)===0);
  const SORT={new:(a,b)=>b[1].createdAt-a[1].createdAt,name:(a,b)=>a[1].name.localeCompare(b[1].name,"fa"),left:(a,b)=>left(b[1])-left(a[1])||b[1].createdAt-a[1].createdAt};
  const all=Object.entries(patients), active=!!(q||F.doc||F.plan||F.sort!=="new");
  const rows=all.filter(([,p])=>(!q||NLU.norm(p.name).includes(q))&&(!F.doc||p.doctor===F.doc)&&planOk(p)).sort(SORT[F.sort]||SORT.new);
  const opt=(v,l,cur)=>`<option value="${v}" ${cur===v?"selected":""}>${l}</option>`;
  let h=`<div class="panel"><strong>بیماران</strong>
    <div class="row" style="margin-top:8px"><input type="text" id="patSearchBox" placeholder="جستجوی اسم بیمار…" value="${esc(patSearch)}" style="flex:1 1 160px">
    <button class="btn" data-act="pat-search">جستجو</button>${patSearch?`<button class="btn quiet" data-act="pat-search-clear">پاک کردن</button>`:""}</div>
    <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">
      <div style="flex:1 1 120px"><label class="note" style="display:block" for="patFDoc">دکتر</label><select id="patFDoc" style="width:100%">${opt("","همهٔ دکترها",F.doc)}${ofRole("doctor").map(d=>opt(d.id,esc(d.name),F.doc)).join("")}</select></div>
      <div style="flex:1 1 120px"><label class="note" style="display:block" for="patFPlan">وضعیت طرح</label><select id="patFPlan" style="width:100%">${opt("","همه",F.plan)}${opt("left","کار باقی‌مانده دارد",F.plan)}${opt("done","همه انجام‌شده",F.plan)}${opt("none","بدون طرح",F.plan)}</select></div>
      <div style="flex:1 1 120px"><label class="note" style="display:block" for="patFSort">مرتب‌سازی</label><select id="patFSort" style="width:100%">${opt("new","جدیدترین",F.sort)}${opt("name","اسم (الفبا)",F.sort)}${opt("left","بیشترین کار باقی‌مانده",F.sort)}</select></div>
    </div>
    ${active?`<p class="row" style="margin-top:8px"><span class="note">${fa(rows.length)} بیمار از ${fa(all.length)}</span><button class="btn quiet" data-act="pat-filter-clear">پاک کردن فیلترها</button></p>`:""}</div>`;
  if(!rows.length) return h+`<div class="panel"><p class="note">${active?"بیماری با این فیلتر پیدا نشد.":"هنوز بیماری ثبت نشده."}</p></div>`;
  h+=`<div class="panel"><div style="overflow-x:auto"><table class="av" style="min-width:0"><thead><tr><th>نام</th><th>دکتر</th><th>تاریخ ثبت</th><th>اقلام طرح</th><th>باقی‌مانده</th></tr></thead><tbody>${rows.map(([pid,p])=>`<tr><td><button class="linkbtn" data-pat="${pid}">${esc(p.name)}</button></td><td>${esc(byId(p.doctor)?.name||"")}</td><td>${new Date(p.createdAt).toLocaleDateString("fa-IR")}</td><td>${fa(planLen(p))}</td><td>${fa(left(p))}</td></tr>`).join("")}</tbody></table></div></div>`;
  return h;
}

/* ---------- inventory (clinic supplies) ---------- */
function lowStockItems(){ return Object.entries(inventory).filter(([,it])=>it.qty<=it.minQty); }
function inventoryTab(){
  const rows=Object.entries(inventory).sort((a,b)=>a[1].name.localeCompare(b[1].name,"fa"));
  const low=lowStockItems();
  let h="";
  if(low.length) h+=`<div class="panel" style="border:2px solid var(--warn)"><strong style="color:var(--warn)">کمبود موجودی (${fa(low.length)})</strong><ul class="clean issues">${low.map(([,it])=>`<li>${esc(it.name)}: ${fa(it.qty)} ${esc(it.unit)} مانده (حداقل ${fa(it.minQty)})</li>`).join("")}</ul></div>`;
  if(!rows.length) h+=`<div class="panel"><p class="note">هنوز کالایی ثبت نشده.</p></div>`;
  else{
    h+=`<div class="panel scroll"><table class="av"><thead><tr><th>نام</th><th>واحد</th><th>موجودی</th><th>حداقل</th><th></th><th></th></tr></thead><tbody>`;
    for(const [id,it] of rows){
      const isLow=it.qty<=it.minQty;
      h+=`<tr><td>${esc(it.name)}${isLow?' <span class="chip missing">کم</span>':""}</td><td>${esc(it.unit)}</td>
        <td><input type="number" min="0" data-qty="${id}" value="${it.qty}" style="width:70px"></td>
        <td><input type="number" min="0" data-min="${id}" value="${it.minQty}" style="width:60px"></td>
        <td><button class="btn quiet" data-act="inv-save" data-id="${id}">ذخیره</button></td>
        <td><button class="x" data-act="inv-del" data-id="${id}">حذف</button></td></tr>`;
    }
    h+=`</tbody></table></div>`;
  }
  h+=`<div class="panel"><strong>کالای جدید</strong>
    <div class="row" style="margin-top:8px;flex-wrap:wrap">
      <input type="text" id="invName" placeholder="اسم کالا" value="${esc(invDraft.name||"")}" style="flex:2 1 140px">
      <input type="text" id="invUnit" placeholder="واحد (مثلاً عدد، ویال)" value="${esc(invDraft.unit||"")}" style="flex:1 1 110px">
      <input type="number" id="invQty" placeholder="موجودی" value="${esc(invDraft.qty)}" style="flex:1 1 80px" min="0">
      <input type="number" id="invMin" placeholder="حداقل" value="${esc(invDraft.minQty)}" style="flex:1 1 80px" min="0">
    </div>
    ${invErr?`<p class="warn">${esc(invErr)}</p>`:""}
    <p class="row" style="margin-top:8px"><button class="btn primary" data-act="inv-add">افزودن</button></p>
  </div>`;
  return h;
}
async function invSave(id){
  const it=inventory[id]; if(!it) return;
  const qEl=document.querySelector(`[data-qty="${id}"]`), mEl=document.querySelector(`[data-min="${id}"]`);
  const qty=Math.max(0,Math.floor(+qEl.value||0)), minQty=Math.max(0,Math.floor(+mEl.value||0));
  await db.doc("inventory/"+id).set({...it,qty,minQty,updatedAt:Date.now()});
}
async function invDelete(id){ await db.doc("inventory/"+id).delete(); }
async function clinicNameSave(){
  const name=($("#clinicNameInp")?.value||"").trim();
  const c=structuredClone(cfg); c.settings.clinicName=name||null;
  await db.doc("clinic/config").set(c); clinicNameDraft=null;
}
async function invAdd(){
  const name=($("#invName")?.value||"").trim(), unit=($("#invUnit")?.value||"").trim()||"عدد";
  const qty=Math.max(0,Math.floor(+($("#invQty")?.value)||0)), minQty=Math.max(0,Math.floor(+($("#invMin")?.value)||0));
  if(!name){invErr="اول اسم کالا را بنویس.";return render()}
  const id=uid();
  await db.doc("inventory/"+id).set({id,name,unit,qty,minQty,updatedAt:Date.now()});
  invDraft={name:"",unit:"",qty:"",minQty:""}; invErr="";
  render();
}

/* ---------- appointments (patient booking) ---------- */
const APPT_ST={scheduled:["در انتظار","var(--muted)"],done:["آمد","var(--ok)"],noshow:["نیامد","var(--warn)"],cancelled:["لغو شد","var(--warn)"]};
const apptDateLabel=d=>new Date(d+"T00:00:00").toLocaleDateString("fa-IR",{weekday:"long",day:"numeric",month:"long"});
function apptList(filterDoc){
  return Object.entries(appts).filter(([,a])=>!filterDoc||a.doctor===filterDoc)
    .sort((a,b)=>(a[1].date+(a[1].time||"99:99")).localeCompare(b[1].date+(b[1].time||"99:99")));
}
function findPatientIdByName(doctorId,name){
  const n=NLU.norm(name);
  const m=Object.entries(patients).find(([,p])=>p.doctor===doctorId&&NLU.norm(p.name)===n);
  return m?m[0]:null;
}
function apptFormHtml(){
  const docs=ofRole("doctor");
  if(apptDraft.jy==null){ const [jy,jm,jd]=todayJalali(); apptDraft.jy=jy; apptDraft.jm=jm; apptDraft.jd=jd; }
  const dLen=jalaliMonthLength(apptDraft.jy,apptDraft.jm);
  if(apptDraft.jd>dLen) apptDraft.jd=dLen;
  const todayJy=todayJalali()[0];
  const dayOpts=Array.from({length:dLen},(_,i)=>i+1).map(d=>`<option value="${d}" ${apptDraft.jd===d?"selected":""}>${fa(d)}</option>`).join("");
  const monthOpts=PERSIAN_MONTHS.map((n,i)=>`<option value="${i+1}" ${apptDraft.jm===i+1?"selected":""}>${n}</option>`).join("");
  const faYear=y=>Number(y).toLocaleString("fa-IR",{useGrouping:false});
  const yearOpts=[todayJy-1,todayJy,todayJy+1,todayJy+2].map(y=>`<option value="${y}" ${apptDraft.jy===y?"selected":""}>${faYear(y)}</option>`).join("");
  return `<div class="panel"><strong>نوبت جدید</strong>
    <label class="note" for="apName" style="display:block;margin-top:6px">اسم بیمار</label>
    <input type="text" id="apName" list="apPatList" placeholder="اسم بیمار" value="${esc(apptDraft.name||"")}">
    <datalist id="apPatList">${Object.values(patients).map(p=>`<option value="${esc(p.name)}">`).join("")}</datalist>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:8px">
      <div style="flex:1 1 140px"><label class="note" for="apDoc">دکتر</label><select id="apDoc">${docs.map(d=>`<option value="${d.id}" ${(apptDraft.doctor||docs[0]?.id)===d.id?"selected":""}>${esc(d.name)}</option>`).join("")}</select></div>
      <div style="flex:1 1 100px"><label class="note" for="apTime">ساعت</label><input type="time" id="apTime" value="${esc(apptDraft.time||"")}"></div>
    </div>
    <label class="note" style="display:block;margin-top:8px">تاریخ (شمسی)</label>
    <div class="row" style="flex-wrap:wrap;gap:10px;margin-top:2px">
      <select id="apDay" style="flex:1 1 70px">${dayOpts}</select>
      <select id="apMonth" style="flex:1 1 110px">${monthOpts}</select>
      <select id="apYear" style="flex:1 1 80px">${yearOpts}</select>
    </div>
    <label class="note" for="apNote" style="display:block;margin-top:8px">یادداشت (اختیاری)</label>
    <textarea id="apNote" style="min-height:44px" placeholder="مثلاً: برای عصب‌کشی زنگ زد">${esc(apptDraft.note||"")}</textarea>
    ${apptMsg?`<p class="okline" style="margin-top:8px">${apptMsg}</p>`:""}
    ${apptErr?`<p class="warn">${esc(apptErr)}</p>`:""}
    <p class="row" style="margin-top:8px"><button class="btn primary" data-act="ap-add">ثبت نوبت</button></p>
  </div>`;
}
function apptRowHtml(id,a,showDoc){
  const st=APPT_ST[a.status]||APPT_ST.scheduled;
  return `<div style="border-top:1px solid var(--line);padding:8px 0;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
    <div><strong>${esc(a.name)}</strong>${showDoc?` <span class="note">— ${esc(nm(a.doctor))}</span>`:""}${a.time?` <span class="note">${esc(a.time)}</span>`:""}${a.patientId?` <button class="btn quiet" data-pat="${a.patientId}" style="padding:2px 8px">پرونده</button>`:""}${a.note?`<div class="note">${esc(a.note)}</div>`:""}</div>
    <div class="row">
      <span style="color:${st[1]}">${st[0]}</span>
      ${a.status==="scheduled"?`<button class="btn quiet" data-apst="${id}|done">آمد</button><button class="btn quiet" data-apst="${id}|noshow">نیامد</button><button class="btn quiet" data-apst="${id}|cancelled">لغو</button>`:""}
      <button class="x" data-act="ap-del" data-id="${id}">حذف</button>
    </div></div>`;
}
function apptsByDateHtml(rows,showDoc){
  if(!rows.length) return `<div class="panel"><p class="note">نوبتی ثبت نشده.</p></div>`;
  const groups=[]; let cur=null;
  for(const [id,a] of rows){ if(!cur||cur.date!==a.date){cur={date:a.date,items:[]};groups.push(cur)} cur.items.push([id,a]) }
  return groups.map(g=>`<div class="panel"><strong>${apptDateLabel(g.date)}</strong>${g.items.map(([id,a])=>apptRowHtml(id,a,showDoc)).join("")}</div>`).join("");
}
function apptsTab(){ return apptFormHtml()+apptsByDateHtml(apptList(null),true); }
function apptBookingPanel(id){ if(byId(id)?.role!=="reception") return ""; return apptFormHtml()+apptsByDateHtml(apptList(null),true); }
function apptDoctorPanel(id){
  if(byId(id)?.role!=="doctor") return "";
  const rows=apptList(id); if(!rows.length) return "";
  return `<div class="panel"><strong>نوبت‌های من</strong></div>`+apptsByDateHtml(rows,false);
}
function apptAssistantPanel(id){
  if(byId(id)?.role!=="assistant") return "";
  const myDocs=ofRole("doctor").filter(d=>(cfg.pairings?.[d.id]||[]).includes(id)).map(d=>d.id);
  if(!myDocs.length) return "";
  const rows=apptList(null).filter(([,a])=>myDocs.includes(a.doctor)); if(!rows.length) return "";
  return `<div class="panel"><strong>نوبت‌های دکترهایی که باهاشون کار می‌کنی</strong></div>`+apptsByDateHtml(rows,true);
}
async function apptAdd(btn){
  const name=($("#apName")?.value||"").trim(), doctor=$("#apDoc")?.value, time=$("#apTime")?.value||"", note=($("#apNote")?.value||"").trim();
  if(!name){apptErr="اول اسم بیمار را بنویس.";return render()}
  if(!doctor){apptErr="دکتر را انتخاب کن.";return render()}
  const [gy,gm,gd]=jalaliToGregorian(apptDraft.jy,apptDraft.jm,apptDraft.jd);
  const date=gy+"-"+String(gm).padStart(2,"0")+"-"+String(gd).padStart(2,"0");
  const conflict=time&&Object.values(appts).some(a=>a.status==="scheduled"&&a.doctor===doctor&&a.date===date&&a.time===time);
  if(conflict&&btn&&btn.dataset.sure!=="1"){
    btn.dataset.sure="1"; btn.textContent=`${nm(doctor)} همین ساعت نوبت دیگه‌ای داره؛ مطمئنی؟ دوباره بزن`;
    return;
  }
  let patientId=findPatientIdByName(doctor,name), isNewPatient=false;
  if(!patientId){
    isNewPatient=true; patientId=uid();
    await db.doc("patients/"+patientId).set({id:patientId,doctor,name,age:null,nationalId:null,phone:null,createdAt:Date.now(),plan:[]});
  }
  const id=uid();
  await db.doc("appointments/"+id).set({id,name,patientId,doctor,date,time,note,status:"scheduled",createdAt:Date.now()});
  apptDraft={name:"",doctor:"",jy:null,jm:null,jd:null,time:"",note:""}; apptErr="";
  apptMsg=isNewPatient?`نوبت ثبت شد. چون «${esc(name)}» بیمار جدید بود، یه پرونده‌ی خالی هم براش ساخته شد؛ سن/تلفن و بقیه‌ی اطلاعاتش رو هر وقت مراجعه کرد از پرونده‌اش کامل کن.`:`نوبت ثبت شد و به پرونده‌ی موجود «${esc(name)}» وصل شد.`;
  render();
}
async function apptSetStatus(id,status){ const a=appts[id]; if(!a) return; await db.doc("appointments/"+id).set({...a,status}); }
async function apptDelete(id){ await db.doc("appointments/"+id).delete(); }

/* ---------- events ---------- */
function bind(){
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;FB.act("tab:"+tab);if(tab==="feedback"){fbList=null;fbErr=""}render();scrollTo(0,0)});
  document.querySelectorAll("[data-fbdone]").forEach(b=>b.onclick=()=>{fbSetDone(b.dataset.fbdone,b.dataset.on==="1");render()});
  document.querySelectorAll("[data-fbtype]").forEach(b=>b.onclick=()=>{fbType=b.dataset.fbtype;render()});
  const st=$("#staffTxt"); if(st) st.oninput=e=>staffDraft[who]=e.target.value;
  const qt=$("#reqTxt"); if(qt) qt.oninput=e=>reqDraft[who]=e.target.value;
  const mt=$("#mgrTxt"); if(mt) mt.oninput=e=>mgrDraft=e.target.value;
  document.querySelectorAll("[data-pat]").forEach(b=>b.onclick=()=>openPatientSheet(b.dataset.pat));
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>openStaffPage(b.dataset.page));
  const npn=$("#newPatName"); if(npn) npn.oninput=e=>patDraft.name=e.target.value;
  const npt=$("#newPatText"); if(npt) npt.oninput=e=>patDraft.text=e.target.value;
  const inn=$("#invName"); if(inn) inn.oninput=e=>invDraft.name=e.target.value;
  const inu=$("#invUnit"); if(inu) inu.oninput=e=>invDraft.unit=e.target.value;
  const inq=$("#invQty"); if(inq) inq.oninput=e=>invDraft.qty=e.target.value;
  const inm=$("#invMin"); if(inm) inm.oninput=e=>invDraft.minQty=e.target.value;
  const apn=$("#apName"); if(apn) apn.oninput=e=>apptDraft.name=e.target.value;
  const apd=$("#apDoc"); if(apd) apd.onchange=e=>apptDraft.doctor=e.target.value;
  const apdy=$("#apDay"); if(apdy) apdy.onchange=e=>apptDraft.jd=+e.target.value;
  const apmo=$("#apMonth"); if(apmo) apmo.onchange=e=>{apptDraft.jm=+e.target.value;render()};
  const apyr=$("#apYear"); if(apyr) apyr.onchange=e=>{apptDraft.jy=+e.target.value;render()};
  const aptm=$("#apTime"); if(aptm) aptm.oninput=e=>apptDraft.time=e.target.value;
  const apnt=$("#apNote"); if(apnt) apnt.oninput=e=>apptDraft.note=e.target.value;
  document.querySelectorAll("[data-apst]").forEach(b=>b.onclick=async()=>{const [id,st]=b.dataset.apst.split("|");b.disabled=true;await apptSetStatus(id,st)});
  for(const [id,k] of [["patFDoc","doc"],["patFPlan","plan"],["patFSort","sort"]]){ const el=$("#"+id); if(el) el.onchange=e=>{patFilter[k]=e.target.value;render()}; }
  const psb=$("#patSearchBox"); if(psb) psb.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();patSearch=e.target.value.trim();render()}};
  const ian=$("#intakeName"); if(ian) ian.oninput=e=>patDraft.iName=e.target.value;
  document.querySelectorAll('[data-pfroot="i"] [data-pf]').forEach(el=>{el.oninput=el.onchange=()=>{patDraft.pf=PF.read("i")}});
  const iad=$("#intakeDoc"); if(iad) iad.onchange=e=>patDraft.iDoc=e.target.value;
  document.querySelectorAll("[data-rm]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.rm; if(rmArm!==id){rmArm=id;staffMsg="";return render()}
    rmArm=null; b.disabled=true; const name=nm(id);
    const v=validate({op:"remove_staff",id}); if(!v){staffMsg="این فرد پیدا نشد.";staffMsgBad=true;return render()}
    rulePending={actions:[v],rejected:[]}; ruleDraft=""; await ruleApply();
    if(ruleErr){staffMsg=`${name} حذف نشد: ${ruleErr}`;staffMsgBad=true;ruleErr=""} else {staffMsg=`${name} به‌طور کامل از سیستم حذف شد.`+(ruleAfter.includes("تداخل")?" برنامه این هفته اثر گرفته؛ تب «برنامه» را ببینید.":"");staffMsgBad=false}
    render();
  });
  document.querySelectorAll("[data-cv]").forEach(b=>b.onclick=async()=>{const [c,rid]=b.dataset.cv.split("|");b.disabled=true;await db.doc("responses/"+rid+"__"+who).set({reqId:rid,staff:who,can:c==="1",at:Date.now()})});
  document.querySelectorAll("[data-dp]").forEach(b=>b.onclick=async()=>{const [rid,pick]=b.dataset.dp.split("|");b.disabled=true;await db.doc("docpref/"+rid).set({reqId:rid,doctor:who,pick:pick||null,at:Date.now()})});
  document.querySelectorAll("[id^=rsn-]").forEach(i=>i.oninput=e=>rsnDraft[i.id.slice(4)]=e.target.value);
  document.querySelectorAll("[data-rq]").forEach(b=>b.onclick=async()=>{const [t,rid,v]=b.dataset.rq.split("|");b.disabled=true;if(t==="ok")await approveRequest(rid,v||null);else await rejectRequest(rid);render()});
  document.querySelectorAll("[data-fix]").forEach(b=>b.onclick=async()=>{const [t,key,a,x,al]=b.dataset.fix.split("|");b.disabled=true;await quickFix(t,key,a,x,al)});
  document.querySelectorAll("[data-gask]").forEach(b=>b.onclick=async()=>{const [key,d]=b.dataset.gask.split("|");b.disabled=true;await createGapAsk(key,d,who==="manager"?"manager":who)});
  document.querySelectorAll("[data-close]").forEach(b=>b.onclick=async()=>{const S=structuredClone(sched);S.alerts=S.alerts.map(a=>a.id===b.dataset.close?{...a,resolved:true}:a);await db.doc("clinic/schedule").set(S)});
  document.querySelectorAll("[data-conf]").forEach(b=>b.onclick=async()=>{const [v,cid]=b.dataset.conf.split("|");b.disabled=true;await respondConfirm(cid,v==="1")});
  const rt=$("#ruleTxt"); if(rt) rt.oninput=e=>ruleDraft=e.target.value;
  const cni=$("#clinicNameInp"); if(cni) cni.oninput=e=>clinicNameDraft=e.target.value;
  document.querySelectorAll("[data-name]").forEach(i=>i.oninput=e=>nameDraft[i.dataset.name]=e.target.value);
  document.querySelectorAll("[data-spec]").forEach(i=>i.onchange=e=>specDraft[i.dataset.spec]=e.target.value);
  document.querySelectorAll("[data-cell]").forEach(b=>b.onclick=()=>{
    const [,k,sk]=b.dataset.cell.split("|"); const g=staffParse[who].grid; g[k][sk]=!g[k][sk]; render();
  });
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    const c=structuredClone(cfg); c.rules=(c.rules||[]).filter(r=>r.id!==b.dataset.del); await db.doc("clinic/config").set(c);
  });
  document.querySelectorAll("[data-act]").forEach(b=>b.onclick=()=>act(b.dataset.act,b));
  IMP.bind();
}

async function act(a,btn){
  FB.act(a);
  if(a==="staff-parse") return staffParseRun();
  if(a==="staff-confirm") return staffConfirm();
  if(a==="staff-back"){delete staffParse[who];return render()}
  if(a==="staff-redo"){staffDraft[who]=avail[who]?.text||"";staffParse[who]=null;delete staffParse[who];
    await db.doc("avail/"+who).update({confirmed:false});return}
  if(a==="req-parse") return reqParseRun();
  if(a==="req-apply") return reqApply();
  if(a==="req-cancel"){delete reqPlan[who];return render()}
  if(a==="rule-parse"){ruleAfter="";return ruleParseRun()}
  if(a==="rule-apply") return ruleApply();
  if(a==="rule-cancel"){rulePending=null;return render()}
  if(a==="build"){
    if(sched?.published&&btn.dataset.sure!=="1"){btn.dataset.sure="1";btn.textContent="برنامه منتشر شده؛ مطمئنید؟ دوباره بزنید";return}
    btn.disabled=true;const b=buildSchedule();b.rev=sched?.rev||0;b.notices=sched?.notices||[];b.baseConflicts=checkConflicts(cfg,b).map(x=>x.text);await db.doc("clinic/schedule").set(b);return}
  if(a==="rebuild-part") return partialRebuild(btn);
  if(a==="ignore-conf"){await db.doc("clinic/schedule").update({baseConflicts:checkConflicts(cfg,sched).map(x=>x.text)});return}
  if(a==="publish"){const rev=(sched.rev||0)+1;await db.doc("clinic/schedule").update({published:true,rev,publishedAt:Date.now(),notices:[...(sched.notices||[]),{id:uid(),at:Date.now(),to:"all",text:rev>1?`نسخه ${fa(rev)} برنامه هفته منتشر شد. شیفت‌هایت را دوباره نگاه کن.`:"برنامه هفته منتشر شد."}].slice(-80)});return}
  if(a==="print") return doPrint();
  if(a==="pdf") return downloadPdf(btn);
  if(a==="xlsx") return downloadXlsx();
  if(a==="sync-open") return syncSheet();
  if(a==="fb-reload") return loadFeedback();
  if(a==="fb-done-toggle"){fbShowDone=!fbShowDone;return render();}
  if(a==="seen"){try{localStorage.setItem("seen_"+who,String(Date.now()))}catch(e){};return render()}
  if(a==="mgr-parse") return mgrParseRun();
  if(a==="mgr-apply") return mgrApply();
  if(a==="mgr-cancel"){mgrPlan=null;return render()}
  if(a==="dl"&&downloads){
    const doc=`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>برنامه شیفت</title><style>body{font-family:Vazirmatn,Tahoma,sans-serif}@page{size:A4 landscape;margin:10mm}</style></head><body>${printHtml()}</body></html>`;
    try{await saveFile({filename:"shift-schedule.html",data:doc})}catch(e){}
    return;
  }
  if(a==="save-names"){
    const c=structuredClone(cfg); for(const s of c.staff){const v=(nameDraft[s.id]??"").trim(); if(v) s.name=v.slice(0,40); if(specDraft[s.id]) s.specialty=specDraft[s.id]}
    await db.doc("clinic/config").set(c); nameDraft={}; specDraft={}; return;
  }
  if(a==="newweek"){
    if(btn.dataset.sure!=="1"){btn.dataset.sure="1";btn.textContent="مطمئنید؟ دوباره بزنید";return}
    btn.disabled=true;
    if(sched?.slots){
      const counts={};
      for(const key in sched.slots){
        const sl=sched.slots[key];
        for(const p of sl.pairs||[]){ if(p.d) counts[p.d]=(counts[p.d]||0)+1; if(p.a) counts[p.a]=(counts[p.a]||0)+1; }
        for(const r of sl.reception||[]) counts[r]=(counts[r]||0)+1;
      }
      if(Object.keys(counts).length){
        const wid="w"+Date.now().toString(36);
        await db.doc("archive/"+wid).set({id:wid,at:Date.now(),published:!!sched.published,counts,staffNames:Object.fromEntries(cfg.staff.map(s=>[s.id,s.name])),staffRoles:Object.fromEntries(cfg.staff.map(s=>[s.id,s.role]))});
      }
    }
    for(const id of Object.keys(avail)) await db.doc("avail/"+id).delete();
    for(const id of Object.keys(reqs)) await db.doc("requests/"+id).delete();
    for(const id of Object.keys(resps)) await db.doc("responses/"+id).delete();
    for(const id of Object.keys(dprefs)) await db.doc("docpref/"+id).delete();
    await db.doc("clinic/schedule").delete();
    const c=structuredClone(cfg); c.rules=(c.rules||[]).filter(r=>!r.temporary); await db.doc("clinic/config").set(c);
    return;
  }
  if(a==="random"){
    btn.disabled=true;
    for(const s of cfg.staff){
      const g=emptyGrid(); const p=s.role==="doctor"?.55:.7;
      for(const [k] of DAYS) for(const [sk] of SHIFTS) g[k][sk]=Math.random()<p;
      await db.doc("avail/"+s.id).set({staffId:s.id,text:"(داده تست)",grid:g,summary:"حضور تصادفی برای تست",confirmed:true,updatedAt:Date.now()});
    }
    return;
  }
  if(a==="pat-list-toggle"){patListOpen=!patListOpen;return render();}
  if(a==="pat-new") return patNewRun();
  if(a==="pat-parse") return patNoteParseRun();
  if(a==="pat-apply") return patApplyRun();
  if(a==="pat-cancel-note"){patDraft.pending=null;return renderPatientSheet()}
  if(a==="pat-info-save") return patInfoSave();
  if(a==="pat-toggle-edit") return patToggleEdit();
  if(a==="pat-pdf") return patientDownloadPdf(patDraft.openId,btn);
  if(a==="pat-print"){patientPrint(patDraft.openId);return}
  if(a==="pat-intake") return patIntakeRun();
  if(a==="inv-add") return invAdd();
  if(a==="inv-save") return invSave(btn.dataset.id);
  if(a==="inv-del") return invDelete(btn.dataset.id);
  if(a==="ap-add") return apptAdd(btn);
  if(a==="ap-del") return apptDelete(btn.dataset.id);
  if(a==="pay-add") return addPayment();
  if(a==="clinic-name-save") return clinicNameSave();
  if(a==="pat-search"){patSearch=($("#patSearchBox")?.value||"").trim();return render()}
  if(a==="pat-search-clear"){patSearch="";return render()}
  if(a==="pat-filter-clear"){patSearch="";patFilter={doc:"",plan:"",sort:"new"};return render()}
}
