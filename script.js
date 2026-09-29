(function(){
'use strict';

/* ================= Reglas del proceso ================= */
const ESTADOS=['Recibido','En diagnóstico','En reparación','Pendiente de repuesto','Reparado','Listo para entrega','Entregado','No reparable'];
const KEY={'Recibido':'rec','En diagnóstico':'dia','En reparación':'rep','Pendiente de repuesto':'pen','Reparado':'rpd','Listo para entrega':'lis','Entregado':'ent','No reparable':'nor'};
const TRANS={
  'Recibido':['En diagnóstico'],
  'En diagnóstico':['En reparación','Pendiente de repuesto','No reparable'],
  'En reparación':['Pendiente de repuesto','Reparado','No reparable'],
  'Pendiente de repuesto':['En reparación','No reparable'],
  'Reparado':['Listo para entrega','Entregado','En reparación'],
  'Listo para entrega':['Entregado','En reparación'],
  'Entregado':[],
  'No reparable':['Entregado']
};
const ETAPAS=['Recepción','Diagnóstico','Reparación','Pruebas','Entrega'];
const ETAPA_DE={'Recibido':0,'En diagnóstico':1,'En reparación':2,'Pendiente de repuesto':2,'Reparado':3,'Listo para entrega':4,'Entregado':4,'No reparable':null};
const PEND=['Recibido','En diagnóstico','En reparación','Pendiente de repuesto'];
const REAL=['Reparado','Listo para entrega','Entregado'];
const puedeEntregar=o=>['Reparado','Listo para entrega','No reparable'].includes(o.estado); // restricción 23

/* ================= Estado y almacenamiento ================= */
const COLS=['clientes','empresas','equipos','tecnicos','ordenes'];
let S={clientes:{},empresas:{},equipos:{},tecnicos:{},ordenes:{}};
let db=null, conn='conectando', ready=false, loaded={}, pending=false;
let route={view:'panel',id:null}, curKey=null;
const F={ord:{q:'',cli:'',tec:'',est:'',desde:'',hasta:'',gar:''},cli:{q:'',tipo:'',inact:false},eq:{q:'',inact:false},emp:{q:'',inact:false},tec:{inact:false}};

const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const clone=o=>JSON.parse(JSON.stringify(o));
const list=c=>Object.values(S[c]);
const norm=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
const byName=(a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''),'es');
const pad=n=>String(n).padStart(2,'0');
const dstr=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=()=>dstr(new Date());
const dateAgo=n=>dstr(new Date(Date.now()-n*864e5));
const isoAgo=n=>new Date(Date.now()-n*864e5).toISOString();
const fmtD=iso=>{if(!iso)return '—';const [y,m,d]=String(iso).slice(0,10).split('-');return d+'/'+m+'/'+y};
const fmtDT=iso=>{if(!iso)return '';const d=new Date(iso);return isNaN(d)?'':fmtD(dstr(d))+' '+pad(d.getHours())+':'+pad(d.getMinutes())};
const money=n=>'$ '+new Intl.NumberFormat('es-CO',{maximumFractionDigits:0}).format(n||0);
const nom=c=>c?c.nombre:'(sin registro)';
const eqL=e=>e?[e.tipo,e.marca,e.modelo].filter(Boolean).join(' '):'—';
const repTotal=o=>(o.repuestos||[]).reduce((s,r)=>s+(Number(r.cant)||0)*(Number(r.costo)||0),0);
const total=o=>(Number(o.manoObra)||0)+repTotal(o);

function persistLocal(){try{localStorage.setItem('taller.v1',JSON.stringify(S))}catch(e){}}
function loadLocal(){try{const r=localStorage.getItem('taller.v1');if(r){const d=JSON.parse(r);COLS.forEach(c=>{S[c]=d[c]||{}})}}catch(e){}}

async function put(col,obj){
  obj=clone(obj);S[col][obj.id]=obj;
  if(db){try{await db.doc(col+'/'+obj.id).set(obj)}catch(e){toast('No se pudo guardar: '+((e&&(e.message||e.code))||'error'),true)}}
  else persistLocal();
  render(true);
}

async function init(){
  applyRoute();
  render();
  let d=null;
  try{if(window.claude&&window.claude.use)d=await window.claude.use('db')}catch(e){d=null}
  if(d){
    db=d;conn='compartido';
    COLS.forEach(col=>{
      db.collection(col).onSnapshot(snap=>{
        const m={};snap.docs.forEach(x=>{m[x.id]=x.data()});
        S[col]=m;loaded[col]=true;
        if(COLS.every(c=>loaded[c]))ready=true;
        render();
      },err=>{toast('Error de sincronización: '+((err&&err.code)||''),true);loaded[col]=true;if(COLS.every(c=>loaded[c]))ready=true;render()});
    });
    setTimeout(()=>{if(!ready){ready=true;render()}},8000);
  }else{
    conn='local';loadLocal();ready=true;render();
  }
}

/* ================= Utilidades de interfaz ================= */
let tt;
function toast(m,bad){const t=$('#toast');t.textContent=m;t.className='show'+(bad?' bad':'');clearTimeout(tt);tt=setTimeout(()=>{t.className=''},4000)}
const chip=e=>`<span class="chip st-${KEY[e]}">${esc(e)}</span>`;
const chips=o=>chip(o.estado)+(o.esGarantia?' <span class="chip gar">Garantía</span>':'');

function rail(o,sm){
  const cur=ETAPA_DE[o.estado];let reached=cur;
  if(o.estado==='No reparable'){reached=0;(o.historial||[]).forEach(h=>{const e=ETAPA_DE[h.estado];if(e!=null)reached=Math.max(reached,e)})}
  const items=ETAPAS.map((n,i)=>{
    let cls='todo';
    if(o.estado==='No reparable')cls=i<reached?'done':(i===reached?'bad':'todo');
    else if(o.estado==='Entregado')cls='done';
    else cls=i<cur?'done':(i===cur?(o.estado==='Pendiente de repuesto'?'wait':'now'):'todo');
    return `<li class="${cls}"><span class="dot"></span><span class="lbl">${n}</span></li>`;
  }).join('');
  return `<ol class="rail${sm?' sm':''}" aria-label="Avance: ${esc(o.estado)}">${items}</ol>`;
}

function fld(label,name,val,o){
  o=o||{};const t=o.type||'text';
  const a=`name="${name}" ${o.req?'required':''} ${o.ph?`placeholder="${esc(o.ph)}"`:''} ${o.list?`list="${o.list}"`:''} ${o.dis?'disabled':''} ${o.min!=null?`min="${o.min}"`:''} ${o.step?`step="${o.step}"`:''} ${o.max?`max="${o.max}"`:''} ${o.auto?`autocomplete="${o.auto}"`:''}`;
  let inner;
  if(t==='textarea')inner=`<textarea ${a} rows="${o.rows||3}">${esc(val)}</textarea>`;
  else if(t==='select')inner=`<select ${a}>${o.opts.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(val==null?'':val)?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
  else inner=`<input type="${t}" ${a} value="${esc(val)}">`;
  return `<label class="f ${o.cls||''}"><span>${esc(label)}${o.req?' *':''}</span>${inner}${o.hint?`<small>${esc(o.hint)}</small>`:''}</label>`;
}

function dialog(cfg){
  const d=document.createElement('dialog');
  if(cfg.wide)d.className='wide';
  d.innerHTML=`<form class="dlg"><header><h2>${esc(cfg.title)}</h2><button type="button" class="x" data-close aria-label="Cerrar">×</button></header><div class="body">${cfg.body}</div><p class="err" role="alert" hidden></p><footer><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">${esc(cfg.submit||'Guardar')}</button></footer></form>`;
  $('#modals').appendChild(d);
  const f=$('form',d),err=$('.err',d);
  d.addEventListener('close',()=>d.remove());
  d.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>d.close()));
  f.addEventListener('submit',async e=>{
    e.preventDefault();const btn=$('button[type=submit]',f);btn.disabled=true;let r;
    try{r=await cfg.onSubmit(new FormData(f),f)}catch(x){r=(x&&x.message)||String(x)}
    btn.disabled=false;
    if(r){err.textContent=r;err.hidden=false;err.scrollIntoView({block:'nearest'})}else d.close();
  });
  d.showModal();
  if(cfg.onOpen)cfg.onOpen(d,f);
  return d;
}

function pagina(title,sub,acts,filters,fobj,draw){
  $('#view').innerHTML=`<div class="phead"><div><h1>${title}</h1>${sub?`<p class="sub">${sub}</p>`:''}</div><div class="acts">${acts}</div></div>${filters?`<form class="filters">${filters}</form>`:''}<div id="res"></div>`;
  const fm=$('.filters');
  if(fm){
    fm.addEventListener('submit',e=>e.preventDefault());
    fm.querySelectorAll('[name]').forEach(el=>{
      const h=()=>{fobj[el.name]=el.type==='checkbox'?el.checked:el.value;$('#res').innerHTML=draw()};
      el.addEventListener('input',h);el.addEventListener('change',h);
    });
  }
  $('#res').innerHTML=draw();
}
const chk=(label,name,v)=>`<label class="chk"><input type="checkbox" name="${name}" ${v?'checked':''}> ${esc(label)}</label>`;
const notFound=t=>{$('#view').innerHTML=`<div class="empty">No se encontró ${t}. <br><a href="#/panel">Volver al panel</a></div>`};

/* ================= Tablas de órdenes ================= */
const COLS_O={
  num:['Orden',o=>`<a class="num" href="#/ordenes/${o.id}">${esc(o.numero)}</a>`],
  fecha:['Recepción',o=>fmtD(o.fechaRecepcion)],
  cli:['Cliente',o=>esc(nom(S.clientes[o.clienteId]))],
  eq:['Electrodoméstico',o=>{const e=S.equipos[o.equipoId];return esc(eqL(e))+(e&&e.serie?`<br><small>Serie ${esc(e.serie)}</small>`:'')}],
  falla:['Falla reportada',o=>`<span class="clip" title="${esc(o.falla)}">${esc(o.falla)}</span>`],
  tec:['Técnico',o=>esc((S.tecnicos[o.tecnicoId]||{}).nombre||'—')],
  est:['Estado',o=>chips(o)+rail(o,true)],
  costo:['Costo',o=>money(total(o))]
};
function tablaOrdenes(ords,cols){
  if(!ords.length)return '<p class="empty">No hay órdenes que mostrar.</p>';
  return `<div class="scroll"><table class="t"><thead><tr>${cols.map(k=>`<th class="${k==='costo'?'r':''}">${COLS_O[k][0]}</th>`).join('')}</tr></thead><tbody>${ords.map(o=>`<tr data-go="ordenes/${o.id}">${cols.map(k=>`<td class="${k==='costo'?'r':''}">${COLS_O[k][1](o)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const ordenar=arr=>arr.sort((a,b)=>String(b.fechaRecepcion).localeCompare(String(a.fechaRecepcion))||(b.n||0)-(a.n||0));
const ordenesDe=(k,id)=>ordenar(list('ordenes').filter(o=>o[k]===id));

/* ================= Vistas ================= */
const V={};

V.panel=()=>{
  const ords=list('ordenes');
  const vacio=!ords.length&&!list('clientes').length;
  const cnt={};ESTADOS.forEach(e=>cnt[e]=0);ords.forEach(o=>cnt[o.estado]=(cnt[o.estado]||0)+1);
  const carga=list('tecnicos').filter(t=>t.activo!==false).sort(byName).map(t=>{
    const mine=ords.filter(o=>o.tecnicoId===t.id);
    return {t,abiertas:mine.filter(o=>PEND.includes(o.estado)).length,total:mine.length};
  });
  let html=`<div class="phead"><div><h1>Panel del taller</h1><p class="sub">Qué hay en el banco de trabajo hoy.</p></div></div>`;
  if(vacio){
    html+=`<div class="empty"><p><b>Aún no hay datos.</b></p><p>Empieza registrando un técnico, una empresa remitente (si trabajas con garantías) y tu primer cliente. También puedes ver la aplicación con datos de ejemplo.</p><p><button class="btn primary" data-act="ejemplo" type="button">Cargar datos de ejemplo</button> <a class="btn" href="#/tecnicos">Registrar técnicos</a></p></div>`;
  }
  html+=`<section class="consult"><h2>Consultar estado de una reparación</h2><p class="muted">Escribe el número de orden, el nombre o documento del cliente, o el número de serie.</p><input id="q" type="search" placeholder="Ej.: OS-0004, Torres, 1023…" autocomplete="off" aria-label="Buscar orden"><div id="qres"></div></section>`;
  html+=`<h2 style="margin-bottom:10px">Órdenes por estado</h2><div class="tallies">${ESTADOS.map(e=>`<button type="button" class="tally st-${KEY[e]}" style="--c:var(--st-${KEY[e]})" data-act="filtro-estado" data-est="${esc(e)}"><b>${cnt[e]}</b><span>${e}</span></button>`).join('')}</div>`;
  html+=`<div class="two"><section class="sec"><h2>Carga por técnico</h2>${carga.length?`<div class="scroll"><table class="t" style="min-width:0"><thead><tr><th>Técnico</th><th class="r">Abiertas</th><th class="r">Total</th></tr></thead><tbody>${carga.map(c=>`<tr data-act="filtro-tec" data-id="${c.t.id}" style="cursor:pointer"><td>${esc(c.t.nombre)}<br><small>${esc(c.t.especialidad||'')}</small></td><td class="r">${c.abiertas}</td><td class="r">${c.total}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No hay técnicos activos. <a href="#/tecnicos">Registrar técnicos</a></p>'}</section>`;
  html+=`<section class="sec"><h2>Últimas órdenes</h2>${tablaOrdenes(ordenar(ords.slice()).slice(0,6),['num','cli','est'])}</section></div>`;
  $('#view').innerHTML=html;
  const q=$('#q'),qr=$('#qres');
  const draw=()=>{
    const s=norm(q.value);
    if(!s){qr.innerHTML='';return}
    const hits=ordenar(ords.filter(o=>{const c=S.clientes[o.clienteId]||{},e=S.equipos[o.equipoId]||{};return [o.numero,c.nombre,c.documento,e.serie,e.marca,e.modelo,e.tipo].join(' ').toLowerCase().includes(s)})).slice(0,8);
    qr.innerHTML=hits.length?hits.map(o=>`<div class="hit"><a class="num" href="#/ordenes/${o.id}">${esc(o.numero)}</a><div class="who"><b>${esc(nom(S.clientes[o.clienteId]))}</b><small>${esc(eqL(S.equipos[o.equipoId]))} · recibido ${fmtD(o.fechaRecepcion)}</small></div><div>${chips(o)}${rail(o,true)}</div></div>`).join(''):'<p class="muted" style="padding-top:8px">No se encontraron órdenes con esa búsqueda.</p>';
  };
  q.addEventListener('input',draw);
};

/* --- Órdenes: listado --- */
function filtraOrdenes(){
  const f=F.ord,q=norm(f.q);
  return ordenar(list('ordenes').filter(o=>{
    const c=S.clientes[o.clienteId]||{},e=S.equipos[o.equipoId]||{};
    if(q&&![o.numero,c.nombre,c.documento,e.serie,e.marca,e.modelo,e.tipo,o.falla].join(' ').toLowerCase().includes(q))return false;
    if(f.cli&&o.clienteId!==f.cli)return false;
    if(f.tec&&o.tecnicoId!==f.tec)return false;
    if(f.est){
      if(f.est==='g:pend'&&!PEND.includes(o.estado))return false;
      if(f.est==='g:real'&&!REAL.includes(o.estado))return false;
      if(f.est==='g:nor'&&o.estado!=='No reparable')return false;
      if(f.est.startsWith('s:')&&o.estado!==f.est.slice(2))return false;
    }
    if(f.desde&&o.fechaRecepcion<f.desde)return false;
    if(f.hasta&&o.fechaRecepcion>f.hasta)return false;
    if(f.gar==='si'&&!o.esGarantia)return false;
    if(f.gar==='no'&&o.esGarantia)return false;
    return true;
  }));
}
V.ordenes=id=>{
  if(id)return ordenDetalle(id);
  const f=F.ord;
  const filters=
    fld('Buscar','q',f.q,{cls:'wide',ph:'Nº de orden, cliente, serie, falla…',type:'search'})+
    fld('Cliente','cli',f.cli,{type:'select',opts:[['','Todos'],...list('clientes').sort(byName).map(c=>[c.id,c.nombre])]})+
    fld('Técnico','tec',f.tec,{type:'select',opts:[['','Todos'],...list('tecnicos').sort(byName).map(t=>[t.id,t.nombre])]})+
    fld('Estado','est',f.est,{type:'select',opts:[['','Todos los estados'],['g:pend','Pendientes (sin reparar)'],['g:real','Servicios realizados'],['g:nor','No reparables'],...ESTADOS.map(e=>['s:'+e,e])]})+
    fld('Recibidas desde','desde',f.desde,{type:'date'})+
    fld('Hasta','hasta',f.hasta,{type:'date'})+
    fld('Garantía','gar',f.gar,{type:'select',opts:[['','Todas'],['si','Solo garantías'],['no','Sin garantía']]});
  pagina('Órdenes de servicio','Filtra por cliente, técnico, estado o período.','<button class="btn primary" data-act="nueva-orden" type="button">Nueva orden</button>',filters,f,()=>{
    const r=filtraOrdenes();
    return `<p class="muted" style="margin-bottom:8px">${r.length} ${r.length===1?'orden':'órdenes'}</p>`+(list('ordenes').length?tablaOrdenes(r,['num','fecha','cli','eq','tec','est','costo']):'<div class="empty"><p>Aún no hay órdenes de servicio.</p><button class="btn primary" data-act="nueva-orden" type="button">Crear la primera orden</button></div>');
  });
};

/* --- Órdenes: hoja de servicio --- */
function ordenDetalle(id){
  const o=S.ordenes[id];if(!o)return notFound('la orden');
  const c=S.clientes[o.clienteId],e=S.equipos[o.equipoId],t=S.tecnicos[o.tecnicoId],emp=S.empresas[o.empresaId];
  const lock=o.estado==='Entregado';
  const rt=repTotal(o),tot=total(o);
  const sigs=TRANS[o.estado];
  const acts=`<button class="btn primary" data-act="estado" data-id="${id}" type="button" ${sigs.length?'':'disabled'}>Cambiar estado</button><button class="btn" data-act="edit-orden" data-id="${id}" type="button" ${lock?'disabled':''}>Editar datos</button>`;
  const rmb=(act,i)=>lock?'':`<button class="btn sm ghost danger" type="button" data-act="${act}" data-id="${id}" data-i="${i}" aria-label="Quitar">Quitar</button>`;
  $('#view').innerHTML=`
  <p style="margin-bottom:8px"><a href="#/ordenes">← Órdenes</a></p>
  <section class="sheet-top">
    <div class="row1"><h1>${esc(o.numero)}</h1>${chips(o)}<span class="grow"></span><div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">${acts}</div></div>
    ${rail(o)}
  </section>
  ${lock?'<p class="lockmsg">Orden entregada el '+fmtD(o.fechaEntrega)+'. Ya no admite cambios y se conserva como historial.</p>':''}
  <div class="cols">
   <div>
    <section class="box"><header><h2>Falla reportada</h2></header><p class="diag">${esc(o.falla)}</p></section>
    <section class="box"><header><h2>Diagnóstico</h2><button class="btn sm" data-act="diag" data-id="${id}" type="button" ${lock?'disabled':''}>${o.diagnostico?'Editar':'Registrar'}</button></header>
      ${o.diagnostico?`<p class="diag">${esc(o.diagnostico)}</p>`:'<p class="muted">Todavía no se ha registrado el diagnóstico.</p>'}</section>
    <section class="box"><header><h2>Actividades de reparación</h2></header>
      ${(o.actividades||[]).length?`<ul class="plain">${o.actividades.map((a,i)=>`<li><span>${esc(a.texto)}</span><span class="d">${fmtD(a.fecha)} ${rmb('del-act',i)}</span></li>`).join('')}</ul>`:'<p class="muted">Sin actividades registradas.</p>'}
      ${lock?'':`<form class="inline" data-form="act" data-id="${id}"><label class="f grow"><span>Nueva actividad</span><input name="texto" required placeholder="Ej.: Reemplazo del termostato"></label><button class="btn" type="submit">Agregar</button></form>`}</section>
    <section class="box"><header><h2>Repuestos utilizados</h2></header>
      ${(o.repuestos||[]).length?`<div class="scroll"><table class="t" style="min-width:420px"><thead><tr><th>Repuesto</th><th class="r">Cant.</th><th class="r">Costo unit.</th><th class="r">Subtotal</th><th></th></tr></thead><tbody>${o.repuestos.map((r,i)=>`<tr><td>${esc(r.nombre)}</td><td class="r">${r.cant}</td><td class="r">${money(r.costo)}</td><td class="r">${money(r.cant*r.costo)}</td><td class="r">${rmb('del-rep',i)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Sin repuestos registrados.</p>'}
      ${lock?'':`<form class="inline" data-form="rep" data-id="${id}"><label class="f grow"><span>Repuesto</span><input name="nombre" required placeholder="Ej.: Compresor 1/5 HP"></label><label class="f"><span>Cantidad</span><input name="cant" type="number" min="1" step="1" value="1" required></label><label class="f"><span>Costo unitario</span><input name="costo" type="number" min="0" step="any" value="0" required></label><button class="btn" type="submit">Agregar</button></form>`}</section>
   </div>
   <div>
    <section class="box"><header><h2>Datos de la orden</h2></header>
      <dl class="kv">
        <dt>Cliente</dt><dd>${c?`<a href="#/clientes/${c.id}">${esc(c.nombre)}</a>`:'—'} ${c&&c.tipo==='corporativo'?'<span class="chip inactivo">Corporativo</span>':''}</dd>
        <dt>Equipo</dt><dd>${e?`<a href="#/equipos/${e.id}">${esc(eqL(e))}</a>`:'—'}${e&&e.serie?`<br><small>Serie ${esc(e.serie)}</small>`:''}</dd>
        <dt>Recepción</dt><dd>${fmtD(o.fechaRecepcion)}</dd>
        <dt>Técnico</dt><dd>${esc(t?t.nombre:'—')}</dd>
        <dt>Garantía</dt><dd>${o.esGarantia?`Sí — <a href="#/empresas/${o.empresaId}">${esc(emp?emp.nombre:'(sin registro)')}</a>${o.refGarantia?`<br><small>Ref. ${esc(o.refGarantia)}</small>`:''}`:'No'}</dd>
        ${o.fechaEntrega?`<dt>Entrega</dt><dd>${fmtD(o.fechaEntrega)}</dd>`:''}
      </dl></section>
    <section class="box"><header><h2>Costos</h2><button class="btn sm" data-act="costos" data-id="${id}" type="button" ${lock?'disabled':''}>Editar</button></header>
      <div class="tot"><span>Mano de obra</span><span class="money">${money(o.manoObra)}</span></div>
      <div class="tot"><span>Repuestos</span><span class="money">${money(rt)}</span></div>
      <div class="tot big"><span>Total del servicio</span><span class="money">${money(tot)}</span></div>
      ${o.esGarantia?`<div class="tot"><span>Paga el cliente</span><span class="money">${money(0)}</span></div><div class="tot"><span>Se cobra a ${esc(emp?emp.nombre:'la empresa')}</span><span class="money">${money(tot)}</span></div>`:''}</section>
    <section class="box"><header><h2>Historial de estados</h2></header>
      <ul class="tl">${(o.historial||[]).slice().reverse().map(h=>`<li style="--c:var(--st-${KEY[h.estado]})"><b>${esc(h.estado)}</b><span class="d">${fmtDT(h.fecha)}</span>${h.nota?`<span>${esc(h.nota)}</span>`:''}</li>`).join('')}</ul></section>
   </div>
  </div>`;
}

/* --- Clientes --- */
V.clientes=id=>{
  if(id)return clienteDetalle(id);
  const f=F.cli;
  const filters=fld('Buscar','q',f.q,{cls:'wide',type:'search',ph:'Nombre, documento o teléfono'})+
    fld('Tipo','tipo',f.tipo,{type:'select',opts:[['','Todos'],['particular','Particulares'],['corporativo','Corporativos']]})+chk('Incluir inactivos','inact',f.inact);
  pagina('Clientes','Particulares y clientes remitidos por una empresa.','<button class="btn primary" data-act="nuevo-cliente" type="button">Nuevo cliente</button>',filters,f,()=>{
    const q=norm(f.q);
    const r=list('clientes').filter(c=>(f.inact||c.activo!==false)&&(!f.tipo||c.tipo===f.tipo)&&(!q||[c.nombre,c.documento,c.telefono,c.email].join(' ').toLowerCase().includes(q))).sort(byName);
    if(!r.length)return list('clientes').length?'<p class="empty">Ningún cliente coincide con los filtros.</p>':'<div class="empty"><p>Aún no hay clientes registrados.</p><button class="btn primary" data-act="nuevo-cliente" type="button">Registrar un cliente</button></div>';
    return `<div class="scroll"><table class="t"><thead><tr><th>Cliente</th><th>Tipo</th><th>Documento</th><th>Teléfono</th><th>Remitido por</th><th class="r">Equipos</th><th class="r">Órdenes</th></tr></thead><tbody>${r.map(c=>`<tr data-go="clientes/${c.id}"><td><a class="num" href="#/clientes/${c.id}">${esc(c.nombre)}</a>${c.activo===false?' <span class="chip inactivo">Inactivo</span>':''}</td><td>${c.tipo==='corporativo'?'Corporativo':'Particular'}</td><td>${esc(c.documento)}</td><td>${esc(c.telefono)}</td><td>${c.tipo==='corporativo'?esc(nom(S.empresas[c.empresaId])):'—'}</td><td class="r">${list('equipos').filter(e=>e.propietarioId===c.id).length}</td><td class="r">${list('ordenes').filter(o=>o.clienteId===c.id).length}</td></tr>`).join('')}</tbody></table></div>`;
  });
};
function clienteDetalle(id){
  const c=S.clientes[id];if(!c)return notFound('el cliente');
  const eqs=list('equipos').filter(e=>e.propietarioId===id).sort((a,b)=>eqL(a).localeCompare(eqL(b)));
  const emp=S.empresas[c.empresaId];
  $('#view').innerHTML=`<p style="margin-bottom:8px"><a href="#/clientes">← Clientes</a></p>
  <div class="phead"><div><h1>${esc(c.nombre)}</h1><p class="sub">${c.tipo==='corporativo'?'Cliente corporativo':'Cliente particular'}${c.activo===false?' · Inactivo':''}</p></div>
   <div class="acts"><button class="btn primary" data-act="nueva-orden" data-cli="${id}" type="button" ${c.activo===false?'disabled':''}>Nueva orden</button><button class="btn" data-act="edit-cliente" data-id="${id}" type="button">Editar</button><button class="btn" data-act="toggle-cliente" data-id="${id}" type="button">${c.activo===false?'Reactivar':'Desactivar'}</button></div></div>
  <div class="cols"><div>
   <section class="box"><header><h2>Electrodomésticos</h2><button class="btn sm" data-act="nuevo-equipo" data-cli="${id}" type="button">Agregar</button></header>
    ${eqs.length?`<ul class="plain">${eqs.map(e=>`<li><span><a href="#/equipos/${e.id}">${esc(eqL(e))}</a>${e.serie?`<br><small>Serie ${esc(e.serie)}</small>`:''}</span><span class="d">${ordenesDe('equipoId',e.id).length} órdenes</span></li>`).join('')}</ul>`:'<p class="muted">Este cliente no tiene electrodomésticos registrados.</p>'}</section>
   <section class="sec"><h2>Historial de servicios</h2>${tablaOrdenes(ordenesDe('clienteId',id),['num','fecha','eq','falla','est','costo'])}</section>
  </div><div>
   <section class="box"><header><h2>Datos de contacto</h2></header><dl class="kv">
    <dt>Documento</dt><dd>${esc(c.documento)||'—'}</dd><dt>Teléfono</dt><dd>${esc(c.telefono)||'—'}</dd><dt>Correo</dt><dd>${esc(c.email)||'—'}</dd><dt>Dirección</dt><dd>${esc(c.direccion)||'—'}</dd>
    ${c.tipo==='corporativo'?`<dt>Remitido por</dt><dd>${emp?`<a href="#/empresas/${emp.id}">${esc(emp.nombre)}</a>`:'—'}</dd><dt>Ref. remisión</dt><dd>${esc(c.refRemision)||'—'}</dd>`:''}
   </dl></section></div></div>`;
}

/* --- Electrodomésticos --- */
V.equipos=id=>{
  if(id)return equipoDetalle(id);
  const f=F.eq;
  const filters=fld('Buscar','q',f.q,{cls:'wide',type:'search',ph:'Tipo, marca, modelo, serie o propietario'})+chk('Incluir inactivos','inact',f.inact);
  pagina('Electrodomésticos','Cada equipo pertenece a un propietario registrado.','<button class="btn primary" data-act="nuevo-equipo" type="button">Nuevo electrodoméstico</button>',filters,f,()=>{
    const q=norm(f.q);
    const r=list('equipos').filter(e=>(f.inact||e.activo!==false)&&(!q||[e.tipo,e.marca,e.modelo,e.serie,nom(S.clientes[e.propietarioId])].join(' ').toLowerCase().includes(q))).sort((a,b)=>eqL(a).localeCompare(eqL(b)));
    if(!r.length)return list('equipos').length?'<p class="empty">Ningún equipo coincide con la búsqueda.</p>':'<div class="empty"><p>Aún no hay electrodomésticos registrados.</p><button class="btn primary" data-act="nuevo-equipo" type="button">Registrar un electrodoméstico</button></div>';
    return `<div class="scroll"><table class="t"><thead><tr><th>Tipo</th><th>Marca y modelo</th><th>N.º de serie</th><th>Propietario</th><th class="r">Órdenes</th></tr></thead><tbody>${r.map(e=>`<tr data-go="equipos/${e.id}"><td><a class="num" href="#/equipos/${e.id}">${esc(e.tipo)}</a>${e.activo===false?' <span class="chip inactivo">Inactivo</span>':''}</td><td>${esc([e.marca,e.modelo].filter(Boolean).join(' '))}</td><td>${esc(e.serie)||'<span class="muted">Sin serie</span>'}</td><td>${esc(nom(S.clientes[e.propietarioId]))}</td><td class="r">${ordenesDe('equipoId',e.id).length}</td></tr>`).join('')}</tbody></table></div>`;
  });
};
function equipoDetalle(id){
  const e=S.equipos[id];if(!e)return notFound('el electrodoméstico');
  const p=S.clientes[e.propietarioId];
  $('#view').innerHTML=`<p style="margin-bottom:8px"><a href="#/equipos">← Electrodomésticos</a></p>
  <div class="phead"><div><h1>${esc(eqL(e))}</h1><p class="sub">${e.serie?'Serie '+esc(e.serie):'Sin número de serie'}${e.activo===false?' · Inactivo':''}</p></div>
   <div class="acts"><button class="btn primary" data-act="nueva-orden" data-cli="${e.propietarioId}" data-eq="${id}" type="button" ${e.activo===false?'disabled':''}>Nueva orden</button><button class="btn" data-act="edit-equipo" data-id="${id}" type="button">Editar</button><button class="btn" data-act="toggle-equipo" data-id="${id}" type="button">${e.activo===false?'Reactivar':'Desactivar'}</button></div></div>
  <div class="cols"><section class="sec"><h2>Historial de reparaciones</h2>${tablaOrdenes(ordenesDe('equipoId',id),['num','fecha','falla','tec','est','costo'])}</section>
  <section class="box"><header><h2>Datos del equipo</h2></header><dl class="kv"><dt>Propietario</dt><dd>${p?`<a href="#/clientes/${p.id}">${esc(p.nombre)}</a>`:'—'}</dd><dt>Tipo</dt><dd>${esc(e.tipo)}</dd><dt>Marca</dt><dd>${esc(e.marca)}</dd><dt>Modelo</dt><dd>${esc(e.modelo)||'—'}</dd><dt>Compra</dt><dd>${fmtD(e.fechaCompra)}</dd>${e.notas?`<dt>Notas</dt><dd>${esc(e.notas)}</dd>`:''}</dl></section></div>`;
}

/* --- Empresas --- */
V.empresas=id=>{
  if(id)return empresaDetalle(id);
  const f=F.emp;
  const filters=fld('Buscar','q',f.q,{cls:'wide',type:'search',ph:'Nombre o NIT'})+chk('Incluir inactivas','inact',f.inact);
  pagina('Empresas y almacenes','Quienes remiten clientes al taller para hacer efectiva una garantía.','<button class="btn primary" data-act="nueva-empresa" type="button">Nueva empresa</button>',filters,f,()=>{
    const q=norm(f.q);
    const r=list('empresas').filter(e=>(f.inact||e.activo!==false)&&(!q||[e.nombre,e.nit].join(' ').toLowerCase().includes(q))).sort(byName);
    if(!r.length)return list('empresas').length?'<p class="empty">Ninguna empresa coincide con la búsqueda.</p>':'<div class="empty"><p>Aún no hay empresas o almacenes registrados.</p><button class="btn primary" data-act="nueva-empresa" type="button">Registrar una empresa</button></div>';
    return `<div class="scroll"><table class="t"><thead><tr><th>Empresa</th><th>NIT</th><th>Contacto</th><th class="r">Clientes remitidos</th><th class="r">Órdenes en garantía</th></tr></thead><tbody>${r.map(e=>`<tr data-go="empresas/${e.id}"><td><a class="num" href="#/empresas/${e.id}">${esc(e.nombre)}</a>${e.activo===false?' <span class="chip inactivo">Inactiva</span>':''}</td><td>${esc(e.nit)}</td><td>${esc(e.contacto)}${e.telefono?`<br><small>${esc(e.telefono)}</small>`:''}</td><td class="r">${list('clientes').filter(c=>c.empresaId===e.id).length}</td><td class="r">${list('ordenes').filter(o=>o.esGarantia&&o.empresaId===e.id).length}</td></tr>`).join('')}</tbody></table></div>`;
  });
};
function empresaDetalle(id){
  const e=S.empresas[id];if(!e)return notFound('la empresa');
  const cls=list('clientes').filter(c=>c.empresaId===id).sort(byName);
  const gar=ordenar(list('ordenes').filter(o=>o.esGarantia&&o.empresaId===id));
  $('#view').innerHTML=`<p style="margin-bottom:8px"><a href="#/empresas">← Empresas</a></p>
  <div class="phead"><div><h1>${esc(e.nombre)}</h1><p class="sub">NIT ${esc(e.nit)}${e.activo===false?' · Inactiva':''}</p></div>
  <div class="acts"><button class="btn" data-act="edit-empresa" data-id="${id}" type="button">Editar</button><button class="btn" data-act="toggle-empresa" data-id="${id}" type="button">${e.activo===false?'Reactivar':'Desactivar'}</button></div></div>
  <div class="cols"><div>
   <section class="sec"><h2>Órdenes en garantía</h2>${tablaOrdenes(gar,['num','fecha','cli','eq','est','costo'])}</section>
  </div><div>
   <section class="box"><header><h2>Contacto</h2></header><dl class="kv"><dt>Persona</dt><dd>${esc(e.contacto)||'—'}</dd><dt>Teléfono</dt><dd>${esc(e.telefono)||'—'}</dd><dt>Correo</dt><dd>${esc(e.email)||'—'}</dd></dl></section>
   <section class="box"><header><h2>Condiciones de garantía</h2></header><p class="diag">${esc(e.condiciones)||'<span class="muted">No se han registrado condiciones.</span>'}</p></section>
   <section class="box"><header><h2>Clientes remitidos</h2></header>${cls.length?`<ul class="plain">${cls.map(c=>`<li><a href="#/clientes/${c.id}">${esc(c.nombre)}</a><span class="d">${list('ordenes').filter(o=>o.clienteId===c.id).length} órdenes</span></li>`).join('')}</ul>`:'<p class="muted">Aún no ha remitido clientes.</p>'}</section>
  </div></div>`;
}

/* --- Técnicos --- */
V.tecnicos=()=>{
  const f=F.tec;
  pagina('Técnicos','Responsables de diagnosticar y reparar.','<button class="btn primary" data-act="nuevo-tec" type="button">Nuevo técnico</button>',chk('Incluir inactivos','inact',f.inact),f,()=>{
    const r=list('tecnicos').filter(t=>f.inact||t.activo!==false).sort(byName);
    if(!r.length)return '<div class="empty"><p>Aún no hay técnicos registrados. Toda orden necesita un técnico responsable.</p><button class="btn primary" data-act="nuevo-tec" type="button">Registrar un técnico</button></div>';
    const ords=list('ordenes');
    return `<div class="scroll"><table class="t"><thead><tr><th>Técnico</th><th>Especialidad</th><th>Teléfono</th><th class="r">Abiertas</th><th class="r">Total</th><th></th></tr></thead><tbody>${r.map(t=>{const m=ords.filter(o=>o.tecnicoId===t.id);return `<tr><td><b>${esc(t.nombre)}</b>${t.activo===false?' <span class="chip inactivo">Inactivo</span>':''}</td><td>${esc(t.especialidad)||'—'}</td><td>${esc(t.telefono)||'—'}</td><td class="r">${m.filter(o=>PEND.includes(o.estado)).length}</td><td class="r">${m.length}</td><td class="r"><button class="btn sm" type="button" data-act="filtro-tec" data-id="${t.id}">Ver órdenes</button> <button class="btn sm" type="button" data-act="edit-tec" data-id="${t.id}">Editar</button> <button class="btn sm" type="button" data-act="toggle-tec" data-id="${t.id}">${t.activo===false?'Reactivar':'Desactivar'}</button></td></tr>`}).join('')}</tbody></table></div>`;
  });
};

/* ================= Formularios ================= */
function empresaDlg(id,after){
  const e=id?clone(S.empresas[id]):{};
  dialog({title:id?'Editar empresa':'Nueva empresa o almacén',body:
    `<div class="grid2">${fld('Nombre de la empresa','nombre',e.nombre,{req:true,cls:'full'})}${fld('NIT','nit',e.nit,{req:true})}${fld('Persona de contacto','contacto',e.contacto)}${fld('Teléfono','telefono',e.telefono,{type:'tel'})}${fld('Correo','email',e.email,{type:'email'})}${fld('Condiciones de garantía','condiciones',e.condiciones,{type:'textarea',cls:'full',hint:'Vigencia, coberturas y exclusiones que acordó con el taller.'})}</div>`,
    async onSubmit(fd){
      const nombre=fd.get('nombre').trim(),nit=fd.get('nit').trim();
      if(list('empresas').some(x=>x.id!==id&&norm(x.nit)===norm(nit)))return 'Ya existe una empresa registrada con ese NIT.';
      const o=Object.assign({id:id||uid('e'),activo:true},e,{nombre,nit,contacto:fd.get('contacto').trim(),telefono:fd.get('telefono').trim(),email:fd.get('email').trim(),condiciones:fd.get('condiciones').trim()});
      await put('empresas',o);toast('Empresa guardada.');if(after)after(o.id);
    }});
}
function tecnicoDlg(id){
  const t=id?clone(S.tecnicos[id]):{};
  dialog({title:id?'Editar técnico':'Nuevo técnico',body:`<div class="grid2">${fld('Nombre completo','nombre',t.nombre,{req:true,cls:'full'})}${fld('Especialidad','especialidad',t.especialidad,{ph:'Ej.: Refrigeración'})}${fld('Teléfono','telefono',t.telefono,{type:'tel'})}</div>`,
    async onSubmit(fd){
      const o=Object.assign({id:id||uid('t'),activo:true},t,{nombre:fd.get('nombre').trim(),especialidad:fd.get('especialidad').trim(),telefono:fd.get('telefono').trim()});
      await put('tecnicos',o);toast('Técnico guardado.');
    }});
}
function clienteDlg(id,after){
  const c=id?clone(S.clientes[id]):{tipo:'particular'};
  const emps=list('empresas').filter(e=>e.activo!==false||e.id===c.empresaId).sort(byName);
  dialog({title:id?'Editar cliente':'Nuevo cliente',body:`
    <fieldset><legend>Tipo de cliente</legend>
      <label><input type="radio" name="tipo" value="particular" ${c.tipo!=='corporativo'?'checked':''}> Particular — trae su electrodoméstico directamente al taller</label>
      <label><input type="radio" name="tipo" value="corporativo" ${c.tipo==='corporativo'?'checked':''}> Corporativo — remitido por un almacén o empresa por garantía</label></fieldset>
    <div class="grid2">${fld('Nombre completo','nombre',c.nombre,{req:true,cls:'full',auto:'off'})}${fld('Documento de identidad','documento',c.documento,{req:true})}${fld('Teléfono','telefono',c.telefono,{req:true,type:'tel'})}${fld('Correo','email',c.email,{type:'email'})}${fld('Dirección','direccion',c.direccion)}</div>
    <div class="subbox" data-corp hidden>
      ${fld('Empresa que lo remite','empresaId',c.empresaId||'',{type:'select',opts:[['','Seleccionar empresa…'],...emps.map(e=>[e.id,e.nombre])],hint:emps.length?'':'Primero registra la empresa o almacén.'})}
      <p class="hint"><button type="button" class="link" data-newemp>Registrar una empresa nueva</button></p>
      ${fld('Referencia de la remisión','refRemision',c.refRemision,{ph:'Nº de factura o remisión (opcional)'})}
    </div>`,
    onOpen(d,f){
      const box=$('[data-corp]',d),sel=f.elements.empresaId;
      const sync=()=>{const corp=f.elements.tipo.value==='corporativo';box.hidden=!corp;sel.required=corp};
      f.querySelectorAll('[name=tipo]').forEach(r=>r.addEventListener('change',sync));sync();
      $('[data-newemp]',d).addEventListener('click',()=>empresaDlg(null,eid=>{
        const o=document.createElement('option');o.value=eid;o.textContent=S.empresas[eid].nombre;sel.appendChild(o);sel.value=eid;
      }));
    },
    async onSubmit(fd){
      const tipo=fd.get('tipo'),doc=fd.get('documento').trim();
      if(list('clientes').some(x=>x.id!==id&&norm(x.documento)===norm(doc)))return 'Ya existe un cliente con ese documento.';
      if(tipo==='corporativo'&&!fd.get('empresaId'))return 'Un cliente corporativo debe indicar la empresa que lo remite.';
      const o=Object.assign({id:id||uid('c'),activo:true},c,{tipo,nombre:fd.get('nombre').trim(),documento:doc,telefono:fd.get('telefono').trim(),email:fd.get('email').trim(),direccion:fd.get('direccion').trim()});
      if(tipo==='corporativo'){o.empresaId=fd.get('empresaId');o.refRemision=fd.get('refRemision').trim()}else{o.empresaId='';o.refRemision=''}
      await put('clientes',o);toast('Cliente guardado.');if(after)after(o.id);
    }});
}
function equipoDlg(id,pre,after){
  pre=pre||{};
  const e=id?clone(S.equipos[id]):{propietarioId:pre.cli||''};
  const cls=list('clientes').filter(c=>c.activo!==false||c.id===e.propietarioId).sort(byName);
  dialog({title:id?'Editar electrodoméstico':'Nuevo electrodoméstico',body:`<div class="grid2">
    ${fld('Propietario','propietarioId',e.propietarioId,{type:'select',req:true,cls:'full',opts:[['','Seleccionar cliente…'],...cls.map(c=>[c.id,c.nombre])]})}
    ${fld('Tipo','tipo',e.tipo,{req:true,list:'dl-tipos',ph:'Nevera, lavadora…'})}${fld('Marca','marca',e.marca,{req:true})}
    ${fld('Modelo','modelo',e.modelo,{req:true})}${fld('Número de serie','serie',e.serie,{hint:'Déjalo vacío si el equipo no tiene serie visible.'})}
    ${fld('Fecha de compra','fechaCompra',e.fechaCompra,{type:'date'})}${fld('Notas','notas',e.notas)}</div>`,
    async onSubmit(fd){
      const serie=fd.get('serie').trim();
      if(serie&&list('equipos').some(x=>x.id!==id&&norm(x.serie)===norm(serie)))return 'Ese número de serie ya está registrado en otro electrodoméstico.';
      const o=Object.assign({id:id||uid('q'),activo:true},e,{propietarioId:fd.get('propietarioId'),tipo:fd.get('tipo').trim(),marca:fd.get('marca').trim(),modelo:fd.get('modelo').trim(),serie,fechaCompra:fd.get('fechaCompra'),notas:fd.get('notas').trim()});
      await put('equipos',o);toast('Electrodoméstico guardado.');if(after)after(o.id);
    }});
}

function ordenDlg(id,pre){
  pre=pre||{};
  const ed=id?clone(S.ordenes[id]):null;
  const tecs=list('tecnicos').filter(t=>t.activo!==false||(ed&&t.id===ed.tecnicoId)).sort(byName);
  const clis=()=>list('clientes').filter(c=>c.activo!==false).sort(byName);
  const emps=list('empresas').filter(e=>e.activo!==false||(ed&&e.id===ed.empresaId)).sort(byName);
  const o0=ed||{fechaRecepcion:today()};
  const head=ed?`<p class="fixed">Cliente: <b>${esc(nom(S.clientes[ed.clienteId]))}</b> · Equipo: <b>${esc(eqL(S.equipos[ed.equipoId]))}</b></p>`:
    `${fld('Cliente','clienteId',pre.cli||'',{type:'select',req:true,opts:[['','Seleccionar cliente…'],...clis().map(c=>[c.id,c.nombre])]})}
     <p class="hint" style="margin-top:-6px"><button type="button" class="link" data-newcli>Registrar un cliente nuevo</button></p>
     ${fld('Electrodoméstico','equipoId','',{type:'select',req:true,opts:[['','Primero elige un cliente']]})}
     <div class="grid2 subbox" data-neweq hidden>
       ${fld('Tipo','n_tipo','',{list:'dl-tipos',ph:'Nevera, lavadora…'})}${fld('Marca','n_marca','')}${fld('Modelo','n_modelo','')}${fld('Número de serie','n_serie','',{hint:'Opcional si no tiene.'})}</div>`;
  dialog({wide:true,title:ed?'Editar '+ed.numero:'Nueva orden de servicio',body:`${head}
    <div class="grid2">${fld('Fecha de recepción','fechaRecepcion',o0.fechaRecepcion,{type:'date',req:true})}${fld('Técnico responsable','tecnicoId',o0.tecnicoId||'',{type:'select',req:true,opts:[['','Seleccionar técnico…'],...tecs.map(t=>[t.id,t.nombre])]})}</div>
    ${fld('Falla reportada','falla',o0.falla,{type:'textarea',req:true,ph:'Qué dice el cliente que le pasa al equipo'})}
    <label class="chk"><input type="checkbox" name="esGarantia" ${o0.esGarantia?'checked':''}> Este servicio corresponde a una garantía</label>
    <p class="hint" data-gnote hidden>Los clientes particulares no manejan garantía.</p>
    <div class="subbox" data-gar hidden>
      ${fld('Almacén o empresa que respalda la garantía','empresaId',o0.empresaId||'',{type:'select',opts:[['','Seleccionar empresa…'],...emps.map(e=>[e.id,e.nombre])]})}
      ${fld('Referencia de la garantía','refGarantia',o0.refGarantia,{ph:'Nº de factura o remisión (opcional)'})}</div>`,
    onOpen(d,f){
      const el=f.elements,chkG=el.esGarantia,box=$('[data-gar]',d),note=$('[data-gnote]',d);
      const cliObj=()=>S.clientes[ed?ed.clienteId:el.clienteId.value];
      const syncGar=()=>{
        const c=cliObj(),corp=c&&c.tipo==='corporativo';
        if(!ed||true){
          chkG.disabled=!!(c&&!corp);
          if(c&&!corp)chkG.checked=false;
          note.hidden=!(c&&!corp);
        }
        const on=chkG.checked;box.hidden=!on;el.empresaId.required=on;
        if(on&&!el.empresaId.value&&c&&c.empresaId&&S.empresas[c.empresaId])el.empresaId.value=c.empresaId;
      };
      chkG.addEventListener('change',syncGar);
      if(!ed){
        const selC=el.clienteId,selE=el.equipoId,nb=$('[data-neweq]',d);
        const fillEq=()=>{
          const eqs=list('equipos').filter(q=>q.propietarioId===selC.value&&q.activo!==false).sort((a,b)=>eqL(a).localeCompare(eqL(b)));
          const opts=selC.value?[['','Seleccionar equipo…'],...eqs.map(q=>[q.id,eqL(q)+(q.serie?' · '+q.serie:'')]),['__new__','+ Registrar un electrodoméstico nuevo…']]:[['','Primero elige un cliente']];
          selE.innerHTML=opts.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');
          if(pre.eq&&eqs.some(q=>q.id===pre.eq)){selE.value=pre.eq;pre.eq=null}
          else if(selC.value&&!eqs.length)selE.value='__new__';
          syncNew();
        };
        const syncNew=()=>{const n=selE.value==='__new__';nb.hidden=!n;['n_tipo','n_marca','n_modelo'].forEach(k=>{el[k].required=n})};
        selC.addEventListener('change',()=>{fillEq();syncGar()});
        selE.addEventListener('change',syncNew);
        $('[data-newcli]',d).addEventListener('click',()=>clienteDlg(null,cid=>{
          const c=S.clientes[cid];const op=document.createElement('option');op.value=cid;op.textContent=c.nombre;selC.appendChild(op);selC.value=cid;fillEq();syncGar();
        }));
        fillEq();
      }
      syncGar();
    },
    async onSubmit(fd){
      const cid=ed?ed.clienteId:fd.get('clienteId');
      const c=S.clientes[cid];if(!c)return 'Toda orden debe estar asociada a un cliente.';
      const gar=fd.get('esGarantia')==='on',emp=fd.get('empresaId');
      if(gar&&c.tipo!=='corporativo')return 'Solo los clientes corporativos pueden tener servicios en garantía.';
      if(gar&&!emp)return 'Una reparación en garantía debe identificar el almacén o empresa responsable.';
      let eid=ed?ed.equipoId:fd.get('equipoId');
      if(!eid)return 'Selecciona el electrodoméstico.';
      if(!ed&&eid==='__new__'){
        const serie=fd.get('n_serie').trim();
        if(serie&&list('equipos').some(x=>norm(x.serie)===norm(serie)))return 'Ese número de serie ya está registrado en otro electrodoméstico.';
        const q={id:uid('q'),activo:true,propietarioId:cid,tipo:fd.get('n_tipo').trim(),marca:fd.get('n_marca').trim(),modelo:fd.get('n_modelo').trim(),serie,fechaCompra:'',notas:''};
        await put('equipos',q);eid=q.id;
      }
      if(ed){
        const o=Object.assign({},ed,{fechaRecepcion:fd.get('fechaRecepcion'),tecnicoId:fd.get('tecnicoId'),falla:fd.get('falla').trim(),esGarantia:gar,empresaId:gar?emp:'',refGarantia:gar?fd.get('refGarantia').trim():''});
        await put('ordenes',o);toast('Orden actualizada.');
      }else{
        const n=Math.max(0,...list('ordenes').map(x=>x.n||0))+1;
        const o={id:uid('o'),n,numero:'OS-'+String(n).padStart(4,'0'),clienteId:cid,equipoId:eid,fechaRecepcion:fd.get('fechaRecepcion'),falla:fd.get('falla').trim(),tecnicoId:fd.get('tecnicoId'),esGarantia:gar,empresaId:gar?emp:'',refGarantia:gar?fd.get('refGarantia').trim():'',estado:'Recibido',diagnostico:'',actividades:[],repuestos:[],manoObra:0,fechaEntrega:'',historial:[{fecha:new Date().toISOString(),estado:'Recibido',nota:'Recepción del equipo'}]};
        await put('ordenes',o);toast('Orden '+o.numero+' creada.');go('ordenes/'+o.id);
      }
    }});
}

function estadoDlg(id){
  const o=S.ordenes[id];const sigs=TRANS[o.estado];
  if(!sigs.length){toast('La orden ya fue entregada.',true);return}
  dialog({title:'Cambiar estado de '+o.numero,body:`<p>Estado actual: ${chip(o.estado)}</p>
    ${fld('Nuevo estado','nuevo',sigs[0],{type:'select',req:true,opts:sigs.map(s=>[s,s])})}
    <div data-fe hidden>${fld('Fecha de entrega','fechaEntrega',today(),{type:'date'})}</div>
    ${fld('Nota (opcional)','nota','',{type:'textarea',rows:2,ph:'Ej.: Falta el compresor, pedido al proveedor'})}
    <p class="hint">Recorrido habitual: Recibido → En diagnóstico → En reparación → Reparado → Listo para entrega → Entregado.</p>`,
    onOpen(d,f){const sy=()=>{$('[data-fe]',d).hidden=f.elements.nuevo.value!=='Entregado'};f.elements.nuevo.addEventListener('change',sy);sy()},
    async onSubmit(fd){
      const cur=clone(S.ordenes[id]),nuevo=fd.get('nuevo'),nota=fd.get('nota').trim();
      if(nuevo==='Entregado'&&!puedeEntregar(cur))return 'Una orden no puede marcarse como Entregada si no ha sido reparada o declarada no reparable.';
      if(['En reparación','Pendiente de repuesto','No reparable'].includes(nuevo)&&cur.estado==='En diagnóstico'&&!cur.diagnostico.trim())return 'Registra el diagnóstico antes de pasar a "'+nuevo+'".';
      if(nuevo==='Reparado'&&!(cur.actividades||[]).length)return 'Registra al menos una actividad de reparación antes de marcar la orden como Reparada.';
      if(['No reparable','Pendiente de repuesto'].includes(nuevo)&&!nota)return nuevo==='No reparable'?'Indica en la nota el motivo por el que no es reparable.':'Indica en la nota qué repuesto se está esperando.';
      cur.estado=nuevo;
      cur.historial=(cur.historial||[]).concat([{fecha:new Date().toISOString(),estado:nuevo,nota}]);
      if(nuevo==='Entregado')cur.fechaEntrega=fd.get('fechaEntrega')||today();
      await put('ordenes',cur);toast('Estado actualizado: '+nuevo+'.');
    }});
}
function diagDlg(id){
  const o=S.ordenes[id];
  dialog({title:'Diagnóstico de '+o.numero,body:fld('Diagnóstico técnico','diagnostico',o.diagnostico,{type:'textarea',rows:6,req:true,ph:'Causa de la falla y qué hace falta para repararla'}),
    async onSubmit(fd){const c=clone(S.ordenes[id]);c.diagnostico=fd.get('diagnostico').trim();await put('ordenes',c);toast('Diagnóstico guardado.')}});
}
function costosDlg(id){
  const o=S.ordenes[id];
  dialog({title:'Costos de '+o.numero,body:fld('Mano de obra','manoObra',o.manoObra||0,{type:'number',min:0,step:'any',req:true,hint:'Los repuestos se suman automáticamente desde la lista de repuestos.'}),
    async onSubmit(fd){const c=clone(S.ordenes[id]);c.manoObra=Number(fd.get('manoObra'))||0;await put('ordenes',c);toast('Costos guardados.')}});
}

/* ================= Acciones ================= */
function toggle(col,id,label){
  const o=clone(S[col][id]);o.activo=o.activo===false;
  put(col,o).then(()=>toast(label+(o.activo?' reactivado.':' desactivado. Su historial se conserva.')));
}
function ejemplo(){
  ejemploAsync().catch(()=>toast('No se pudieron cargar los datos de ejemplo.',true));
}
async function ejemploAsync(){
  const mk=(p,o)=>Object.assign({id:uid(p),activo:true},o);
  const e1=mk('e',{nombre:'Almacén Hogar Centro',nit:'900.123.456-7',contacto:'Marcela Ríos',telefono:'300 111 2233',email:'garantias@hogarcentro.example',condiciones:'Garantía de 12 meses por defectos de fábrica, con factura de compra. No cubre golpes ni mal uso.'});
  const e2=mk('e',{nombre:'Electro Express S.A.S.',nit:'901.555.777-1',contacto:'Julián Peña',telefono:'310 222 4455',email:'',condiciones:'Garantía de 6 meses en línea blanca.'});
  const t1=mk('t',{nombre:'Carlos Mejía',especialidad:'Refrigeración',telefono:'311 000 1111'});
  const t2=mk('t',{nombre:'Luisa Fernanda Ortiz',especialidad:'Lavadoras y secadoras',telefono:'312 000 2222'});
  const t3=mk('t',{nombre:'Andrés Vargas',especialidad:'Electrónica y pequeños electrodomésticos',telefono:'313 000 3333'});
  const c1=mk('c',{tipo:'particular',nombre:'Patricia Torres',documento:'52.123.456',telefono:'320 555 0101',email:'',direccion:'Cra. 12 # 34-56',empresaId:'',refRemision:''});
  const c2=mk('c',{tipo:'particular',nombre:'Jorge Herrera',documento:'79.654.321',telefono:'320 555 0202',email:'jorge@example.com',direccion:'',empresaId:'',refRemision:''});
  const c3=mk('c',{tipo:'corporativo',nombre:'Sandra Milena Gómez',documento:'1.020.304.050',telefono:'320 555 0303',email:'',direccion:'Calle 8 # 20-15',empresaId:e1.id,refRemision:'REM-2231'});
  const c4=mk('c',{tipo:'corporativo',nombre:'Ricardo Salcedo',documento:'80.111.222',telefono:'320 555 0404',email:'',direccion:'',empresaId:e2.id,refRemision:'FAC-9087'});
  const q=(p,o)=>mk('q',Object.assign({fechaCompra:'',notas:''},o,{propietarioId:p.id}));
  const q1=q(c1,{tipo:'Lavadora',marca:'LG',modelo:'WM3400',serie:'LG-8841203'});
  const q2=q(c2,{tipo:'Horno microondas',marca:'Panasonic',modelo:'NN-ST34'});
  const q3=q(c3,{tipo:'Nevera',marca:'Samsung',modelo:'RT38K',serie:'SM-RT-55120',fechaCompra:dateAgo(200)});
  const q4=q(c3,{tipo:'Estufa',marca:'Haceb',modelo:'Cuarzo 4Q',serie:'HB-77102',fechaCompra:dateAgo(150)});
  const q5=q(c1,{tipo:'Licuadora',marca:'Oster',modelo:'BLSTKAG'});
  const q6=q(c4,{tipo:'Aire acondicionado',marca:'Midea',modelo:'MSAF-12',serie:'MD-3390127',fechaCompra:dateAgo(300)});
  let n=0;
  const ord=(cl,eq,tec,dias,falla,extra,hist)=>{
    n++;const last=hist[hist.length-1][0];
    return Object.assign({id:uid('o'),n,numero:'OS-'+String(n).padStart(4,'0'),clienteId:cl.id,equipoId:eq.id,tecnicoId:tec.id,fechaRecepcion:dateAgo(dias),falla,esGarantia:false,empresaId:'',refGarantia:'',estado:last,diagnostico:'',actividades:[],repuestos:[],manoObra:0,fechaEntrega:last==='Entregado'?dateAgo(hist[hist.length-1][1]):'',historial:hist.map(h=>({fecha:isoAgo(h[1]),estado:h[0],nota:h[2]||''}))},extra);
  };
  const O=[
    ord(c3,q3,t1,240,'No enfría en el compartimento inferior.',{esGarantia:true,empresaId:e1.id,refGarantia:'REM-1980',diagnostico:'Sensor de temperatura defectuoso.',actividades:[{fecha:dateAgo(236),texto:'Reemplazo del sensor de temperatura'},{fecha:dateAgo(236),texto:'Prueba de enfriamiento por 24 horas'}],repuestos:[{nombre:'Sensor de temperatura',cant:1,costo:48000}],manoObra:60000},[['Recibido',240,'Recepción del equipo'],['En diagnóstico',239],['En reparación',238],['Reparado',236],['Listo para entrega',235],['Entregado',234]]),
    ord(c4,q6,t3,40,'Enciende pero no enfría.',{esGarantia:true,empresaId:e2.id,refGarantia:'FAC-9087',diagnostico:'Fuga de gas en la unidad interna; el costo supera el valor del equipo.'},[['Recibido',40],['En diagnóstico',38],['No reparable',36,'La fuga está en el evaporador y no hay repuesto disponible.']]),
    ord(c1,q5,t3,12,'El motor hace ruido y no gira.',{diagnostico:'Rodamiento y acople del motor desgastados.',actividades:[{fecha:dateAgo(9),texto:'Cambio del acople y limpieza del motor'}],repuestos:[{nombre:'Acople de motor',cant:1,costo:15000}],manoObra:25000},[['Recibido',12],['En diagnóstico',11],['En reparación',10],['Reparado',9]]),
    ord(c1,q1,t2,8,'Se queda llena de agua y no centrifuga.',{diagnostico:'Bomba de desagüe obstruida y correa floja.',actividades:[{fecha:dateAgo(5),texto:'Limpieza de la bomba de desagüe'}],manoObra:30000},[['Recibido',8],['En diagnóstico',7],['En reparación',5]]),
    ord(c2,q2,t3,6,'No calienta la comida.',{diagnostico:'Magnetrón quemado.',repuestos:[],manoObra:0},[['Recibido',6],['En diagnóstico',5],['Pendiente de repuesto',3,'Esperando el magnetrón del proveedor.']]),
    ord(c3,q4,t1,10,'La hornilla trasera no enciende.',{esGarantia:true,empresaId:e1.id,refGarantia:'REM-2231',diagnostico:'Válvula de gas defectuosa.',actividades:[{fecha:dateAgo(4),texto:'Cambio de válvula y prueba de encendido'}],repuestos:[{nombre:'Válvula de gas',cant:1,costo:32000}],manoObra:40000},[['Recibido',10],['En diagnóstico',9],['En reparación',7],['Reparado',4],['Listo para entrega',3]]),
    ord(c3,q3,t1,2,'Hace ruido fuerte en el compresor.',{esGarantia:true,empresaId:e1.id,refGarantia:'REM-2231'},[['Recibido',2],['En diagnóstico',1]])
  ];
  for(const x of [e1,e2])await put('empresas',x);
  for(const x of [t1,t2,t3])await put('tecnicos',x);
  for(const x of [c1,c2,c3,c4])await put('clientes',x);
  for(const x of [q1,q2,q3,q4,q5,q6])await put('equipos',x);
  for(const x of O)await put('ordenes',x);
  toast('Datos de ejemplo cargados.');
}
const A={
  'nueva-orden':d=>ordenDlg(null,{cli:d.cli,eq:d.eq}),
  'edit-orden':d=>ordenDlg(d.id),
  estado:d=>estadoDlg(d.id),diag:d=>diagDlg(d.id),costos:d=>costosDlg(d.id),
  'del-act':d=>{const o=clone(S.ordenes[d.id]);o.actividades.splice(+d.i,1);put('ordenes',o)},
  'del-rep':d=>{const o=clone(S.ordenes[d.id]);o.repuestos.splice(+d.i,1);put('ordenes',o)},
  'nuevo-cliente':()=>clienteDlg(null),'edit-cliente':d=>clienteDlg(d.id),'toggle-cliente':d=>toggle('clientes',d.id,'Cliente'),
  'nuevo-equipo':d=>equipoDlg(null,{cli:d.cli}),'edit-equipo':d=>equipoDlg(d.id),'toggle-equipo':d=>toggle('equipos',d.id,'Electrodoméstico'),
  'nueva-empresa':()=>empresaDlg(null),'edit-empresa':d=>empresaDlg(d.id),'toggle-empresa':d=>toggle('empresas',d.id,'Empresa'),
  'nuevo-tec':()=>tecnicoDlg(null),'edit-tec':d=>tecnicoDlg(d.id),'toggle-tec':d=>toggle('tecnicos',d.id,'Técnico'),
  'filtro-estado':d=>{Object.assign(F.ord,{q:'',cli:'',tec:'',desde:'',hasta:'',gar:'',est:'s:'+d.est});go('ordenes')},
  'filtro-tec':d=>{Object.assign(F.ord,{q:'',cli:'',est:'',desde:'',hasta:'',gar:'',tec:d.id});go('ordenes')},
  ejemplo
};

/* ================= Enrutado y arranque ================= */
function parseHash(){const h=(location.hash||'').replace(/^#\/?/,'');const p=h.split('/');return {view:V[p[0]]?p[0]:'panel',id:p[1]||null}}
function applyRoute(){const r=parseHash(),k=r.view+'/'+(r.id||'');if(k!==curKey){curKey=k;route=r;render(true);window.scrollTo(0,0)}}
function go(path){const p=path.split('/');route={view:p[0],id:p[1]||null};curKey=p[0]+'/'+(p[1]||'');try{location.hash='#/'+path}catch(e){}render(true);window.scrollTo(0,0)}
window.addEventListener('hashchange',applyRoute);

function render(force){
  const view=$('#view');
  $('#conn').textContent=conn==='compartido'?'Datos compartidos con el equipo':(conn==='local'?'Solo en este navegador':'Conectando…');
  $('#conn').className='conn '+(conn==='compartido'?'on':(conn==='local'?'off':''));
  document.querySelectorAll('#nav a').forEach(a=>{if(a.dataset.v===route.view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  if(!ready){view.innerHTML='<p class="loading">Cargando datos…</p>';return}
  const a=document.activeElement;
  if(!force&&a&&view.contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){pending=true;return}
  pending=false;
  V[route.view](route.id);
}
document.addEventListener('focusout',()=>{if(!pending)return;setTimeout(()=>{const a=document.activeElement;if(!(a&&$('#view').contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))render()},0)});

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');
  if(b&&A[b.dataset.act]){e.preventDefault();A[b.dataset.act](b.dataset);return}
  const g=e.target.closest('[data-go]');
  if(g&&!e.target.closest('a,button,input,select,textarea'))go(g.dataset.go);
});
document.addEventListener('submit',async e=>{
  const f=e.target.closest('form[data-form]');if(!f)return;
  e.preventDefault();
  const o=clone(S.ordenes[f.dataset.id]),fd=new FormData(f);
  if(f.dataset.form==='act'){o.actividades=(o.actividades||[]).concat([{fecha:today(),texto:fd.get('texto').trim()}])}
  else{o.repuestos=(o.repuestos||[]).concat([{nombre:fd.get('nombre').trim(),cant:Math.max(1,Number(fd.get('cant'))||1),costo:Math.max(0,Number(fd.get('costo'))||0)}])}
  await put('ordenes',o);
});

init();
})();