/* ==========================================================================
   Escuela de Líderes - Comunidad Cristiana Agua Viva Surco
   Versión con Supabase: datos compartidos en tiempo real entre dispositivos.
   ========================================================================== */

(function(){
"use strict";

var SESSION_KEY = "edl_aguaviva_session_v1"; // solo guarda la sesión de ESTE dispositivo
var TOTAL_SEMANAS = 9;
var QR_PREFIX = "AGUAVIVA-EDL:";

// ---------------------------------------------------------------------
// Cliente Supabase
// ---------------------------------------------------------------------
var supabase = null;
var configOk = false;

function initSupabaseClient(){
  var cfg = window.EDL_CONFIG || {};
  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY ||
     cfg.SUPABASE_URL.indexOf("YOUR-PROJECT") > -1 || cfg.SUPABASE_ANON_KEY.indexOf("YOUR-ANON") > -1){
    configOk = false;
    return;
  }
  try{
    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    configOk = true;
  }catch(e){
    console.error("Error creando cliente Supabase", e);
    configOk = false;
  }
}

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function uid(prefix){
  return (prefix||"id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}
function escapeHtml(str){
  return String(str==null?"":str).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function normalize(str){
  return String(str||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function fmtDate(iso){
  if(!iso) return "";
  var d = new Date(iso);
  return d.toLocaleDateString("es-PE",{day:"2-digit",month:"2-digit",year:"numeric"}) + " " +
         d.toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"});
}
function toast(msg, kind){
  var el = document.getElementById("toast");
  if(!el) return;
  el.textContent = msg;
  el.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ el.className = "toast"; }, 2600);
}
function $(sel, ctx){ return (ctx||document).querySelector(sel); }

// ---------------------------------------------------------------------
// Estado en memoria (se llena y se refresca desde Supabase)
// ---------------------------------------------------------------------
var db = { usuarios:[], trimestres:[], cursos:[], inscripciones:[], asistencia:[] };

// Mapeo snake_case (Postgres) <-> camelCase (usado por las vistas)
function rowToCurso(r){ return {id:r.id, nombre:r.nombre, trimestreId:r.trimestre_id, monitorDni:r.monitor_dni}; }
function cursoToRow(c){ return {nombre:c.nombre, trimestre_id:c.trimestreId, monitor_dni:c.monitorDni||null}; }
function rowToInscripcion(r){ return {id:r.id, dni:r.dni, cursoId:r.curso_id}; }
function rowToAsistencia(r){
  return {id:r.id, dni:r.dni, cursoId:r.curso_id, semana:r.semana, asistio:r.asistio, devocional:r.devocional, intercesion:r.intercesion, fecha:r.fecha};
}
function asistenciaToRow(a){
  return {dni:a.dni, curso_id:a.cursoId, semana:a.semana, asistio:!!a.asistio, devocional:!!a.devocional, intercesion:!!a.intercesion, fecha:a.fecha||null};
}

async function fetchAll(){
  var res = await Promise.all([
    supabase.from("usuarios").select("*"),
    supabase.from("trimestres").select("*").order("created_at", {ascending:true}),
    supabase.from("cursos").select("*"),
    supabase.from("inscripciones").select("*"),
    supabase.from("asistencia").select("*")
  ]);
  var errores = res.filter(function(r){ return r.error; });
  if(errores.length){
    console.error("Errores cargando datos de Supabase:", errores.map(function(e){return e.error;}));
    return false;
  }
  db.usuarios = res[0].data || [];
  db.trimestres = res[1].data || [];
  db.cursos = (res[2].data || []).map(rowToCurso);
  db.inscripciones = (res[3].data || []).map(rowToInscripcion);
  db.asistencia = (res[4].data || []).map(rowToAsistencia);
  return true;
}

// Ayudantes genéricos de escritura
async function sbInsert(table, row){
  var r = await supabase.from(table).insert(row).select();
  if(r.error){ console.error(r.error); toast("Error guardando en la base de datos.", "err"); throw r.error; }
  return r.data;
}
async function sbUpdate(table, matchObj, patch){
  var q = supabase.from(table).update(patch);
  Object.keys(matchObj).forEach(function(k){ q = q.eq(k, matchObj[k]); });
  var r = await q.select();
  if(r.error){ console.error(r.error); toast("Error actualizando en la base de datos.", "err"); throw r.error; }
  return r.data;
}
async function sbDelete(table, matchObj){
  var q = supabase.from(table).delete();
  Object.keys(matchObj).forEach(function(k){ q = q.eq(k, matchObj[k]); });
  var r = await q;
  if(r.error){ console.error(r.error); toast("Error eliminando en la base de datos.", "err"); throw r.error; }
}
async function sbUpsert(table, row, onConflict){
  var r = await supabase.from(table).upsert(row, {onConflict:onConflict});
  if(r.error){ console.error(r.error); toast("No se pudo sincronizar el último cambio.", "err"); }
  return r.data;
}

// Helpers de consulta (idénticos a la versión local)
function findUsuario(dni){ return db.usuarios.find(function(u){ return u.dni === dni; }); }
function findCurso(id){ return db.cursos.find(function(c){ return c.id === id; }); }
function findTrimestre(id){ return db.trimestres.find(function(t){ return t.id === id; }); }
function cursosDeTrimestre(trimestreId){ return db.cursos.filter(function(c){ return c.trimestreId === trimestreId; }); }
function inscritosDeCurso(cursoId){
  return db.inscripciones.filter(function(i){ return i.cursoId === cursoId; })
    .map(function(i){ return findUsuario(i.dni); }).filter(Boolean);
}
function cursosDeAlumno(dni){
  var ids = db.inscripciones.filter(function(i){ return i.dni === dni; }).map(function(i){ return i.cursoId; });
  return db.cursos.filter(function(c){ return ids.indexOf(c.id) > -1; });
}
function cursosDeMonitor(dni){ return db.cursos.filter(function(c){ return c.monitorDni === dni; }); }
function getAsistencia(dni, cursoId, semana){
  return db.asistencia.find(function(a){ return a.dni===dni && a.cursoId===cursoId && a.semana===semana; });
}
// Actualiza en memoria de inmediato (UI ágil) y sincroniza con Supabase en segundo plano.
function upsertAsistenciaOptimista(dni, cursoId, semana, patch){
  var rec = getAsistencia(dni, cursoId, semana);
  if(!rec){
    rec = {id:uid("asis"), dni:dni, cursoId:cursoId, semana:semana, asistio:false, devocional:false, intercesion:false, fecha:null};
    db.asistencia.push(rec);
  }
  Object.assign(rec, patch);
  sbUpsert("asistencia", asistenciaToRow(rec), "dni,curso_id,semana").catch(function(){});
  return rec;
}
function resetAsistenciaOptimista(dni, cursoId, semana){
  db.asistencia = db.asistencia.filter(function(a){ return !(a.dni===dni && a.cursoId===cursoId && a.semana===semana); });
  sbDelete("asistencia", {dni:dni, curso_id:cursoId, semana:semana}).catch(function(){});
}

// ---------------------------------------------------------------------
// Sesión / autenticación (local a este dispositivo)
// ---------------------------------------------------------------------
var session = { dni: null, vista: null };
function loadSession(){
  try{
    var raw = localStorage.getItem(SESSION_KEY);
    if(raw) session = JSON.parse(raw);
  }catch(e){ session = {dni:null, vista:null}; }
}
function saveSession(){ localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
function clearSession(){ session = {dni:null, vista:null}; localStorage.removeItem(SESSION_KEY); }
function currentUser(){ return session.dni ? findUsuario(session.dni) : null; }

// Una misma persona puede ser monitor de un curso y alumno de otro distinto
// (o viceversa) dentro del mismo trimestre. Esta función calcula qué vistas
// le corresponden según sus datos reales (no solo su rol de creación).
function vistasDisponibles(user){
  if(!user) return [];
  if(user.rol === "admin") return ["admin"];
  var esMonitor = user.rol === "monitor" || db.cursos.some(function(c){ return c.monitorDni === user.dni; });
  var esAlumno = user.rol === "estudiante" || db.inscripciones.some(function(i){ return i.dni === user.dni; });
  var vistas = [];
  if(esMonitor) vistas.push("monitor");
  if(esAlumno) vistas.push("estudiante");
  if(!vistas.length) vistas.push(user.rol === "monitor" ? "monitor" : "estudiante");
  return vistas;
}

function attemptLogin(dni, celular){
  dni = String(dni||"").trim();
  celular = String(celular||"").trim();
  var user = db.usuarios.find(function(u){ return u.dni === dni; });
  if(!user || user.celular !== celular || user.activo === false) return false;
  session.dni = user.dni;
  session.vista = null;
  saveSession();
  return true;
}
function logout(){ clearSession(); stopScanner(); route(); }

// Tras iniciar sesión (o al recargar la página), decide si hay que mostrar
// la app directamente o pedirle a la persona que elija con qué rol entrar.
function resolveVistaAndRoute(){
  var user = currentUser();
  if(!user){ route(); return; }
  var vistas = vistasDisponibles(user);
  if(vistas.length <= 1){
    session.vista = vistas[0] || null;
    saveSession();
    route();
    return;
  }
  if(session.vista && vistas.indexOf(session.vista) > -1){
    route();
  } else {
    showVistaSelector(user, vistas);
  }
}

function showVistaSelector(user, vistas){
  var opciones = vistas.map(function(v){
    return '<button type="button" class="btn-primary vista-option-btn" data-action="choose-vista" data-vista="'+v+'">Ingresar como '+ROLE_LABEL[v].toUpperCase()+'</button>';
  }).join("");

  var screen = document.getElementById("screen-vista-selector");
  screen.innerHTML =
    '<div class="login-wrap">' +
      '<div class="login-badge">'+logoSvg()+'</div>' +
      '<h1 class="login-title">Comunidad Cristiana Agua Viva</h1>' +
      '<p class="login-sub">Hola, '+escapeHtml(user.nombre)+'. Este trimestre participas en más de un rol.<br>¿Cómo deseas ingresar?</p>' +
      '<div class="login-card"><div class="vista-options">'+opciones+'</div></div>' +
    '</div>';
  showScreen("screen-vista-selector");
}

// ---------------------------------------------------------------------
// Código QR - generación
// ---------------------------------------------------------------------
function qrContentForDni(dni){ return QR_PREFIX + dni; }
function renderQrInto(container, dni){
  try{
    var qr = qrcode(0, "M");
    qr.addData(qrContentForDni(dni));
    qr.make();
    container.innerHTML = qr.createSvgTag({cellSize:4, margin:3, scalable:true});
  }catch(e){
    console.error("Error generando QR", e);
    container.innerHTML = "<p>No se pudo generar el código QR.</p>";
  }
}

// ---------------------------------------------------------------------
// Escáner de cámara (jsQR)
// ---------------------------------------------------------------------
var scannerState = { stream:null, raf:null, cooldownDni:null, cooldownUntil:0, cursoId:null, semana:null, modo:"asistencia" };

function startScanner(cursoId, semana, modo){
  scannerState.cursoId = cursoId;
  scannerState.semana = semana;
  scannerState.modo = modo || "asistencia";
  var video = document.getElementById("qr-video");
  var statusEl = document.getElementById("qr-scan-status");
  statusEl.textContent = "Activando cámara...";
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    statusEl.textContent = "Este navegador no permite acceso a la cámara.";
    return;
  }
  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}})
    .then(function(stream){
      scannerState.stream = stream;
      video.srcObject = stream;
      video.setAttribute("playsinline", true);
      video.play();
      statusEl.textContent = "Apunte la cámara al código QR del alumno";
      scanLoop();
    })
    .catch(function(err){
      console.error(err);
      statusEl.textContent = "No se pudo acceder a la cámara: " + (err && err.message ? err.message : "permiso denegado.");
    });
}
function stopScanner(){
  if(scannerState.raf) cancelAnimationFrame(scannerState.raf);
  scannerState.raf = null;
  if(scannerState.stream){
    scannerState.stream.getTracks().forEach(function(t){ t.stop(); });
    scannerState.stream = null;
  }
  var video = document.getElementById("qr-video");
  if(video) video.srcObject = null;
}
function scanLoop(){
  var video = document.getElementById("qr-video");
  var canvas = document.getElementById("qr-canvas");
  if(!video || video.readyState !== video.HAVE_ENOUGH_DATA){
    scannerState.raf = requestAnimationFrame(scanLoop);
    return;
  }
  var ctx = canvas.getContext("2d", {willReadFrequently:true});
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  var code = jsQR(imgData.data, imgData.width, imgData.height, {inversionAttempts:"dontInvert"});
  if(code && code.data) handleScanResult(code.data);
  scannerState.raf = requestAnimationFrame(scanLoop);
}
function handleScanResult(text){
  var statusEl = document.getElementById("qr-scan-status");
  if(text.indexOf(QR_PREFIX) !== 0){ statusEl.textContent = "Código QR no reconocido."; return; }
  var dni = text.slice(QR_PREFIX.length);
  var now = Date.now();
  if(scannerState.cooldownDni === dni && now < scannerState.cooldownUntil) return;
  scannerState.cooldownDni = dni;
  scannerState.cooldownUntil = now + 2500;

  var user = findUsuario(dni);
  var cursoId = scannerState.cursoId, semana = scannerState.semana, modo = scannerState.modo;
  if(!user){
    statusEl.textContent = "DNI " + dni + " no está registrado en el sistema.";
    toast("Alumno no encontrado.", "err");
    return;
  }
  var inscrito = db.inscripciones.some(function(i){ return i.dni===dni && i.cursoId===cursoId; });
  if(!inscrito){
    statusEl.textContent = user.nombre + " " + user.apellido + " no está inscrito en este curso.";
    toast("Alumno no inscrito en el curso seleccionado.", "err");
    return;
  }
  if(modo === "intercesion"){
    upsertAsistenciaOptimista(dni, cursoId, semana, {intercesion:true});
    statusEl.textContent = "\u2713 Intercesión registrada: " + user.nombre + " " + user.apellido;
    toast("Intercesión registrada: " + user.nombre + " " + user.apellido, "ok");
    if(adminIntercesionState.cursoId === cursoId) renderAdminIntercesionTable();
  } else {
    upsertAsistenciaOptimista(dni, cursoId, semana, {asistio:true, fecha:new Date().toISOString()});
    statusEl.textContent = "\u2713 Asistencia registrada: " + user.nombre + " " + user.apellido;
    toast("Asistencia registrada: " + user.nombre + " " + user.apellido, "ok");
    if(monitorViewState.cursoId === cursoId) renderMonitorTable();
  }
}

// ---------------------------------------------------------------------
// Modal genérico
// ---------------------------------------------------------------------
function openModal(html){
  var host = document.getElementById("modal-host");
  host.innerHTML = html;
  host.classList.remove("hidden");
}
function closeModal(){
  stopScanner();
  var host = document.getElementById("modal-host");
  host.innerHTML = "";
  host.classList.add("hidden");
}
function modalShell(title, bodyHtml, footHtml, extraClass){
  return (
    '<div class="modal-overlay" data-action="overlay-close">' +
      '<div class="modal-box ' + (extraClass||"") + '" data-stop>' +
        '<div class="modal-head"><h3>' + escapeHtml(title) + '</h3>' +
          '<button class="modal-close" data-action="close-modal">&times;</button></div>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
        (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') +
      '</div>' +
    '</div>'
  );
}
function openQrScanModal(cursoId, semana, modo){
  var curso = findCurso(cursoId);
  var esInterc = modo === "intercesion";
  var html = modalShell(
    esInterc ? "Escanear QR de intercesión" : "Escanear QR de asistencia",
    '<p style="margin-top:0;color:var(--ink-soft);font-size:.88rem">' +
      escapeHtml(curso ? curso.nombre : "") + ' &middot; Semana ' + semana + '</p>' +
      '<video id="qr-video" autoplay muted></video>' +
      '<canvas id="qr-canvas" class="hidden"></canvas>' +
      '<div class="qr-scan-status" id="qr-scan-status">Preparando cámara...</div>',
    '<button class="btn secondary" data-action="close-modal">Cerrar</button>'
  );
  openModal(html);
  startScanner(cursoId, semana, modo);
}
function openQrShowModal(dni){
  var user = findUsuario(dni);
  var html = modalShell(
    "Mi código QR de asistencia",
    '<div class="qr-display">' +
      '<div id="qr-holder"></div>' +
      '<div class="qr-name">' + escapeHtml(user.nombre + " " + user.apellido) + '</div>' +
      '<div class="qr-dni">DNI: ' + escapeHtml(user.dni) + '</div>' +
      '<p style="text-align:center;color:var(--ink-soft);font-size:.85rem;margin:0">' +
      'Muestre este código al monitor para registrar su asistencia.</p>' +
    '</div>',
    '<button class="btn secondary" data-action="close-modal">Cerrar</button>'
  );
  openModal(html);
  renderQrInto(document.getElementById("qr-holder"), dni);
}

// ---------------------------------------------------------------------
// Encabezado común
// ---------------------------------------------------------------------
function logoSvg(){
  return '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M32 8C22 14 18 24 22 34c2 5 6 8 10 10 4-2 8-5 10-10 4-10 0-20-10-26z" stroke="white" stroke-width="2.4" fill="none"/>' +
    '<path d="M32 18c-5 4-7 10-4 16" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M42 16c2 8-2 16-10 20" stroke="white" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
    '</svg>';
}
function iconCamera(){
  return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12.5" r="3.4" stroke="currentColor" stroke-width="1.6"/></svg>';
}
function iconQr(){
  return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.6"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
}
function iconLogout(){
  return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H9M16 16l4-4-4-4M20 12H9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function iconSwitch(){
  return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 7h11l-3-3M17 17H6l3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

var ROLE_LABEL = {admin:"Administrador", monitor:"Monitor", estudiante:"Alumno"};

function renderHeader(user, vista, vistas){
  vista = vista || user.rol;
  vistas = vistas || [vista];
  var actionBtn = "";
  if(vista === "monitor"){
    actionBtn = '<button class="pill-btn" data-action="open-scan-picker">' + iconCamera() + ' Escanear QR Asistencia</button>';
  } else if(vista === "estudiante"){
    actionBtn = '<button class="pill-btn" data-action="show-my-qr">' + iconQr() + ' Ver Código QR Asistencia</button>';
  }
  var welcome = vista === "estudiante"
    ? '<div class="welcome">Bienvenido, ' + escapeHtml(user.nombre) + '</div>'
    : '<div class="welcome">' + escapeHtml(user.nombre + " " + user.apellido) + '</div>';
  var switchBtn = vistas.length > 1
    ? '<button class="pill-btn ghost" data-action="switch-vista">' + iconSwitch() + ' Cambiar vista</button>'
    : '';
  return (
    '<header class="app-header">' +
      '<div class="htitle">' +
        '<div class="logo-chip">' + logoSvg() + '</div>' +
        '<div>' +
          '<h1>Comunidad Cristiana Agua Viva Surco</h1>' +
          '<div class="sede">Sede: Surco</div>' +
          welcome +
        '</div>' +
      '</div>' +
      '<div class="header-actions">' +
        '<span class="role-badge">' + ROLE_LABEL[vista] + '</span>' +
        actionBtn +
        switchBtn +
        '<button class="pill-btn ghost" data-action="logout">' + iconLogout() + ' Salir</button>' +
      '</div>' +
    '</header>'
  );
}

// ---------------------------------------------------------------------
// VISTA MONITOR
// ---------------------------------------------------------------------
var monitorViewState = { trimestreId:null, cursoId:null, semana:1, q:"" };

function renderMonitorView(user){
  var trimestres = db.trimestres;
  if(!monitorViewState.trimestreId && trimestres.length) monitorViewState.trimestreId = trimestres[0].id;

  var misCursos = cursosDeMonitor(user.dni).filter(function(c){ return c.trimestreId === monitorViewState.trimestreId; });
  if(!misCursos.some(function(c){ return c.id === monitorViewState.cursoId; })){
    monitorViewState.cursoId = misCursos.length ? misCursos[0].id : null;
  }

  var html = '<div class="toolbar">' +
    '<div class="field"><label>Trimestre</label><select id="sel-trimestre">' +
      trimestres.map(function(t){
        return '<option value="'+t.id+'" '+(t.id===monitorViewState.trimestreId?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
      }).join("") +
    '</select></div>';

  if(misCursos.length > 1){
    html += '<div class="field"><label>Curso asignado</label><select id="sel-curso-monitor">' +
      misCursos.map(function(c){
        return '<option value="'+c.id+'" '+(c.id===monitorViewState.cursoId?"selected":"")+'>'+escapeHtml(c.nombre)+'</option>';
      }).join("") +
    '</select></div>';
  }

  html += '<div class="field grow"><label>Buscar alumno</label>' +
    '<input type="text" id="inp-buscar-monitor" placeholder="Nombre o apellido..." value="'+escapeHtml(monitorViewState.q)+'"></div>' +
  '</div>';

  html += '<div id="monitor-content"></div>';

  document.getElementById("app-body").innerHTML = html;

  $("#sel-trimestre").addEventListener("change", function(e){
    monitorViewState.trimestreId = e.target.value;
    monitorViewState.cursoId = null;
    renderMonitorView(user);
  });
  var selCurso = document.getElementById("sel-curso-monitor");
  if(selCurso) selCurso.addEventListener("change", function(e){
    monitorViewState.cursoId = e.target.value;
    renderMonitorTable();
  });
  document.getElementById("inp-buscar-monitor").addEventListener("input", function(e){
    monitorViewState.q = e.target.value;
    renderMonitorTable();
  });

  renderMonitorTable();
}

function renderMonitorTable(){
  var host = document.getElementById("monitor-content");
  if(!host) return;
  var cursoId = monitorViewState.cursoId;
  if(!cursoId){
    host.innerHTML = '<div class="card"><div class="empty"><p>No tiene un curso asignado como monitor en este trimestre.</p></div></div>';
    return;
  }
  var curso = findCurso(cursoId);
  var alumnos = inscritosDeCurso(cursoId).sort(function(a,b){
    return (a.apellido+a.nombre).localeCompare(b.apellido+b.nombre);
  });
  var q = normalize(monitorViewState.q);
  if(q){
    alumnos = alumnos.filter(function(a){ return normalize(a.nombre+" "+a.apellido).indexOf(q) > -1; });
  }
  var semana = monitorViewState.semana;

  var weekTabs = "";
  for(var w=1; w<=TOTAL_SEMANAS; w++){
    var anyDone = inscritosDeCurso(cursoId).some(function(a){ var r=getAsistencia(a.dni,cursoId,w); return r && (r.asistio||r.devocional||r.intercesion); });
    weekTabs += '<button class="week-tab '+(w===semana?"active":"")+' '+(anyDone?"done":"")+'" data-action="set-semana" data-semana="'+w+'">Semana '+w+'</button>';
  }

  var rows = alumnos.map(function(a){
    var r = getAsistencia(a.dni, cursoId, semana) || {asistio:false, devocional:false, intercesion:false, fecha:null};
    return '<tr>' +
      '<td><strong>'+escapeHtml(a.apellido+" "+a.nombre)+'</strong><br><span style="color:var(--ink-soft);font-size:.78rem">DNI '+escapeHtml(a.dni)+'</span></td>' +
      '<td class="chk-cell"><input type="checkbox" class="chk" data-action="toggle" data-dni="'+a.dni+'" data-campo="asistio" '+(r.asistio?"checked":"")+'></td>' +
      '<td class="chk-cell"><input type="checkbox" class="chk" data-action="toggle" data-dni="'+a.dni+'" data-campo="devocional" '+(r.devocional?"checked":"")+'></td>' +
      '<td class="chk-cell"><input type="checkbox" class="chk" data-action="toggle" data-dni="'+a.dni+'" data-campo="intercesion" '+(r.intercesion?"checked":"")+'></td>' +
      '<td style="font-size:.78rem;color:var(--ink-soft)">'+(r.fecha?fmtDate(r.fecha):'&mdash;')+'</td>' +
      '<td><button class="btn small danger" data-action="reset-semana" data-dni="'+a.dni+'">Restablecer</button></td>' +
    '</tr>';
  }).join("");

  var totalInscritos = inscritosDeCurso(cursoId).length;
  var presentesSemana = inscritosDeCurso(cursoId).filter(function(a){ var r=getAsistencia(a.dni,cursoId,semana); return r && r.asistio; }).length;

  host.innerHTML =
    '<div class="card">' +
      '<h2>'+escapeHtml(curso.nombre)+'</h2>' +
      '<div class="stat-row">' +
        '<div class="stat"><div class="num">'+totalInscritos+'</div><div class="lbl">Inscritos</div></div>' +
        '<div class="stat"><div class="num">'+presentesSemana+'</div><div class="lbl">Presentes semana '+semana+'</div></div>' +
      '</div>' +
      '<div class="week-tabs">'+weekTabs+'</div>' +
      (alumnos.length ?
        '<div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Asistencia</th><th>Devocional</th><th>Intercesión</th><th>Registrado</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
        : '<div class="empty"><p>No se encontraron alumnos inscritos'+(q?" con ese criterio":"")+'.</p></div>') +
    '</div>';
}

// ---------------------------------------------------------------------
// VISTA ALUMNO
// ---------------------------------------------------------------------
var alumnoViewState = { trimestreId:null, cursoId:null };

function renderAlumnoView(user){
  var trimestres = db.trimestres;
  if(!alumnoViewState.trimestreId && trimestres.length) alumnoViewState.trimestreId = trimestres[0].id;

  var misCursos = cursosDeAlumno(user.dni).filter(function(c){ return c.trimestreId === alumnoViewState.trimestreId; });
  if(!misCursos.some(function(c){ return c.id === alumnoViewState.cursoId; })){
    alumnoViewState.cursoId = misCursos.length ? misCursos[0].id : null;
  }

  var html = '<div class="toolbar">' +
    '<div class="field"><label>Trimestre</label><select id="sel-trimestre-al">' +
      trimestres.map(function(t){
        return '<option value="'+t.id+'" '+(t.id===alumnoViewState.trimestreId?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
      }).join("") +
    '</select></div>';
  if(misCursos.length > 1){
    html += '<div class="field"><label>Curso</label><select id="sel-curso-al">' +
      misCursos.map(function(c){
        return '<option value="'+c.id+'" '+(c.id===alumnoViewState.cursoId?"selected":"")+'>'+escapeHtml(c.nombre)+'</option>';
      }).join("") +
    '</select></div>';
  }
  html += '</div><div id="alumno-content"></div>';

  document.getElementById("app-body").innerHTML = html;

  $("#sel-trimestre-al").addEventListener("change", function(e){
    alumnoViewState.trimestreId = e.target.value;
    alumnoViewState.cursoId = null;
    renderAlumnoView(user);
  });
  var selCurso = document.getElementById("sel-curso-al");
  if(selCurso) selCurso.addEventListener("change", function(e){
    alumnoViewState.cursoId = e.target.value;
    renderAlumnoContent(user);
  });

  renderAlumnoContent(user);
}

function renderAlumnoContent(user){
  var host = document.getElementById("alumno-content");
  var cursoId = alumnoViewState.cursoId;
  if(!cursoId){
    host.innerHTML = '<div class="card"><div class="empty"><p>No está inscrito en ningún curso durante este trimestre.</p></div></div>';
    return;
  }
  var curso = findCurso(cursoId);
  var monitor = findUsuario(curso.monitorDni);

  var semanasAsis=0, semanasDevo=0, semanasInter=0;
  var rowsHtml = "";
  for(var w=1; w<=TOTAL_SEMANAS; w++){
    var r = getAsistencia(user.dni, cursoId, w);
    var asis = r ? r.asistio : false;
    var devo = r ? r.devocional : false;
    var inter = r ? r.intercesion : false;
    if(asis) semanasAsis++;
    if(devo) semanasDevo++;
    if(inter) semanasInter++;
    rowsHtml += '<tr>' +
      '<td><strong>Semana '+w+'</strong></td>' +
      '<td>'+badge(asis)+'</td>' +
      '<td>'+badge(devo)+'</td>' +
      '<td>'+badge(inter)+'</td>' +
      '<td style="font-size:.78rem;color:var(--ink-soft)">'+(r&&r.fecha?fmtDate(r.fecha):'&mdash;')+'</td>' +
    '</tr>';
  }
  function badge(v){ return v ? '<span class="badge-ok">Sí</span>' : '<span class="badge-warn">Pendiente</span>'; }
  function pct(n){ return Math.round((n/TOTAL_SEMANAS)*100); }

  host.innerHTML =
    '<div class="card">' +
      '<h2>'+escapeHtml(curso.nombre)+'</h2>' +
      '<p style="margin-top:-6px;color:var(--ink-soft);font-size:.88rem">Monitor: '+escapeHtml(monitor?monitor.nombre+" "+monitor.apellido:"—")+'</p>' +
      '<div class="stat-row">' +
        '<div class="stat"><div class="num">'+semanasAsis+'/'+TOTAL_SEMANAS+'</div><div class="lbl">Asistencia</div></div>' +
        '<div class="stat"><div class="num">'+semanasDevo+'/'+TOTAL_SEMANAS+'</div><div class="lbl">Devocional</div></div>' +
        '<div class="stat"><div class="num">'+semanasInter+'/'+TOTAL_SEMANAS+'</div><div class="lbl">Intercesión</div></div>' +
      '</div>' +
      progressRow("Asistencia global", pct(semanasAsis)) +
      progressRow("Devocional global", pct(semanasDevo)) +
      progressRow("Intercesión global", pct(semanasInter)) +
    '</div>' +
    '<div class="card">' +
      '<h3>Avance semana a semana</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Semana</th><th>Asistencia</th><th>Devocional</th><th>Intercesión</th><th>Registrado</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div>' +
    '</div>';

  function progressRow(label, p){
    return '<div style="margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;font-size:.82rem;color:var(--ink-soft);margin-bottom:5px"><span>'+label+'</span><span>'+p+'%</span></div>' +
      '<div class="progress-bar"><div style="width:'+p+'%"></div></div>' +
    '</div>';
  }
}

// ---------------------------------------------------------------------
// VISTA ADMINISTRADOR
// ---------------------------------------------------------------------
var adminViewState = {
  tab:"cursos",
  filtroCursosTrimestre:"",
  filtroAlumnosTrimestre:"",
  filtroAlumnosCurso:"",
  filtroMonitoresTrimestre:"",
  masivoInscTrimestre:""
};
var adminIntercesionState = { trimestreId:null, cursoId:null, semana:1, q:"" };

function countLabel(n, singular, plural){ return n + " " + (n===1?singular:plural); }

function renderAdminView(user){
  var tabs = [
    ["cursos","Cursos"],
    ["alumnos","Alumnos"],
    ["monitores","Monitores"],
    ["trimestres","Trimestres"],
    ["intercesion","Intercesión"],
    ["masivo","Carga masiva"]
  ];
  var html = '<div class="tabs-nav">' + tabs.map(function(t){
    return '<button class="tab-btn '+(adminViewState.tab===t[0]?"active":"")+'" data-action="admin-tab" data-tab="'+t[0]+'">'+t[1]+'</button>';
  }).join("") + '</div><div id="admin-content"></div>';
  document.getElementById("app-body").innerHTML = html;
  renderAdminTab();
}

function renderAdminTab(){
  var host = document.getElementById("admin-content");
  switch(adminViewState.tab){
    case "cursos": return renderAdminCursos(host);
    case "alumnos": return renderAdminPersonas(host, "estudiante");
    case "monitores": return renderAdminPersonas(host, "monitor");
    case "trimestres": return renderAdminTrimestres(host);
    case "intercesion": return renderAdminIntercesion(host);
    case "masivo": return renderAdminMasivo(host);
  }
}

function renderAdminCursos(host){
  var filtroTrimestre = adminViewState.filtroCursosTrimestre;
  var cursosFiltrados = db.cursos.filter(function(c){
    return !filtroTrimestre || c.trimestreId === filtroTrimestre;
  });

  var rows = cursosFiltrados.map(function(c){
    var t = findTrimestre(c.trimestreId);
    var m = findUsuario(c.monitorDni);
    var n = inscritosDeCurso(c.id).length;
    return '<tr>' +
      '<td><strong>'+escapeHtml(c.nombre)+'</strong></td>' +
      '<td>'+escapeHtml(t?t.nombre:"—")+'</td>' +
      '<td>'+escapeHtml(m?m.nombre+" "+m.apellido:"Sin asignar")+'</td>' +
      '<td>'+n+'</td>' +
      '<td class="btn-row">' +
        '<button class="btn small secondary" data-action="edit-curso" data-id="'+c.id+'">Editar</button>' +
        '<button class="btn small danger" data-action="del-curso" data-id="'+c.id+'">Eliminar</button>' +
      '</td>' +
    '</tr>';
  }).join("");

  var opcionesTrimestre = '<option value="">Todos los trimestres</option>' + db.trimestres.map(function(t){
    return '<option value="'+t.id+'" '+(t.id===filtroTrimestre?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
  }).join("");

  host.innerHTML =
    '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
        '<h2 style="margin:0">Cursos <span class="badge-muted">'+countLabel(cursosFiltrados.length,"curso","cursos")+'</span></h2>' +
      '</div>' +
      '<div class="toolbar" style="margin-top:14px;margin-bottom:0;justify-content:space-between">' +
        '<div class="field"><label>Trimestre</label><select id="filtro-cursos-trimestre">'+opcionesTrimestre+'</select></div>' +
        '<button class="btn" data-action="new-curso">+ Nuevo curso</button>' +
      '</div>' +
      (cursosFiltrados.length ?
        '<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Curso</th><th>Trimestre</th><th>Monitor</th><th>Inscritos</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
        : '<div class="empty"><p>No hay cursos para este filtro.</p></div>') +
    '</div>';

  $("#filtro-cursos-trimestre").addEventListener("change", function(e){
    adminViewState.filtroCursosTrimestre = e.target.value;
    renderAdminTab();
  });
}

function renderAdminPersonas(host, rol){
  var titulo = rol==="estudiante" ? "Alumnos" : "Monitores";
  var esAlumno = rol==="estudiante";
  var filtroTrimestre = esAlumno ? adminViewState.filtroAlumnosTrimestre : adminViewState.filtroMonitoresTrimestre;
  var filtroCurso = esAlumno ? adminViewState.filtroAlumnosCurso : "";

  var cursosParaFiltro = filtroTrimestre ? cursosDeTrimestre(filtroTrimestre) : db.cursos;
  // Si el curso elegido ya no pertenece al trimestre filtrado, se descarta.
  if(esAlumno && filtroCurso && !cursosParaFiltro.some(function(c){ return c.id===filtroCurso; })){
    filtroCurso = "";
    adminViewState.filtroAlumnosCurso = "";
  }

  // Una persona aparece en esta lista si su rol base coincide, O si además de su rol
  // base tiene inscripciones (como alumno) o cursos asignados (como monitor) — esto
  // cubre el caso de alguien que es monitor de un curso y alumno de otro distinto.
  var lista = db.usuarios.filter(function(u){
    if(u.rol === "admin") return false;
    var tieneRolBase = u.rol === rol;
    var tieneCapacidad = esAlumno ? cursosDeAlumno(u.dni).length > 0 : cursosDeMonitor(u.dni).length > 0;
    return tieneRolBase || tieneCapacidad;
  }).filter(function(u){
    var cursosPersona = esAlumno ? cursosDeAlumno(u.dni) : cursosDeMonitor(u.dni);
    if(filtroCurso) return cursosPersona.some(function(c){ return c.id===filtroCurso; });
    if(filtroTrimestre) return cursosPersona.some(function(c){ return c.trimestreId===filtroTrimestre; });
    return true;
  }).sort(function(a,b){ return (a.apellido+a.nombre).localeCompare(b.apellido+b.nombre); });

  var rows = lista.map(function(u){
    var cursos = esAlumno ? cursosDeAlumno(u.dni) : cursosDeMonitor(u.dni);
    var cursosTxt = cursos.map(function(c){ return escapeHtml(c.nombre); }).join(", ") || "—";
    var otroRol = esAlumno ? (cursosDeMonitor(u.dni).length>0) : (cursosDeAlumno(u.dni).length>0);
    var badgeDual = otroRol ? ' <span class="badge-muted">también '+(esAlumno?"monitor":"alumno")+'</span>' : '';
    return '<tr>' +
      '<td><strong>'+escapeHtml(u.apellido+" "+u.nombre)+'</strong>'+badgeDual+'</td>' +
      '<td>'+escapeHtml(u.dni)+'</td>' +
      '<td>'+escapeHtml(u.celular)+'</td>' +
      '<td style="font-size:.82rem">'+cursosTxt+'</td>' +
      '<td class="btn-row">' +
        '<button class="btn small secondary" data-action="edit-persona" data-dni="'+u.dni+'" data-rol="'+rol+'">Editar</button>' +
        '<button class="btn small ghost" data-action="inscribir-persona" data-dni="'+u.dni+'">Inscribir</button>' +
        '<button class="btn small danger" data-action="del-persona" data-dni="'+u.dni+'">Eliminar</button>' +
      '</td>' +
    '</tr>';
  }).join("");

  var opcionesTrimestre = '<option value="">Todos los trimestres</option>' + db.trimestres.map(function(t){
    return '<option value="'+t.id+'" '+(t.id===filtroTrimestre?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
  }).join("");
  var opcionesCurso = '<option value="">Todos los cursos</option>' + cursosParaFiltro.map(function(c){
    return '<option value="'+c.id+'" '+(c.id===filtroCurso?"selected":"")+'>'+escapeHtml(c.nombre)+'</option>';
  }).join("");

  var filtrosHtml = '<div style="display:flex;gap:14px;flex-wrap:wrap">' +
    '<div class="field"><label>Trimestre</label><select id="filtro-personas-trimestre">'+opcionesTrimestre+'</select></div>' +
    (esAlumno ? '<div class="field"><label>Curso</label><select id="filtro-personas-curso">'+opcionesCurso+'</select></div>' : '') +
  '</div>';

  host.innerHTML =
    '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
        '<h2 style="margin:0">'+titulo+' <span class="badge-muted">'+countLabel(lista.length, esAlumno?"alumno":"monitor", esAlumno?"alumnos":"monitores")+'</span></h2>' +
      '</div>' +
      '<div class="toolbar" style="margin-top:14px;margin-bottom:0;justify-content:space-between">' +
        filtrosHtml +
        '<button class="btn" data-action="new-persona" data-rol="'+rol+'">+ Nuevo '+(esAlumno?"alumno":"monitor")+'</button>' +
      '</div>' +
      (lista.length ?
        '<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Nombre</th><th>DNI (usuario)</th><th>Celular (clave)</th><th>Cursos</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
        : '<div class="empty"><p>No hay '+(esAlumno?"alumnos":"monitores")+' para este filtro.</p></div>') +
    '</div>';

  $("#filtro-personas-trimestre").addEventListener("change", function(e){
    if(esAlumno){
      adminViewState.filtroAlumnosTrimestre = e.target.value;
      adminViewState.filtroAlumnosCurso = "";
    } else {
      adminViewState.filtroMonitoresTrimestre = e.target.value;
    }
    renderAdminTab();
  });
  var selCurso = document.getElementById("filtro-personas-curso");
  if(selCurso) selCurso.addEventListener("change", function(e){
    adminViewState.filtroAlumnosCurso = e.target.value;
    renderAdminTab();
  });
}

function renderAdminTrimestres(host){
  var rows = db.trimestres.map(function(t){
    var n = cursosDeTrimestre(t.id).length;
    return '<tr><td><strong>'+escapeHtml(t.nombre)+'</strong></td><td>'+n+'</td>' +
      '<td class="btn-row"><button class="btn small danger" data-action="del-trimestre" data-id="'+t.id+'">Eliminar</button></td></tr>';
  }).join("");
  host.innerHTML =
    '<div class="card">' +
      '<h2>Nuevo trimestre</h2>' +
      '<div class="toolbar" style="margin-bottom:0">' +
        '<div class="field grow"><label>Nombre del trimestre</label><input type="text" id="inp-nuevo-trimestre" placeholder="Ej. 2027 - I Trimestre"></div>' +
        '<button class="btn" data-action="add-trimestre">Agregar</button>' +
      '</div>' +
    '</div>' +
    '<div class="card">' +
      '<h2>Trimestres</h2>' +
      (db.trimestres.length ?
        '<div class="table-wrap"><table><thead><tr><th>Trimestre</th><th>Cursos</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
        : '<div class="empty"><p>No hay trimestres registrados.</p></div>') +
    '</div>';
}

function renderAdminIntercesion(host){
  var trimestres = db.trimestres;
  if(!adminIntercesionState.trimestreId && trimestres.length) adminIntercesionState.trimestreId = trimestres[0].id;

  var cursosTrim = cursosDeTrimestre(adminIntercesionState.trimestreId);
  if(!cursosTrim.some(function(c){ return c.id === adminIntercesionState.cursoId; })){
    adminIntercesionState.cursoId = cursosTrim.length ? cursosTrim[0].id : null;
  }

  var opcionesTrimestre = trimestres.map(function(t){
    return '<option value="'+t.id+'" '+(t.id===adminIntercesionState.trimestreId?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
  }).join("");
  var opcionesCurso = cursosTrim.map(function(c){
    return '<option value="'+c.id+'" '+(c.id===adminIntercesionState.cursoId?"selected":"")+'>'+escapeHtml(c.nombre)+'</option>';
  }).join("");

  host.innerHTML =
    '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
        '<h2 style="margin:0">Intercesión</h2>' +
        '<button class="btn" data-action="open-scan-picker-intercesion">Escanear QR Intercesión</button>' +
      '</div>' +
      '<div class="toolbar" style="margin-top:14px">' +
        '<div class="field"><label>Trimestre</label><select id="ic-trimestre">'+opcionesTrimestre+'</select></div>' +
        (cursosTrim.length ? '<div class="field"><label>Curso</label><select id="ic-curso">'+opcionesCurso+'</select></div>' : '') +
        '<div class="field grow"><label>Buscar alumno</label><input type="text" id="ic-buscar" placeholder="Nombre o apellido..." value="'+escapeHtml(adminIntercesionState.q)+'"></div>' +
      '</div>' +
      '<div id="ic-content"></div>' +
    '</div>';

  $("#ic-trimestre").addEventListener("change", function(e){
    adminIntercesionState.trimestreId = e.target.value;
    adminIntercesionState.cursoId = null;
    renderAdminTab();
  });
  var selCurso = document.getElementById("ic-curso");
  if(selCurso) selCurso.addEventListener("change", function(e){
    adminIntercesionState.cursoId = e.target.value;
    renderAdminIntercesionTable();
  });
  document.getElementById("ic-buscar").addEventListener("input", function(e){
    adminIntercesionState.q = e.target.value;
    renderAdminIntercesionTable();
  });

  renderAdminIntercesionTable();
}

function renderAdminIntercesionTable(){
  var host = document.getElementById("ic-content");
  if(!host) return;
  var cursoId = adminIntercesionState.cursoId;
  if(!cursoId){
    host.innerHTML = '<div class="empty"><p>No hay cursos en el trimestre seleccionado.</p></div>';
    return;
  }
  var alumnos = inscritosDeCurso(cursoId).sort(function(a,b){
    return (a.apellido+a.nombre).localeCompare(b.apellido+b.nombre);
  });
  var q = normalize(adminIntercesionState.q);
  if(q){
    alumnos = alumnos.filter(function(a){ return normalize(a.nombre+" "+a.apellido).indexOf(q) > -1; });
  }
  var semana = adminIntercesionState.semana;

  var weekTabs = "";
  for(var w=1; w<=TOTAL_SEMANAS; w++){
    var anyDone = inscritosDeCurso(cursoId).some(function(a){ var r=getAsistencia(a.dni,cursoId,w); return r && r.intercesion; });
    weekTabs += '<button class="week-tab '+(w===semana?"active":"")+' '+(anyDone?"done":"")+'" data-action="set-semana-ic" data-semana="'+w+'">Semana '+w+'</button>';
  }

  var rows = alumnos.map(function(a){
    var r = getAsistencia(a.dni, cursoId, semana) || {intercesion:false, fecha:null};
    return '<tr>' +
      '<td><strong>'+escapeHtml(a.apellido+" "+a.nombre)+'</strong><br><span style="color:var(--ink-soft);font-size:.78rem">DNI '+escapeHtml(a.dni)+'</span></td>' +
      '<td class="chk-cell"><input type="checkbox" class="chk" data-action="toggle-interc" data-dni="'+a.dni+'" '+(r.intercesion?"checked":"")+'></td>' +
      '<td><button class="btn small danger" data-action="reset-semana-interc" data-dni="'+a.dni+'">Restablecer</button></td>' +
    '</tr>';
  }).join("");

  var totalInscritos = inscritosDeCurso(cursoId).length;
  var totalInterc = inscritosDeCurso(cursoId).filter(function(a){ var r=getAsistencia(a.dni,cursoId,semana); return r && r.intercesion; }).length;

  host.innerHTML =
    '<div class="stat-row">' +
      '<div class="stat"><div class="num">'+totalInscritos+'</div><div class="lbl">Inscritos</div></div>' +
      '<div class="stat"><div class="num">'+totalInterc+'</div><div class="lbl">Con intercesión semana '+semana+'</div></div>' +
    '</div>' +
    '<div class="week-tabs">'+weekTabs+'</div>' +
    (alumnos.length ?
      '<div class="table-wrap"><table><thead><tr><th>Alumno</th><th>Intercesión</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      : '<div class="empty"><p>No se encontraron alumnos inscritos'+(q?" con ese criterio":"")+'.</p></div>');
}

function renderAdminMasivo(host){
  var opcionesTrimestres = db.trimestres.map(function(t){
    return '<option value="'+t.id+'">'+escapeHtml(t.nombre)+'</option>';
  }).join("");
  var opcionesMonitores = '<option value="">Sin asignar</option>' + db.usuarios.filter(function(u){return u.rol!=="admin";}).sort(function(a,b){ return (a.apellido+a.nombre).localeCompare(b.apellido+b.nombre); }).map(function(m){
    return '<option value="'+m.dni+'">'+escapeHtml(m.nombre+" "+m.apellido)+'</option>';
  }).join("");

  var filtroInscTrimestre = adminViewState.masivoInscTrimestre;
  var cursosInsc = filtroInscTrimestre ? cursosDeTrimestre(filtroInscTrimestre) : db.cursos;
  var opcionesTrimestresInsc = '<option value="">Todos los trimestres</option>' + db.trimestres.map(function(t){
    return '<option value="'+t.id+'" '+(t.id===filtroInscTrimestre?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
  }).join("");
  var opcionesCursosInsc = cursosInsc.map(function(c){
    var t = findTrimestre(c.trimestreId);
    return '<option value="'+c.id+'">'+escapeHtml(c.nombre + " — " + (t?t.nombre:""))+'</option>';
  }).join("");

  host.innerHTML =
    '<div class="card">' +
      '<h2>Creación masiva de cursos</h2>' +
      '<p class="hint-text">Un nombre de curso por línea. Se crearán todos en el trimestre y con el monitor seleccionados.</p>' +
      '<div class="toolbar">' +
        '<div class="field"><label>Trimestre</label><select id="sel-masivo-trimestre">'+opcionesTrimestres+'</select></div>' +
        '<div class="field"><label>Monitor (opcional)</label><select id="sel-masivo-monitor">'+opcionesMonitores+'</select></div>' +
      '</div>' +
      '<textarea class="bulk" id="txt-masivo-cursos" placeholder="Fundamentos de Liderazgo\nDiscipulado Avanzado\nServicio y Adoración"></textarea>' +
      '<div style="margin-top:12px"><button class="btn" data-action="masivo-cursos">Crear cursos</button></div>' +
    '</div>' +
    '<div class="card">' +
      '<h2>Inscripción masiva de alumnos</h2>' +
      '<p class="hint-text">Formato por línea: <code>DNI,Nombre,Apellido,Celular</code>. Si el DNI ya existe, solo se actualizan sus datos y se inscribe al curso. La clave de ingreso será el número de celular.</p>' +
      (db.cursos.length ?
        '<div class="toolbar" style="margin-bottom:14px">' +
          '<div class="field"><label>Trimestre</label><select id="filtro-masivo-insc-trimestre">'+opcionesTrimestresInsc+'</select></div>' +
          '<div class="field"><label>Curso destino</label><select id="sel-masivo-curso">'+opcionesCursosInsc+'</select></div>' +
        '</div>'
        : '<p class="hint-text" style="color:var(--warn)">Debe crear al menos un curso antes de inscribir alumnos.</p>') +
      '<textarea class="bulk" id="txt-masivo-alumnos" placeholder="30000005,Carla,Rios,977000005\n30000006,Jose,Diaz,977000006"></textarea>' +
      '<div style="margin-top:12px"><button class="btn" data-action="masivo-alumnos" '+(db.cursos.length && cursosInsc.length ?"":"disabled")+'>Inscribir alumnos</button></div>' +
      (db.cursos.length && !cursosInsc.length ? '<p class="hint-text" style="color:var(--warn)">No hay cursos en el trimestre elegido.</p>' : '') +
    '</div>';

  var selFiltroTrim = document.getElementById("filtro-masivo-insc-trimestre");
  if(selFiltroTrim) selFiltroTrim.addEventListener("change", function(e){
    adminViewState.masivoInscTrimestre = e.target.value;
    renderAdminTab();
  });
}

// ---- Modales de administración ----
function openCursoModal(cursoId){
  var curso = cursoId ? findCurso(cursoId) : null;
  var opcionesTrimestres = db.trimestres.map(function(t){
    return '<option value="'+t.id+'" '+(curso&&curso.trimestreId===t.id?"selected":"")+'>'+escapeHtml(t.nombre)+'</option>';
  }).join("");
  var opcionesMonitores = '<option value="">Sin asignar</option>' + db.usuarios.filter(function(u){return u.rol!=="admin";}).sort(function(a,b){ return (a.apellido+a.nombre).localeCompare(b.apellido+b.nombre); }).map(function(m){
    return '<option value="'+m.dni+'" '+(curso&&curso.monitorDni===m.dni?"selected":"")+'>'+escapeHtml(m.nombre+" "+m.apellido)+'</option>';
  }).join("");
  var html = modalShell(
    curso ? "Editar curso" : "Nuevo curso",
    '<div class="field" style="margin-bottom:14px"><label>Nombre del curso</label><input type="text" id="f-curso-nombre" value="'+escapeHtml(curso?curso.nombre:"")+'"></div>' +
    '<div class="field" style="margin-bottom:14px"><label>Trimestre</label><select id="f-curso-trimestre">'+opcionesTrimestres+'</select></div>' +
    '<div class="field"><label>Monitor asignado</label><select id="f-curso-monitor">'+opcionesMonitores+'</select></div>',
    '<button class="btn secondary" data-action="close-modal">Cancelar</button>' +
    '<button class="btn" data-action="save-curso" data-id="'+(curso?curso.id:"")+'">Guardar</button>'
  );
  openModal(html);
}
function openPersonaModal(dni, rol){
  var persona = dni ? findUsuario(dni) : null;
  var html = modalShell(
    persona ? "Editar " + (rol==="estudiante"?"alumno":"monitor") : "Nuevo " + (rol==="estudiante"?"alumno":"monitor"),
    '<div class="field" style="margin-bottom:14px"><label>Nombres</label><input type="text" id="f-p-nombre" value="'+escapeHtml(persona?persona.nombre:"")+'"></div>' +
    '<div class="field" style="margin-bottom:14px"><label>Apellidos</label><input type="text" id="f-p-apellido" value="'+escapeHtml(persona?persona.apellido:"")+'"></div>' +
    '<div class="field" style="margin-bottom:14px"><label>DNI (usuario de ingreso)</label><input type="text" id="f-p-dni" value="'+escapeHtml(persona?persona.dni:"")+'" '+(persona?"disabled":"")+'></div>' +
    '<div class="field"><label>Celular (clave de ingreso)</label><input type="text" id="f-p-celular" value="'+escapeHtml(persona?persona.celular:"")+'"></div>',
    '<button class="btn secondary" data-action="close-modal">Cancelar</button>' +
    '<button class="btn" data-action="save-persona" data-dni="'+(persona?persona.dni:"")+'" data-rol="'+rol+'">Guardar</button>'
  );
  openModal(html);
}
function openInscribirModal(dni){
  var user = findUsuario(dni);
  var yaInscrito = db.inscripciones.filter(function(i){ return i.dni===dni; }).map(function(i){return i.cursoId;});
  var disponibles = db.cursos.filter(function(c){ return yaInscrito.indexOf(c.id) === -1; });
  var opciones = disponibles.map(function(c){
    var t = findTrimestre(c.trimestreId);
    return '<option value="'+c.id+'">'+escapeHtml(c.nombre+" — "+(t?t.nombre:""))+'</option>';
  }).join("");
  var inscritoEnRows = cursosDeAlumno(dni).map(function(c){
    return '<li>'+escapeHtml(c.nombre)+' <button class="btn small danger" data-action="retirar-curso" data-dni="'+dni+'" data-curso="'+c.id+'">Retirar</button></li>';
  }).join("");
  var html = modalShell(
    "Inscripciones de " + user.nombre + " " + user.apellido,
    '<p style="margin-top:0;font-weight:700;font-size:.85rem;color:var(--ink-soft)">Cursos actuales</p>' +
    (inscritoEnRows ? '<ul style="padding-left:18px;margin:0 0 16px">'+inscritoEnRows+'</ul>' : '<p class="hint-text" style="margin:0 0 16px">Sin cursos inscritos.</p>') +
    (disponibles.length ?
      '<div class="field"><label>Inscribir en nuevo curso</label><select id="f-inscribir-curso">'+opciones+'</select></div>'
      : '<p class="hint-text">No hay cursos disponibles para inscribir.</p>'),
    '<button class="btn secondary" data-action="close-modal">Cerrar</button>' +
    (disponibles.length ? '<button class="btn" data-action="confirmar-inscribir" data-dni="'+dni+'">Inscribir</button>' : "")
  );
  openModal(html);
}

// ---------------------------------------------------------------------
// Router principal
// ---------------------------------------------------------------------
function route(){
  var user = currentUser();
  var loadingScreen = document.getElementById("screen-loading");
  var connErrorScreen = document.getElementById("screen-conn-error");
  var vistaScreen = document.getElementById("screen-vista-selector");
  if(loadingScreen) loadingScreen.classList.add("hidden");
  if(connErrorScreen) connErrorScreen.classList.add("hidden");
  if(vistaScreen) vistaScreen.classList.add("hidden");
  var loginScreen = document.getElementById("screen-login");
  var appScreen = document.getElementById("screen-app");
  if(!user){
    loginScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    document.getElementById("login-error").classList.remove("show");
    return;
  }
  var vistas = vistasDisponibles(user);
  var vista = (session.vista && vistas.indexOf(session.vista) > -1) ? session.vista : vistas[0];
  loginScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  document.getElementById("app-header").innerHTML = renderHeader(user, vista, vistas);
  if(vista === "admin") renderAdminView(user);
  else if(vista === "monitor") renderMonitorView(user);
  else renderAlumnoView(user);
}

// ---------------------------------------------------------------------
// Delegación de eventos
// ---------------------------------------------------------------------
document.addEventListener("click", async function(e){
  var overlay = e.target.closest && e.target.closest(".modal-overlay");
  if(overlay && !e.target.closest("[data-stop]")){ closeModal(); return; }

  var el = e.target.closest && e.target.closest("[data-action]");
  if(!el) return;
  var action = el.getAttribute("data-action");
  var user = currentUser();

  try{
    switch(action){
      case "close-modal": closeModal(); break;
      case "logout": logout(); break;
      case "choose-vista": {
        session.vista = el.getAttribute("data-vista");
        saveSession();
        route();
        break;
      }
      case "switch-vista": {
        var uForVista = currentUser();
        session.vista = null;
        saveSession();
        showVistaSelector(uForVista, vistasDisponibles(uForVista));
        break;
      }

      case "open-scan-picker": {
        var cursos = cursosDeMonitor(user.dni).filter(function(c){ return c.trimestreId === monitorViewState.trimestreId; });
        var cursoId = monitorViewState.cursoId || (cursos[0] && cursos[0].id);
        if(!cursoId){ toast("No tiene un curso asignado en este trimestre.", "err"); break; }
        openQrScanModal(cursoId, monitorViewState.semana);
        break;
      }
      case "show-my-qr": openQrShowModal(user.dni); break;

      case "open-scan-picker-intercesion": {
        if(!adminIntercesionState.cursoId){ toast("Seleccione un curso en el módulo de Intercesión.", "err"); break; }
        openQrScanModal(adminIntercesionState.cursoId, adminIntercesionState.semana, "intercesion");
        break;
      }
      case "set-semana-ic": adminIntercesionState.semana = parseInt(el.getAttribute("data-semana"),10); renderAdminIntercesionTable(); break;
      case "toggle-interc": {
        var icDni = el.getAttribute("data-dni");
        upsertAsistenciaOptimista(icDni, adminIntercesionState.cursoId, adminIntercesionState.semana, {intercesion: el.checked});
        renderAdminIntercesionTable();
        break;
      }
      case "reset-semana-interc": {
        var icDni2 = el.getAttribute("data-dni");
        upsertAsistenciaOptimista(icDni2, adminIntercesionState.cursoId, adminIntercesionState.semana, {intercesion:false});
        toast("Intercesión restablecida.");
        renderAdminIntercesionTable();
        break;
      }

      case "set-semana": monitorViewState.semana = parseInt(el.getAttribute("data-semana"),10); renderMonitorTable(); break;
      case "toggle": {
        var dni = el.getAttribute("data-dni"), campo = el.getAttribute("data-campo");
        var patch = {}; patch[campo] = el.checked;
        if(el.checked && campo==="asistio") patch.fecha = new Date().toISOString();
        upsertAsistenciaOptimista(dni, monitorViewState.cursoId, monitorViewState.semana, patch);
        renderMonitorTable();
        break;
      }
      case "reset-semana": {
        var d = el.getAttribute("data-dni");
        resetAsistenciaOptimista(d, monitorViewState.cursoId, monitorViewState.semana);
        toast("Registro restablecido.");
        renderMonitorTable();
        break;
      }

      case "admin-tab": adminViewState.tab = el.getAttribute("data-tab"); renderAdminView(user); break;
      case "new-curso": openCursoModal(null); break;
      case "edit-curso": openCursoModal(el.getAttribute("data-id")); break;
      case "del-curso": {
        var cid = el.getAttribute("data-id");
        if(confirm("¿Eliminar este curso? Se eliminarán también sus inscripciones y registros de asistencia.")){
          await sbDelete("cursos", {id:cid});
          await fetchAll();
          toast("Curso eliminado."); renderAdminTab();
        }
        break;
      }
      case "save-curso": {
        var nombre = document.getElementById("f-curso-nombre").value.trim();
        var trimestreId = document.getElementById("f-curso-trimestre").value;
        var monitorDni = document.getElementById("f-curso-monitor").value;
        if(!nombre){ toast("Ingrese el nombre del curso.", "err"); break; }
        var id = el.getAttribute("data-id");
        var row = cursoToRow({nombre:nombre, trimestreId:trimestreId, monitorDni:monitorDni||null});
        if(id) await sbUpdate("cursos", {id:id}, row);
        else await sbInsert("cursos", row);
        await fetchAll();
        closeModal(); toast("Curso guardado."); renderAdminTab();
        break;
      }

      case "new-persona": openPersonaModal(null, el.getAttribute("data-rol")); break;
      case "edit-persona": openPersonaModal(el.getAttribute("data-dni"), el.getAttribute("data-rol")); break;
      case "del-persona": {
        var pdni = el.getAttribute("data-dni");
        if(confirm("¿Eliminar esta persona? Se eliminarán sus inscripciones y registros de asistencia.")){
          await sbDelete("usuarios", {dni:pdni});
          await fetchAll();
          toast("Registro eliminado."); renderAdminTab();
        }
        break;
      }
      case "save-persona": {
        var nombres = document.getElementById("f-p-nombre").value.trim();
        var apellidos = document.getElementById("f-p-apellido").value.trim();
        var pdniField = document.getElementById("f-p-dni").value.trim();
        var celular = document.getElementById("f-p-celular").value.trim();
        var rol = el.getAttribute("data-rol");
        var existingDni = el.getAttribute("data-dni");
        if(!nombres || !apellidos || !pdniField || !celular){ toast("Complete todos los campos.", "err"); break; }
        if(!existingDni){
          if(findUsuario(pdniField)){ toast("Ya existe una persona con ese DNI.", "err"); break; }
          await sbInsert("usuarios", {dni:pdniField, celular:celular, nombre:nombres, apellido:apellidos, rol:rol, activo:true});
        } else {
          await sbUpdate("usuarios", {dni:existingDni}, {nombre:nombres, apellido:apellidos, celular:celular});
        }
        await fetchAll();
        closeModal(); toast("Guardado correctamente."); renderAdminTab();
        break;
      }
      case "inscribir-persona": openInscribirModal(el.getAttribute("data-dni")); break;
      case "confirmar-inscribir": {
        var idni = el.getAttribute("data-dni");
        var selCurso = document.getElementById("f-inscribir-curso");
        if(!selCurso || !selCurso.value){ toast("Seleccione un curso.", "err"); break; }
        await sbInsert("inscripciones", {dni:idni, curso_id:selCurso.value});
        await fetchAll();
        toast("Alumno inscrito."); openInscribirModal(idni);
        break;
      }
      case "retirar-curso": {
        var rdni = el.getAttribute("data-dni"), rcurso = el.getAttribute("data-curso");
        await sbDelete("inscripciones", {dni:rdni, curso_id:rcurso});
        await fetchAll();
        toast("Alumno retirado del curso."); openInscribirModal(rdni);
        break;
      }

      case "add-trimestre": {
        var tn = document.getElementById("inp-nuevo-trimestre").value.trim();
        if(!tn){ toast("Ingrese el nombre del trimestre.", "err"); break; }
        await sbInsert("trimestres", {nombre:tn});
        await fetchAll();
        toast("Trimestre agregado."); renderAdminTab();
        break;
      }
      case "del-trimestre": {
        var tid = el.getAttribute("data-id");
        if(cursosDeTrimestre(tid).length){ toast("No se puede eliminar: tiene cursos asociados.", "err"); break; }
        if(confirm("¿Eliminar este trimestre?")){
          await sbDelete("trimestres", {id:tid});
          await fetchAll();
          toast("Trimestre eliminado."); renderAdminTab();
        }
        break;
      }

      case "masivo-cursos": {
        var trimestreSel = document.getElementById("sel-masivo-trimestre").value;
        var monitorSel = document.getElementById("sel-masivo-monitor").value;
        var lineas = document.getElementById("txt-masivo-cursos").value.split("\n").map(function(s){return s.trim();}).filter(Boolean);
        if(!lineas.length){ toast("Ingrese al menos un nombre de curso.", "err"); break; }
        var filas = lineas.map(function(nombre){ return {nombre:nombre, trimestre_id:trimestreSel, monitor_dni:monitorSel||null}; });
        await sbInsert("cursos", filas);
        await fetchAll();
        toast(lineas.length + " curso(s) creado(s)."); renderAdminTab();
        break;
      }
      case "masivo-alumnos": {
        var cursoSel = document.getElementById("sel-masivo-curso");
        if(!cursoSel){ toast("Debe existir un curso destino.", "err"); break; }
        var cursoDestino = cursoSel.value;
        var lineasA = document.getElementById("txt-masivo-alumnos").value.split("\n").map(function(s){return s.trim();}).filter(Boolean);
        var nuevos = [], existentesPatch = [], inscripcionesNuevas = [];
        lineasA.forEach(function(linea){
          var partes = linea.split(",").map(function(s){return s.trim();});
          if(partes.length < 4) return;
          var dni=partes[0], nom=partes[1], ape=partes[2], cel=partes[3];
          var existente = findUsuario(dni);
          if(existente) existentesPatch.push({dni:dni, nombre:nom, apellido:ape, celular:cel});
          else nuevos.push({dni:dni, celular:cel, nombre:nom, apellido:ape, rol:"estudiante", activo:true});
          var yaInscrito = db.inscripciones.some(function(i){ return i.dni===dni && i.cursoId===cursoDestino; });
          if(!yaInscrito) inscripcionesNuevas.push({dni:dni, curso_id:cursoDestino});
        });
        if(nuevos.length) await sbInsert("usuarios", nuevos);
        for(var pi=0; pi<existentesPatch.length; pi++){
          var p = existentesPatch[pi];
          await sbUpdate("usuarios", {dni:p.dni}, {nombre:p.nombre, apellido:p.apellido, celular:p.celular});
        }
        if(inscripcionesNuevas.length) await sbInsert("inscripciones", inscripcionesNuevas);
        await fetchAll();
        toast(nuevos.length+" creados, "+existentesPatch.length+" actualizados, "+inscripcionesNuevas.length+" inscritos.", "ok");
        renderAdminTab();
        break;
      }
    }
  }catch(err){
    console.error("Error procesando acción '"+action+"':", err);
  }
});

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
function setupLogin(){
  var form = document.getElementById("login-form");
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var dni = document.getElementById("login-dni").value;
    var celular = document.getElementById("login-celular").value;
    var ok = attemptLogin(dni, celular);
    var err = document.getElementById("login-error");
    if(ok){
      err.classList.remove("show");
      form.reset();
      resolveVistaAndRoute();
    } else {
      err.textContent = "Usuario o clave incorrectos.";
      err.classList.add("show");
    }
  });
}

// ---------------------------------------------------------------------
// Tiempo real: cualquier cambio en Supabase refresca a todos los dispositivos
// ---------------------------------------------------------------------
var refreshTimer = null;
function scheduleRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async function(){
    var ok = await fetchAll();
    if(ok) route();
  }, 350);
}
function subscribeRealtime(){
  supabase.channel("edl-realtime")
    .on("postgres_changes", {event:"*", schema:"public", table:"usuarios"}, scheduleRefresh)
    .on("postgres_changes", {event:"*", schema:"public", table:"trimestres"}, scheduleRefresh)
    .on("postgres_changes", {event:"*", schema:"public", table:"cursos"}, scheduleRefresh)
    .on("postgres_changes", {event:"*", schema:"public", table:"inscripciones"}, scheduleRefresh)
    .on("postgres_changes", {event:"*", schema:"public", table:"asistencia"}, scheduleRefresh)
    .subscribe();
}

// ---------------------------------------------------------------------
// Pantallas de carga / error de conexión
// ---------------------------------------------------------------------
function showScreen(id){
  ["screen-loading","screen-conn-error","screen-login","screen-vista-selector","screen-app"].forEach(function(s){
    var el = document.getElementById(s);
    if(el) el.classList.add("hidden");
  });
  document.getElementById(id).classList.remove("hidden");
}
function renderSetupNeeded(){
  document.getElementById("screen-conn-error").innerHTML =
    '<div class="conn-error-box">' +
      '<h2>Falta configurar Supabase</h2>' +
      '<p>Edite el archivo <code>config.js</code> con la URL y la clave "anon" de su proyecto de Supabase, luego recargue esta página.</p>' +
      '<ol>' +
        '<li>Cree un proyecto en supabase.com</li>' +
        '<li>Ejecute <code>schema.sql</code> en el SQL Editor de Supabase</li>' +
        '<li>Copie "Project URL" y "anon public key" desde Project Settings → API</li>' +
        '<li>Péguelos en <code>config.js</code></li>' +
      '</ol>' +
    '</div>';
  showScreen("screen-conn-error");
}
function renderConnError(){
  document.getElementById("screen-conn-error").innerHTML =
    '<div class="conn-error-box">' +
      '<h2>No se pudo conectar</h2>' +
      '<p>No se pudieron cargar los datos desde Supabase. Verifique su conexión a internet y que la URL/clave en <code>config.js</code> sean correctas.</p>' +
      '<button class="btn conn-retry-btn" id="btn-retry">Reintentar</button>' +
    '</div>';
  showScreen("screen-conn-error");
  document.getElementById("btn-retry").addEventListener("click", init);
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function init(){
  showScreen("screen-loading");
  initSupabaseClient();
  if(!configOk){ renderSetupNeeded(); return; }
  var ok = await fetchAll();
  if(!ok){ renderConnError(); return; }
  loadSession();
  setupLogin();
  subscribeRealtime();
  resolveVistaAndRoute();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
