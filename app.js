/* v8.1 completo: fix IndexedDB (add vs put) + calendario + agenda */
(function(){
  const onReady = (fn) => (document.readyState === "loading") ? document.addEventListener("DOMContentLoaded", fn) : fn();

  onReady(()=>{
    const state = { email: null };
    const $ = s => document.querySelector(s);
    const $$ = s => Array.from(document.querySelectorAll(s));

    const views = {
      login:  () => { $("#viewLogin").style.display=""; $("#viewApp").style.display="none"; $("#viewClienteForm").style.display="none"; $("#viewVisitaForm").style.display="none"; },
      app:    () => { $("#viewLogin").style.display="none"; $("#viewApp").style.display=""; $("#viewClienteForm").style.display="none"; $("#viewVisitaForm").style.display="none"; },
      form:   () => { $("#viewLogin").style.display="none"; $("#viewApp").style.display="none"; $("#viewClienteForm").style.display=""; $("#viewVisitaForm").style.display="none"; },
      visita: () => { $("#viewLogin").style.display="none"; $("#viewApp").style.display="none"; $("#viewClienteForm").style.display="none"; $("#viewVisitaForm").style.display=""; },
    };

    function loadAuth(){ try{return JSON.parse(localStorage.getItem("crm.auth")||"null");}catch{return null;} }
    function saveAuth(v){ localStorage.setItem("crm.auth", JSON.stringify(v)); }
    function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h<<5)-h+s.charCodeAt(i); h|=0;} return String(h>>>0); }

    async function dbInit(){
      return new Promise((resolve,reject)=>{
        const req=indexedDB.open("crm_db",12);
        req.onupgradeneeded = (e)=>{
          const db=e.target.result;
          if(!db.objectStoreNames.contains("clientes")) db.createObjectStore("clientes",{keyPath:"id",autoIncrement:true});
          if(!db.objectStoreNames.contains("locales")){ const s=db.createObjectStore("locales",{keyPath:"id",autoIncrement:true}); s.createIndex("clienteId","clienteId"); }
          if(!db.objectStoreNames.contains("visitas")){ const s=db.createObjectStore("visitas",{keyPath:"id",autoIncrement:true}); s.createIndex("fechaHora","fechaHora"); s.createIndex("clienteId","clienteId"); }
        };
        req.onsuccess=(e)=>{ window._db=e.target.result; resolve(); };
        req.onerror=()=>reject(req.error);
      });
    }
    function tx(store,mode="readonly"){ return window._db.transaction(store,mode).objectStore(store); }
    function getAll(store){ return new Promise((res,rej)=>{ const r=tx(store).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
    function addCliente(c){
      return new Promise((res,rej)=>{
        const obj = {...c}; if (obj.id == null) delete obj.id;
        const r=tx("clientes","readwrite").add(obj);
        r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
      });
    }
    function addVisita(v){
      return new Promise((res,rej)=>{
        const obj = {...v}; if (obj.id == null) delete obj.id;
        const r=tx("visitas","readwrite").add(obj);
        r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
      });
    }
    function putItem(store,obj){ return new Promise((res,rej)=>{ const r=tx(store,"readwrite").put(obj); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
    function delItem(store,key){ return new Promise((res,rej)=>{ const r=tx(store,"readwrite").delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

    const upper = v => (v||"").toUpperCase();
    const lower = v => (v||"").toLowerCase();
    function normPhone(v){
      v = (v||"").replace(/[^\d+]/g,"");
      let cc = "";
      if (v.startsWith("+")) { cc = v.slice(0,3); v = v.slice(3); }
      const digits = v.replace(/\D/g,"");
      let out = digits.replace(/(\d{3})(?=\d)/g,"$1 ").trim();
      if (cc) out = cc + " " + out;
      return out;
    }
    const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v||"");
    const isValidPhone = v => v.replace(/\D/g,"").length>=9;

    // ===== Tabs =====
    $$(".tabs button").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        $$(".tabs button").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        const tab=btn.dataset.tab;
        $("#tab-clientes").style.display = tab==="clientes"?"":"none";
        $("#tab-visitas").style.display = tab==="visitas"?"":"none";
        $("#tab-agenda").style.display = tab==="agenda"?"":"none";
        $("#tab-ajustes").style.display = tab==="ajustes"?"":"none";
        if (tab==="agenda") renderCalendar();
        renderAll();
      });
    });

    // ===== Login =====
    const loginClick = async () => {
      const emailEl = document.getElementById("inEmail");
      const passEl  = document.getElementById("inPass");
      if (!emailEl || !passEl) { alert("Error de carga. Recarga la página."); return; }
      const email = emailEl.value.trim().toLowerCase();
      const pass = passEl.value;
      if (!email || !pass) return alert("Completa email y contraseña.");
      let auth = loadAuth();
      if (!auth){ auth = { email, pass: hash(pass) }; saveAuth(auth); state.email=email; await dbInit(); views.app(); renderAll(); }
      else if (auth.email===email && auth.pass===hash(pass)){ state.email=email; await dbInit(); views.app(); renderAll(); }
      else alert("Credenciales incorrectas.");
    };
    document.getElementById("btnLogin").addEventListener("click", loginClick);
    document.getElementById("inPass").addEventListener("keydown", e=>{ if(e.key==="Enter") loginClick(); });
    document.getElementById("inEmail").addEventListener("keydown", e=>{ if(e.key==="Enter") loginClick(); });

    document.getElementById("btnLogout").addEventListener("click", ()=> views.login());
    document.getElementById("btnGuardarPIN").addEventListener("click", ()=>{ const pin=document.getElementById("nuevoPIN").value; if(!pin) return; const a=loadAuth()||{}; a.pass=hash(pin); saveAuth(a); document.getElementById("nuevoPIN").value=""; alert("Contraseña actualizada."); });

    // ========= Clientes =========
    const form = { id:null };
    function clearClienteForm(){
      form.id=null;
      document.getElementById("clienteFormTitulo").textContent="Nuevo cliente";
      ["#cNombreEmpresa","#cNombreComercial","#cNIF","#cDireccion","#cTelefono","#cContacto","#cEmail","#cLat","#cLng","#cNotas"].forEach(s=>document.querySelector(s).value="");
      document.getElementById("cTipo").value="Restaurante";
      document.getElementById("cFormaPago").value="";
      document.getElementById("pagoContado").classList.add("hidden");
      document.getElementById("pagoGiro").classList.add("hidden");
      document.getElementById("pagoTransferencia").classList.add("hidden");
      document.getElementById("cContadoMetodo").value="EFECTIVO";
      document.getElementById("cGiroContado").checked=false;
      document.getElementById("cGiroDias").value="";
      document.getElementById("cTransfDias").value="";
      document.getElementById("cTransfDiaMes").value="";
    }
    function fillClienteForm(c){
      form.id=c.id;
      document.getElementById("clienteFormTitulo").textContent="Editar cliente";
      document.getElementById("cNombreEmpresa").value = upper(c.nombreEmpresa||"");
      document.getElementById("cNombreComercial").value = upper(c.nombreComercial||"");
      document.getElementById("cNIF").value = upper(c.nifCif||"");
      document.getElementById("cTipo").value = c.tipo||"Restaurante";
      document.getElementById("cDireccion").value = upper(c.direccion||"");
      document.getElementById("cTelefono").value = c.telefono||"";
      document.getElementById("cContacto").value = upper(c.personaContacto||"");
      document.getElementById("cEmail").value = lower(c.email||"");
      document.getElementById("cLat").value = c.geoLat??"";
      document.getElementById("cLng").value = c.geoLng??"";
      document.getElementById("cNotas").value = upper(c.notas||"");
      document.getElementById("cFormaPago").value = c.formaPago||"";
      togglePagoSections();
      document.getElementById("cContadoMetodo").value = c.contadoMetodo||"EFECTIVO";
      document.getElementById("cGiroContado").checked = !!c.giroAContado;
      document.getElementById("cGiroDias").value = c.giroDias??"";
      document.getElementById("cTransfDias").value = c.transferenciaDias??"";
      document.getElementById("cTransfDiaMes").value = c.transferenciaDiaMes??"";
    }
    function readClienteForm(){
      const nombreEmpresa = upper(document.getElementById("cNombreEmpresa").value.trim());
      const nombreComercial = upper(document.getElementById("cNombreComercial").value.trim());
      const nifCif = upper(document.getElementById("cNIF").value.trim());
      const tipo = document.getElementById("cTipo").value;
      const direccion = upper(document.getElementById("cDireccion").value.trim());
      const telefono = normPhone(document.getElementById("cTelefono").value);
      const personaContacto = upper(document.getElementById("cContacto").value.trim());
      const email = lower(document.getElementById("cEmail").value.trim());
      const geoLat = document.getElementById("cLat").value ? parseFloat(document.getElementById("cLat").value.replace(",", ".")) : null;
      const geoLng = document.getElementById("cLng").value ? parseFloat(document.getElementById("cLng").value.replace(",", ".")) : null;
      const notas = upper(document.getElementById("cNotas").value.trim());
      const formaPago = document.getElementById("cFormaPago").value;
      const contadoMetodo = document.getElementById("cContadoMetodo").value;
      const giroAContado = document.getElementById("cGiroContado").checked;
      const giroDias = document.getElementById("cGiroDias").value ? parseInt(document.getElementById("cGiroDias").value,10) : null;
      const transferenciaDias = document.getElementById("cTransfDias").value ? parseInt(document.getElementById("cTransfDias").value,10) : null;
      const transferenciaDiaMes = document.getElementById("cTransfDiaMes").value ? parseInt(document.getElementById("cTransfDiaMes").value,10) : null;
      return {
        id: form.id,
        nombreEmpresa, nombreComercial, nifCif, tipo, direccion,
        telefono, personaContacto, email, geoLat, geoLng, notas,
        esCuentaMadre: false,
        formaPago, contadoMetodo, giroAContado, giroDias, transferenciaDias, transferenciaDiaMes,
        creadoEn: form.id ? undefined : new Date().toISOString(),
        actualizadoEn: new Date().toISOString()
      };
    }
    function togglePagoSections(){
      const v = document.getElementById("cFormaPago").value;
      document.getElementById("pagoContado").classList.toggle("hidden", v!=="CONTADO");
      document.getElementById("pagoGiro").classList.toggle("hidden", v!=="GIRO");
      document.getElementById("pagoTransferencia").classList.toggle("hidden", v!=="TRANSFERENCIA");
    }
    document.getElementById("cFormaPago").addEventListener("change", togglePagoSections);

    document.getElementById("btnNuevoCliente").addEventListener("click", ()=>{ clearClienteForm(); views.form(); });
    document.getElementById("btnCancelarCliente").addEventListener("click", ()=> views.app());
    document.getElementById("btnGeo").addEventListener("click", ()=>{
      if (!navigator.geolocation) return alert("Geolocalización no soportada.");
      navigator.geolocation.getCurrentPosition(pos=>{
        document.getElementById("cLat").value = String(pos.coords.latitude.toFixed(6));
        document.getElementById("cLng").value = String(pos.coords.longitude.toFixed(6));
      }, ()=>alert("No se pudo obtener la ubicación."));
    });
    ["#cNombreEmpresa","#cNombreComercial","#cNIF","#cDireccion","#cContacto","#cNotas"].forEach(sel=>{
      document.querySelector(sel).addEventListener("input", e=> e.target.value = e.target.value.toUpperCase());
    });
    document.getElementById("cTelefono").addEventListener("input", e=> e.target.value = normPhone(e.target.value));
    document.getElementById("cEmail").addEventListener("input", e=> e.target.value = e.target.value.toLowerCase());

    document.getElementById("btnGuardarCliente").addEventListener("click", async ()=>{
      const c = readClienteForm();
      if (!c.nombreEmpresa) return alert("Nombre de la empresa es obligatorio.");
      if (!c.nombreComercial) return alert("Nombre comercial es obligatorio.");
      if (c.email && !isValidEmail(c.email)) return alert("Email no válido.");
      if (c.telefono && !isValidPhone(c.telefono)) return alert("Teléfono no válido (mín. 9 dígitos).");
      if (c.formaPago==="GIRO" && !c.giroAContado && (!c.giroDias || c.giroDias<0)) return alert("Indica los días del giro o marca 'A contado'.");
      if (c.formaPago==="TRANSFERENCIA" && (!c.transferenciaDias || c.transferenciaDias<0 || !c.transferenciaDiaMes || c.transferenciaDiaMes<1 || c.transferenciaDiaMes>31)) return alert("Completa días y día del mes para la transferencia.");
      try{
        if (c.id==null) await addCliente(c); else await putItem("clientes", c);
        views.app(); renderClientes();
      }catch(err){ alert("No se pudo guardar: " + (err?.message||err)); }
    });

    // ===== Catálogo productos =====
    const CATALOGO = [
      { grupo: "BAYO A TU GUSTO", items: [
        { nombre: "PESCADO Y MARISCO", presentaciones: ["STD"] },
        { nombre: "CARNE",             presentaciones: ["STD"] },
        { nombre: "VERDURAS",          presentaciones: ["STD"] },
      ]},
      { grupo: "ARROZ BAYO", items: [
        { nombre: "BASMATI",         presentaciones: ["1 KG","5 KG"] },
        { nombre: "BOMBA",           presentaciones: ["1 KG","5 KG"] },
        { nombre: "REDONDO",         presentaciones: ["1 KG","5 KG"] },
        { nombre: "LARGO",           presentaciones: ["1 KG","5 KG"] },
        { nombre: "VAPORIZADO",      presentaciones: ["1 KG","5 KG"] },
        { nombre: "SALVAJE 100%",    presentaciones: ["1 KG"] },
        { nombre: "SUSHI",           presentaciones: ["1 KG","5 KG"] },
        { nombre: "SUSHI CALROSE",   presentaciones: ["1 KG"] },
        { nombre: "INTEGRAL",        presentaciones: ["1 KG"] },
        { nombre: "THAI-JAZMIN",     presentaciones: ["1 KG"] },
        { nombre: "RISOTTO",         presentaciones: ["1 KG"] },
        { nombre: "ECOLOGICO",       presentaciones: ["1 KG"] },
        { nombre: "REDONDO SUPREME", presentaciones: ["1 KG","5 KG"] },
      ]},
      { grupo: "ARROZ ALONDRA", items: [
        { nombre: "REDONDO",    presentaciones: ["5 KG"] },
        { nombre: "VAPORIZADO", presentaciones: ["5 KG"] },
      ]},
    ];

    // ===== Visitas: crear/editar =====
    const visitaForm = { id:null, clienteId:null };
    function isoLocalNow(){
      const d = new Date();
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0,16);
    }
    function setEstadoUI(estado){
      const options = ["Planeada","Realizada","Cancelada"];
      options.forEach(name => {
        const lab = document.querySelector(`.toggle[data-estado="${name}"]`);
        const chk = lab.querySelector("input[type=checkbox]");
        const active = (name===estado);
        chk.checked = active;
        lab.classList.toggle("active", active);
      });
      document.getElementById("panelAgendar").classList.toggle("hidden", estado!=="Planeada");
      if (estado==="Planeada" && !document.getElementById("vAgendaFechaHora").value){
        document.getElementById("vAgendaFechaHora").value = document.getElementById("vFechaHora").value || isoLocalNow();
      }
    }
    function getEstadoUI(){
      if (document.getElementById("chkPlaneada").checked) return "Planeada";
      if (document.getElementById("chkRealizada").checked) return "Realizada";
      if (document.getElementById("chkCancelada").checked) return "Cancelada";
      return "Planeada";
    }
    document.getElementById("estadoGroup").addEventListener("change", (e)=>{
      const estado = e.target.closest(".toggle")?.dataset?.estado;
      if (!estado) return;
      setEstadoUI(estado);
    });
    function renderCatalogoProductos(seleccion=[]) {
      const cont = document.getElementById("vProductos");
      cont.innerHTML = "";
      const selKey = new Set(seleccion.map(p => `${p.grupo}|${p.producto}|${p.presentacion}`));
      CATALOGO.forEach(g => {
        const box = document.createElement("div");
        box.className = "card";
        box.innerHTML = `<div class="section-title">${g.grupo}</div>`;
        g.items.forEach(it => {
          const row = document.createElement("div");
          row.className = "row";
          const checks = it.presentaciones.map(p => {
            const id = `prod_${g.grupo}_${it.nombre}_${p}`.replace(/\\s+/g,'_');
            const checked = selKey.has(`${g.grupo}|${it.nombre}|${p}`) ? "checked" : "";
            return `
              <label class="row" style="gap:6px">
                <input type="checkbox" data-prod data-grupo="${g.grupo}" data-item="${it.nombre}" data-pres="${p}" id="${id}" ${checked}>
                <span>${it.nombre}${p!=="STD"?" — "+p:""}</span>
              </label>`;
          }).join("");
          row.innerHTML = checks;
          box.appendChild(row);
        });
        cont.appendChild(box);
      });
    }
    function openVisitaNueva(clienteId){
      visitaForm.id = null;
      visitaForm.clienteId = clienteId;
      document.getElementById("visitaTitulo").textContent = "Registrar visita";
      document.getElementById("vFechaHora").value = isoLocalNow();
      document.getElementById("vNotas").value = "";
      setEstadoUI("Planeada");
      document.getElementById("vAgendaFechaHora").value = document.getElementById("vFechaHora").value;
      renderCatalogoProductos([]);
      views.visita();
    }
    function openVisitaEditar(v){
      visitaForm.id = v.id;
      visitaForm.clienteId = v.clienteId;
      document.getElementById("visitaTitulo").textContent = "Editar visita";
      const d = new Date(v.fechaHora);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      document.getElementById("vFechaHora").value = d.toISOString().slice(0,16);
      document.getElementById("vNotas").value = v.notas||"";
      setEstadoUI(v.estado||"Planeada");
      document.getElementById("vAgendaFechaHora").value = document.getElementById("vFechaHora").value;
      renderCatalogoProductos(v.productos||[]);
      views.visita();
    }
    function readVisitaForm(){
      const estado = getEstadoUI();
      const baseInput = (estado==="Planeada") ? "vAgendaFechaHora" : "vFechaHora";
      const dtLocal = document.getElementById(baseInput).value || document.getElementById("vFechaHora").value;
      const fechaHora = dtLocal ? new Date(dtLocal).toISOString() : new Date().toISOString();
      const notas  = document.getElementById("vNotas").value || "";
      const productos = Array.from(document.querySelectorAll("#vProductos input[type=checkbox][data-prod]:checked"))
        .map(ch => ({
          grupo: ch.getAttribute("data-grupo"),
          producto: ch.getAttribute("data-item"),
          presentacion: ch.getAttribute("data-pres")
        }));
      const idVal = visitaForm.id;
      const obj = {
        clienteId: visitaForm.clienteId,
        localId: null,
        usuarioEmail: state.email || "admin@local",
        fechaHora, estado, notas, productos
      };
      if (idVal != null) obj.id = idVal;
      return obj;
    }
    document.getElementById("btnVisitaHoy").addEventListener("click", () => {
      if (form.id == null) { alert("Primero guarda el cliente."); return; }
      openVisitaNueva(form.id);
    });
    document.getElementById("btnCancelarVisita").addEventListener("click", ()=> views.app());
    document.getElementById("btnGuardarVisita").addEventListener("click", async ()=>{
      if (!visitaForm.clienteId) { alert("Cliente no válido."); return; }
      const v = readVisitaForm();
      try{
        if (v.id == null) await addVisita(v); else await putItem("visitas", v);
        views.app();
        renderVisitas();
        renderCalendar();
        renderAgenda();
        alert("Visita guardada.");
      }catch(e){
        alert("No se pudo guardar la visita: " + (e?.message||e));
      }
    });

    // ===== Lista de clientes =====
    document.getElementById("btnNuevoCliente").addEventListener("click", ()=>{ clearClienteForm(); views.form(); });
    document.getElementById("btnCancelarCliente").addEventListener("click", ()=> views.app());
    document.getElementById("buscarCliente").addEventListener("input", renderClientes);

    async function renderClientes(){
      const q = (document.getElementById("buscarCliente").value||"").toLowerCase();
      let list = await getAll("clientes");
      if (q) list = list.filter(c =>
        (c.nombreEmpresa||"").toLowerCase().includes(q) ||
        (c.nombreComercial||"").toLowerCase().includes(q) ||
        (c.nifCif||"").toLowerCase().includes(q) ||
        (c.tipo||"").toLowerCase().includes(q) ||
        (c.direccion||"").toLowerCase().includes(q) ||
        (c.personaContacto||"").toLowerCase().includes(q) ||
        (c.telefono||"").toLowerCase().includes(q) ||
        (c.email||"").toLowerCase().includes(q) ||
        (c.notas||"").toLowerCase().includes(q)
      );
      const cont = document.getElementById("listaClientes"); cont.innerHTML="";
      for (const c of list.sort((a,b)=>(b.actualizadoEn||"").localeCompare(a.actualizadoEn||""))) {
        const el = document.createElement("div");
        el.className="item";
        let pago = "";
        if (c.formaPago==="CONTADO") pago = `Contado (${c.contadoMetodo||""})`;
        else if (c.formaPago==="GIRO") pago = c.giroAContado ? "Giro a contado" : `Giro a ${c.giroDias||0} días`;
        else if (c.formaPago==="TRANSFERENCIA") pago = `Transferencia ${c.transferenciaDias||0} días, día ${c.transferenciaDiaMes||"-"}`;
        el.innerHTML = `
          <div class="row" style="justify-content:space-between">
            <div>
              <div><strong>${c.nombreComercial||""}</strong> ${c.nombreEmpresa?`<span class="badge">${c.nombreEmpresa}</span>`:""}</div>
              <div class="muted">${c.tipo||""} ${c.direccion?(" · "+c.direccion):""}</div>
              <div class="muted">${c.personaContacto||""} ${c.telefono?(" · "+c.telefono):""} ${c.email?(" · "+c.email):""}</div>
              <div class="muted">${pago}</div>
            </div>
            <div class="row">
              <button data-visitar class="primary">Visitar</button>
              <button data-editar>Editar</button>
              <button class="danger" data-eliminar>Eliminar</button>
            </div>
          </div>`;
        el.querySelector("[data-visitar]").onclick = () => openVisitaNueva(c.id);
        el.querySelector("[data-editar]").onclick = () => { fillClienteForm(c); views.form(); };
        el.querySelector("[data-eliminar]").onclick = async () => {
          if (!confirm("¿Eliminar cliente?")) return;
          await delItem("clientes", c.id);
          const visitas = await getAll("visitas");
          for (const v of visitas.filter(x=>x.clienteId===c.id)) await delItem("visitas", v.id);
          renderClientes(); renderVisitas(); renderCalendar(); renderAgenda();
        };
        cont.appendChild(el);
      }
    }

    // ===== Visitas (listar + editar) =====
    document.getElementById("btnNuevaVisita").addEventListener("click", async () => {
      const clientes = await getAll("clientes");
      if (!clientes.length) return alert("Primero crea un cliente.");
      const nombre = prompt("Cliente (escribe el nombre exacto):", clientes[0].nombreComercial || "");
      const cliente = clientes.find(c=>c.nombreComercial===nombre);
      if (!cliente) return alert("Cliente no encontrado.");
      openVisitaNueva(cliente.id);
    });

    async function renderVisitas() {
      const cont = document.getElementById("listaVisitas"); cont.innerHTML = "";
      const visitas = await getAll("visitas");
      const clientes = await getAll("clientes");
      for (const v of visitas.sort((a,b)=>(a.fechaHora||"").localeCompare(b.fechaHora||""))) {
        const c = clientes.find(x=>x.id===v.clienteId);
        const productosTxt = (v.productos && v.productos.length)
          ? v.productos.map(p => `${p.producto}${p.presentacion!=="STD"?" ("+p.presentacion+")":""}`).join(", ")
          : "";
        const el = document.createElement("div");
        el.className = "item";
        el.innerHTML = `
          <div class="row" style="justify-content:space-between">
            <div>
              <div><strong>${c?.nombreComercial||""}</strong> <span class="badge">${v.estado}</span></div>
              <div class="muted">${new Date(v.fechaHora).toLocaleString()}</div>
              <div class="muted">${v.notas||""}</div>
              ${productosTxt ? `<div class="muted">Productos: ${productosTxt}</div>` : ""}
            </div>
            <div class="row">
              <button data-editar>Editar</button>
              <button data-eliminar class="danger">Eliminar</button>
            </div>
          </div>`;
        el.querySelector("[data-editar]").onclick = () => openVisitaEditar(v);
        el.querySelector("[data-eliminar]").onclick = async () => {
          if (!confirm("¿Eliminar visita?")) return;
          await delItem("visitas", v.id);
          renderVisitas(); renderCalendar(); renderAgenda();
        };
        cont.appendChild(el);
      }
    }

    // ===== Agenda =====
    document.getElementById("btnFiltrarAgenda").addEventListener("click", renderAgenda);
    function renderAgenda() {
      const d1v = document.getElementById("fDesde").value;
      const d2v = document.getElementById("fHasta").value;
      const d1 = d1v ? new Date(d1v) : new Date(Date.now()-7*864e5);
      const d2 = d2v ? new Date(d2v) : new Date(Date.now()+60*864e5);
      getAll("visitas").then(list => {
        list = list.filter(v => {
          const d = new Date(v.fechaHora);
          return d >= d1 && d <= d2;
        }).sort((a,b)=> (a.fechaHora||"").localeCompare(b.fechaHora||""));
        const cont = document.getElementById("listaAgenda");
        cont.innerHTML = "";
        list.forEach(v => {
          const div = document.createElement("div");
          div.className = "item";
          div.textContent = `${new Date(v.fechaHora).toLocaleString()} — ${v.estado} — ${v.notas||""}`;
          cont.appendChild(div);
        });
      });
    }

    // Calendario mensual
    let calMonth = (new Date()).getMonth();
    let calYear  = (new Date()).getFullYear();
    document.getElementById("calPrev").addEventListener("click", ()=>{ calMonth--; if (calMonth<0){calMonth=11;calYear--;} renderCalendar(); });
    document.getElementById("calNext").addEventListener("click", ()=>{ calMonth++; if (calMonth>11){calMonth=0;calYear++;} renderCalendar(); });

    async function renderCalendar(){
      const title = new Date(calYear, calMonth, 1).toLocaleString("es", {month:"long", year:"numeric"});
      document.getElementById("calTitle").textContent = title.charAt(0).toUpperCase() + title.slice(1);
      const grid = document.getElementById("calGrid"); grid.innerHTML="";
      const first = new Date(calYear, calMonth, 1);
      const startDay = (first.getDay()+6)%7;
      const days = new Date(calYear, calMonth+1, 0).getDate();
      const today = new Date(); const todayKey = today.toISOString().slice(0,10);

      const visitas = await getAll("visitas");
      const counts = {};
      visitas.forEach(v => {
        const key = new Date(v.fechaHora).toISOString().slice(0,10);
        counts[key] = counts[key] || {P:0,R:0,C:0};
        if (v.estado==="Cancelada") counts[key].C++;
        else if (v.estado==="Realizada") counts[key].R++;
        else counts[key].P++;
      });

      for (let i=0;i<startDay;i++){
        const cell = document.createElement("div"); cell.className="cal-cell"; grid.appendChild(cell);
      }
      for (let d=1; d<=days; d++){
        const cell = document.createElement("div"); cell.className="cal-cell";
        const date = new Date(calYear, calMonth, d);
        const key = new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,10);
        if (key===todayKey) cell.classList.add("today");
        const head = document.createElement("div"); head.className="cal-day"; head.textContent = String(d);
        cell.appendChild(head);
        const c = counts[key];
        if (c){
          if (c.P) { const dot=document.createElement("div"); dot.className="cal-dot"; cell.appendChild(dot); }
          if (c.R) { const dot=document.createElement("div"); dot.className="cal-dot done"; dot.style.right="18px"; cell.appendChild(dot); }
          if (c.C) { const dot=document.createElement("div"); dot.className="cal-dot cancel"; dot.style.right="30px"; cell.appendChild(dot); }
        }
        cell.addEventListener("click", ()=>{
          document.getElementById("fDesde").value = key;
          document.getElementById("fHasta").value = key;
          renderAgenda();
        });
        grid.appendChild(cell);
      }
    }

    // Export JSON
    document.getElementById("btnExport").addEventListener("click", async () => {
      const clientes = await getAll("clientes");
      const locales = await getAll("locales");
      const visitas = await getAll("visitas");
      const payload = { clientes, locales, visitas, exported_at: new Date().toISOString() };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], {type:"application/json"}));
      a.download = "crm_backup.json"; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 500);
    });

    // Inicialización
    dbInit().then(()=>{ renderAll(); renderCalendar(); });
    if ("serviceWorker" in navigator) window.addEventListener("load", ()=> navigator.serviceWorker.register("sw.js?v=9"));

    function renderAll(){ renderClientes(); renderVisitas(); renderAgenda(); }
    window.renderAll = renderAll;
  });
})();