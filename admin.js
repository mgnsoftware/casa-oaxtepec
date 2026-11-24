(() => {
  const config = window.CASA_OAXTEPEC_CONFIG || {};
  const baseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const anonKey = config.supabaseAnonKey || '';
  const sessionKey = 'casa-oaxtepec-admin-session';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const money = value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
  const localDate = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString('es-MX') : '—';
  const errorText = error => error?.message || 'No se pudo completar la operación.';
  let session = null;
  let currentUser = null;
  let reservations = [];
  let selectedReservation = null;
  let currentStatus = 'pending';
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  function getStoredSession() {
    try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { return null; }
  }
  function saveSession(value) {
    session = value;
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  }
  async function api(path, options = {}) {
    const headers = { apikey: anonKey, Authorization: `Bearer ${session?.access_token || anonKey}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.prefer) headers.Prefer = options.prefer;
    const response = await fetch(`${baseUrl}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.message || detail.error_description || `Supabase respondió ${response.status}.`);
    }
    return response.status === 204 ? null : response.json().catch(() => null);
  }
  async function signIn(email, password) {
    const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || 'Correo o contraseña incorrectos.');
    saveSession(result);
    return result.user;
  }
  async function verifyAdmin() {
    if (!session?.access_token) return false;
    const response = await fetch(`${baseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) { saveSession(null); return false; }
    currentUser = await response.json();
    const isAdminClaim = currentUser.app_metadata?.role === 'admin';
    if (!isAdminClaim) {
      const rows = await api(`authorized_admins?email=eq.${encodeURIComponent((currentUser.email || '').toLowerCase())}&is_active=eq.true&select=email&limit=1`);
      if (!rows?.length) throw new Error('Este correo todavía no tiene autorización administrativa. Pide al propietario que lo autorice.');
    }
    return true;
  }
  function showApp(isSignedIn) {
    $('loginView').hidden = isSignedIn;
    $('appView').hidden = !isSignedIn;
    $('logoutButton').hidden = !isSignedIn;
    if (isSignedIn) loadDashboard().catch(error => alert(errorText(error)));
  }

  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); $('loginError').textContent = '';
    try { await signIn($('loginEmail').value.trim(), $('loginPassword').value); await verifyAdmin(); showApp(true); }
    catch (error) { saveSession(null); $('loginError').textContent = errorText(error); }
  });
  $('logoutButton').addEventListener('click', async () => {
    try { await fetch(`${baseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${session?.access_token || anonKey}` } }); } catch { /* termina la sesión local aunque falle la red */ }
    saveSession(null); currentUser = null; showApp(false);
  });
  document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.nav-button').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== `view-${button.dataset.view}`; });
    if (button.dataset.view === 'calendar') renderAdminCalendar();
  }));
  $('reservationTabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-status]'); if (!button) return;
    currentStatus = button.dataset.status;
    $('reservationTabs').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    renderReservationList();
  });

  async function loadDashboard() {
    const [rows] = await Promise.all([api('reservations?select=*&order=created_at.desc&limit=500'), loadSettings(), loadRates(), loadExceptions(), loadPhotos(), loadPromotions(), loadCoupons(), loadAdminUsers()]);
    reservations = rows || [];
    renderReservationStats(); renderReservationList(); renderAdminCalendar();
  }
  function renderReservationStats() {
    $('pendingCount').textContent = reservations.filter(row => row.status === 'pending').length;
    $('confirmedCount').textContent = reservations.filter(row => row.status === 'confirmed').length;
    $('cancelledCount').textContent = reservations.filter(row => row.status === 'cancelled').length;
    $('totalCount').textContent = reservations.length;
  }
  function renderReservationList() {
    const visible = reservations.filter(row => row.status === currentStatus || (currentStatus === 'approved' && ['approved','payment_pending'].includes(row.status)));
    const list = $('reservationList'); list.replaceChildren();
    if (!visible.length) { list.innerHTML = '<p class="muted">No hay solicitudes en esta categoría.</p>'; return; }
    visible.forEach(row => {
      const button = document.createElement('button'); button.className = `row-button${row.id === selectedReservation?.id ? ' selected' : ''}`; button.type = 'button';
      button.innerHTML = `<strong>${escapeHtml(row.guest_name)} · ${escapeHtml(localDate(row.check_in))}</strong><small>${escapeHtml(row.guests)} huéspedes · ${money(row.quoted_total)} · ${escapeHtml(row.status)}</small>`;
      button.addEventListener('click', () => { selectedReservation = row; renderReservationList(); renderReservationDetail(row); }); list.append(button);
    });
  }
  function renderReservationDetail(row) {
    const detail = $('reservationDetail');
    const vehicles = Array.isArray(row.vehicle_details) ? row.vehicle_details : [];
    const breakdown = Array.isArray(row.pricing_breakdown) ? row.pricing_breakdown : [];
    const vehicleTable = vehicles.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Conductor</th><th>Vehículo</th><th>Color</th><th>Placas</th><th>Personas</th></tr></thead><tbody>${vehicles.map((car,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(car.driver)}</td><td>${escapeHtml(car.vehicle || '—')}</td><td>${escapeHtml(car.color)}</td><td>${escapeHtml(car.plate)}</td><td>${escapeHtml(car.occupants)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sin automóviles registrados.</p>';
    const priceRows = breakdown.map(night => `<tr><td>${escapeHtml(localDate(night.date))}</td><td>${escapeHtml(night.weekday)}</td><td>${money(night.base)}</td><td>${escapeHtml(night.discountPercent)}%</td><td>${money(night.total)}${night.exception ? ` · ${escapeHtml(night.exception)}` : ''}</td></tr>`).join('');
    detail.innerHTML = `<h2 class="section-title">${escapeHtml(row.guest_name)}</h2><p><span class="badge ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span> · folio ${escapeHtml(row.id)}</p><dl><dt>Correo</dt><dd>${escapeHtml(row.guest_email)}</dd><dt>Teléfono</dt><dd>${escapeHtml(row.guest_phone || 'No indicado')}</dd><dt>Llegada</dt><dd>${escapeHtml(localDate(row.check_in))} · ${escapeHtml(String(row.check_in_time || '09:00').slice(0,5))}</dd><dt>Salida</dt><dd>${escapeHtml(localDate(row.check_out))} · ${escapeHtml(String(row.check_out_time || '18:00').slice(0,5))}</dd><dt>Huéspedes</dt><dd>${escapeHtml(row.guests)}</dd><dt>Evento</dt><dd>${escapeHtml(row.event_type || 'No indicado')}</dd><dt>Automóviles</dt><dd>${escapeHtml(row.vehicle_count || 0)}</dd><dt>Mensaje</dt><dd>${escapeHtml(row.guest_message || 'Sin mensaje')}</dd><dt>Tarifa base</dt><dd>${money(row.quoted_base_total)}</dd><dt>Descuento</dt><dd>−${money(row.discount_total)}</dd><dt>Total cotizado</dt><dd><strong>${money(row.quoted_total)} MXN</strong></dd></dl><h3>Desglose por noche</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Día</th><th>Base</th><th>Desc.</th><th>Total</th></tr></thead><tbody>${priceRows || '<tr><td colspan="5">Sin desglose guardado</td></tr>'}</tbody></table></div><h3>Automóviles y conductores</h3>${vehicleTable}<div class="actions" id="reservationActions"></div><p class="error" id="reservationActionMessage"></p>`;
    const actions = $('reservationActions');
    if (row.status === 'pending') {
      addAction(actions,'Autorizar y enviar cuenta de depósito',()=>changeReservation(row,'approved'),'button');
      addAction(actions,'Cancelar solicitud',()=>changeReservation(row,'cancelled'),'button danger');
    } else if (['approved','payment_pending','awaiting_deposit'].includes(row.status)) {
      addAction(actions,'Marcar depósito recibido y confirmar',()=>changeReservation(row,'confirmed'),'button');
      addAction(actions,'Cancelar solicitud',()=>changeReservation(row,'cancelled'),'button danger');
    } else if (row.status === 'confirmed') {
      addAction(actions,row.voucher_storage_path?'Descargar autorización PDF':'Generar ficha de acceso PDF',()=>row.voucher_storage_path?downloadVoucher(row):printReservation(row),'button secondary');
      addAction(actions,'Cancelar reserva',()=>changeReservation(row,'cancelled'),'button danger');
    } else addAction(actions,'Generar ficha de acceso PDF',()=>printReservation(row),'button secondary');
  }
  function addAction(container,label,handler,className) { const button=document.createElement('button'); button.type='button'; button.className=className; button.textContent=label; button.addEventListener('click',handler); container.append(button); }
  async function changeReservation(row,status) {
    if (status === 'confirmed' && !window.confirm(`¿Ya verificaste el depósito de ${money(row.quoted_total)} y quieres confirmar estas fechas?`)) return;
    if (status === 'cancelled' && !window.confirm('¿Confirmas cancelar esta solicitud?')) return;
    const msg=$('reservationActionMessage'); msg.textContent='';
    const body = status === 'approved' ? { status, authorized_at:new Date().toISOString() } : status === 'confirmed' ? { status, payment_status:'deposit_received', confirmed_at:new Date().toISOString() } : { status };
    try {
      await api(`reservations?id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',body,prefer:'return=minimal'});
      row.status=status; Object.assign(row,body);
      let notifyMessage='';
      try {
        const result=await edgeCall('reservation-notifications',{action:status==='approved'?'deposit_instructions':'reservation_confirmed',reservation_id:row.id});
        if (result?.voucher_storage_path) row.voucher_storage_path=result.voucher_storage_path;
        const guestSent = status === 'confirmed' ? result?.email_guest?.sent : result?.email_guest?.sent;
        notifyMessage = status === 'confirmed' && result?.voucher_generated
          ? ` Se generó el PDF${guestSent ? ' y se envió por correo al huésped' : '; configura el proveedor de correo para enviarlo'}.`
          : guestSent ? ' Se enviaron por correo las instrucciones de depósito.' : ' Estado guardado; configura el proveedor de correo para enviar las instrucciones.';
      } catch { notifyMessage=' Estado guardado; configura la función y el proveedor de correo para enviar el mensaje.'; }
      msg.textContent=`Solicitud actualizada a ${status}.${notifyMessage}`;
      renderReservationStats(); renderReservationList(); renderReservationDetail(row); renderAdminCalendar();
    } catch(error) { msg.textContent=errorText(error); }
  }
  async function edgeCall(functionName,body) {
    const response=await fetch(`${baseUrl}/functions/v1/${functionName}`,{method:'POST',headers:{apikey:anonKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({})); if(!response.ok)throw new Error(result.error||`Función de Supabase respondió ${response.status}`); return result;
  }
  async function downloadVoucher(row) {
    try { const result=await edgeCall('reservation-notifications',{action:'voucher_link',reservation_id:row.id}); window.open(result.url,'_blank','noopener'); }
    catch(error) { $('reservationActionMessage').textContent=errorText(error); }
  }

  function renderAdminCalendar() {
    const title=$('calendarTitle'); if(!title) return;
    title.textContent=calendarMonth.toLocaleDateString('es-MX',{month:'long',year:'numeric'});
    const grid=$('adminCalendar'); grid.replaceChildren();
    ['Lu','Ma','Mi','Ju','Vi','Sá','Do'].forEach(day=>{const el=document.createElement('strong');el.className='muted';el.textContent=day;grid.append(el);});
    const first=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1); const offset=(first.getDay()+6)%7;
    for(let i=0;i<offset;i++){const blank=document.createElement('div');grid.append(blank);}
    const count=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,0).getDate();
    for(let day=1;day<=count;day++){
      const iso=`${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const stay=reservations.find(row=>row.status==='confirmed'&&iso>=row.check_in&&iso<row.check_out);
      const cell=document.createElement(stay?'button':'div'); cell.className=`cal-day${stay?' busy':''}`; cell.textContent=String(day);
      if(stay){const name=document.createElement('em');name.textContent=stay.guest_name;cell.append(name);cell.title=`${stay.guest_name} · ${stay.id}`;cell.addEventListener('click',()=>{selectedReservation=stay;document.querySelector('[data-view="reservations"]').click();currentStatus='confirmed';$('reservationTabs').querySelectorAll('button').forEach(btn=>btn.classList.toggle('active',btn.dataset.status==='confirmed'));renderReservationList();renderReservationDetail(stay);});}
      grid.append(cell);
    }
  }
  $('calendarPrev').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderAdminCalendar();});
  $('calendarNext').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderAdminCalendar();});

  function printReservation(row) {
    const settings=window.currentReservationSettings||{}; const cars=Array.isArray(row.vehicle_details)?row.vehicle_details:[];
    const breakdown=Array.isArray(row.pricing_breakdown)?row.pricing_breakdown:[];
    $('printSheet').innerHTML=`<h1>Autorización de acceso · Casa Oaxtepec</h1><p><strong>A quien corresponda</strong></p><p>Oaxtepec, Morelos · ${new Date().toLocaleDateString('es-MX')}</p><p>Por medio de la presente se solicita el acceso al fraccionamiento Altos de Oaxtepec a nombre de <strong>${escapeHtml(row.guest_name)}</strong> y sus acompañantes para ocupar la propiedad ubicada en ${escapeHtml(settings.property_address||'Framboyán 28, manzana 9, lote 14, Altos de Oaxtepec, Morelos')}.</p><p>La estancia comprende del <strong>${escapeHtml(localDate(row.check_in))} a las ${escapeHtml(String(row.check_in_time||'09:00').slice(0,5))}</strong> al <strong>${escapeHtml(localDate(row.check_out))} a las ${escapeHtml(String(row.check_out_time||'18:00').slice(0,5))}</strong>. Evento: ${escapeHtml(row.event_type||'estancia familiar')}. Personas autorizadas: <strong>${escapeHtml(row.guests)}</strong>.</p><p>Contacto del huésped: ${escapeHtml(row.guest_phone||'—')} · ${escapeHtml(row.guest_email)}. Folio de reservación: ${escapeHtml(row.id)}.</p><h2>Vehículos registrados para el acceso</h2><table><thead><tr><th>No.</th><th>Conductor</th><th>Vehículo</th><th>Color</th><th>Placas</th><th>Personas</th></tr></thead><tbody>${cars.length?cars.map((car,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(car.driver)}</td><td>${escapeHtml(car.vehicle||'—')}</td><td>${escapeHtml(car.color)}</td><td>${escapeHtml(car.plate)}</td><td>${escapeHtml(car.occupants)}</td></tr>`).join(''):'<tr><td colspan="6">Sin vehículos reportados.</td></tr>'}</tbody></table><h2>Resumen del importe</h2><table><thead><tr><th>Noches</th><th>Precio antes de descuento</th><th>Descuento</th><th>Total confirmado</th></tr></thead><tbody><tr><td>${breakdown.length}</td><td>${money(row.quoted_base_total)}</td><td>${money(row.discount_total)}</td><td>${money(row.quoted_total)} MXN</td></tr></tbody></table><p>El acceso se autoriza únicamente a las personas y vehículos registrados. El anfitrión podrá solicitar identificación al ingreso.</p><p class="rules">Se solicita respetar el reglamento del fraccionamiento y los horarios de ruido vigentes. No se permite pirotecnia. Cualquier daño o falla deberá reportarse al propietario durante la estancia.</p><div class="signature"><div>Firma del huésped<br>${escapeHtml(row.guest_name)}</div><div>Autorización del propietario</div></div><p style="margin-top:8mm">Contacto: ${escapeHtml(settings.owner_whatsapp||'525562959980')} · Casa Oaxtepec</p>`;
    window.print();
  }

  async function loadRates() {
    const rows=await api('nightly_rate_rules?select=*&order=iso_weekday.asc'); const body=$('ratesTable'); if(!body)return; body.replaceChildren();
    (rows||[]).forEach(row=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${escapeHtml(row.day_label)}</td><td><input aria-label="Precio ${escapeHtml(row.day_label)}" type="number" min="0" step="1" value="${escapeHtml(row.nightly_price)}"></td><td><input aria-label="Descuento ${escapeHtml(row.day_label)}" type="number" min="0" max="100" step="0.01" value="${escapeHtml(row.discount_percent)}"></td><td><input aria-label="Activo ${escapeHtml(row.day_label)}" type="checkbox" ${row.is_active?'checked':''}></td><td><button class="button secondary">Guardar</button></td>`;tr.querySelector('button').addEventListener('click',async()=>{const inputs=tr.querySelectorAll('input');try{await api(`nightly_rate_rules?iso_weekday=eq.${row.iso_weekday}`,{method:'PATCH',body:{nightly_price:Number(inputs[0].value),discount_percent:Number(inputs[1].value),is_active:inputs[2].checked,updated_at:new Date().toISOString()},prefer:'return=minimal'});$('ratesError').textContent='Tarifa guardada.';}catch(error){$('ratesError').textContent=errorText(error);}});body.append(tr);});
  }
  async function loadExceptions() {
    const rows=await api('reservation_price_exceptions?select=*&order=starts_on.asc&limit=500');const body=$('exceptionsTable');if(!body)return;body.replaceChildren();
    (rows||[]).forEach(row=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.starts_on)}</td><td>${escapeHtml(row.ends_on)}</td><td>${row.is_active?'Sí':'No'}</td><td><button class="button secondary">${row.is_active?'Pausar':'Activar'}</button></td>`;tr.querySelector('button').addEventListener('click',async()=>{try{await api(`reservation_price_exceptions?id=eq.${row.id}`,{method:'PATCH',body:{is_active:!row.is_active,updated_at:new Date().toISOString()},prefer:'return=minimal'});row.is_active=!row.is_active;loadExceptions();}catch(error){$('exceptionsError').textContent=errorText(error);}});body.append(tr);});
  }
  $('exceptionForm').addEventListener('submit',async event=>{event.preventDefault();$('exceptionsError').textContent='';try{await api('reservation_price_exceptions',{method:'POST',body:{label:$('exceptionLabel').value.trim(),starts_on:$('exceptionStart').value,ends_on:$('exceptionEnd').value,is_active:true},prefer:'return=minimal'});event.target.reset();await loadExceptions();}catch(error){$('exceptionsError').textContent=errorText(error);}});

  async function loadSettings() {
    const rows=await api('reservation_settings?select=*&id=eq.1&limit=1');const row=rows?.[0]||{};window.currentReservationSettings=row;
    ['bankName','accountHolder','clabe','accountNumber','ownerEmail','ownerWhatsapp','propertyAddress','depositInstructions'].forEach((id,index)=>{const values=['bank_name','account_holder','clabe','account_number','owner_email','owner_whatsapp','property_address','deposit_instructions'];$(id).value=row[values[index]]||'';});
  }
  $('settingsForm').addEventListener('submit',async event=>{event.preventDefault();const body={bank_name:$('bankName').value.trim(),account_holder:$('accountHolder').value.trim(),clabe:$('clabe').value.trim(),account_number:$('accountNumber').value.trim(),owner_email:$('ownerEmail').value.trim(),owner_whatsapp:$('ownerWhatsapp').value.replace(/\D/g,''),property_address:$('propertyAddress').value.trim(),deposit_instructions:$('depositInstructions').value.trim(),updated_at:new Date().toISOString()};try{await api('reservation_settings?id=eq.1',{method:'PATCH',body,prefer:'return=minimal'});window.currentReservationSettings={...window.currentReservationSettings,...body};$('settingsMessage').textContent='Datos guardados.';}catch(error){$('settingsMessage').textContent=errorText(error);}});

  async function loadPhotos() {
    const rows=await api('gallery_photos?select=*&order=sort_order.asc,created_at.desc&limit=500');const list=$('photoList');if(!list)return;list.replaceChildren();
    (rows||[]).forEach(row=>{const wrap=document.createElement('div');wrap.className='row-button';const image=document.createElement('img');image.src=`${baseUrl}/storage/v1/object/public/gallery/${row.storage_path.split('/').map(encodeURIComponent).join('/')}`;image.alt=row.alt_text;image.loading='lazy';image.style='width:100%;max-height:190px;object-fit:cover;border-radius:7px';const meta=document.createElement('small');meta.textContent=`${row.category} · ${row.is_active?'Visible':'Oculta'} · orden ${row.sort_order}`;const input=document.createElement('input');input.value=row.alt_text;input.setAttribute('aria-label','Texto alternativo');const category=document.createElement('select');['Casa','Habitaciones','Exteriores','Alberca','Amenidades'].forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===row.category;category.append(option);});const actions=document.createElement('div');actions.className='actions';addAction(actions,'Guardar descripción y categoría',async()=>{try{await api(`gallery_photos?id=eq.${row.id}`,{method:'PATCH',body:{alt_text:input.value.trim(),category:category.value},prefer:'return=minimal'});meta.textContent='Cambios guardados.';}catch(error){meta.textContent=errorText(error);}},'button secondary');addAction(actions,row.is_active?'Ocultar foto':'Mostrar foto',async()=>{try{await api(`gallery_photos?id=eq.${row.id}`,{method:'PATCH',body:{is_active:!row.is_active},prefer:'return=minimal'});row.is_active=!row.is_active;meta.textContent=row.is_active?'Visible':'Oculta';}catch(error){meta.textContent=errorText(error);}},'button secondary');wrap.append(image,meta,input,category,actions);list.append(wrap);});
  }
  $('photoForm').addEventListener('submit',async event=>{event.preventDefault();$('photoError').textContent='';const file=$('photoFile').files[0];if(!file)return;const key=`${Date.now()}-${file.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-')}`;try{const upload=await fetch(`${baseUrl}/storage/v1/object/gallery/${key}`,{method:'POST',headers:{apikey:anonKey,Authorization:`Bearer ${session.access_token}`,'Content-Type':file.type,'x-upsert':'false'},body:file});if(!upload.ok)throw new Error(`No se pudo subir la imagen (${upload.status}).`);await api('gallery_photos',{method:'POST',body:{storage_path:key,alt_text:$('photoAlt').value.trim(),category:$('photoCategory').value,is_active:true,sort_order:0},prefer:'return=minimal'});event.target.reset();await loadPhotos();}catch(error){$('photoError').textContent=errorText(error);}});

  async function loadPromotions() {
    const rows=await api('promotions?select=*&order=created_at.desc');const list=$('promotionList');if(!list)return;list.replaceChildren();
    (rows||[]).forEach(row=>{const item=document.createElement('div');item.className='row-button';item.innerHTML=`<strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.discount_percent||0)}% · ${escapeHtml(row.is_active?'Activa':'Inactiva')} · ${escapeHtml(row.starts_at?.slice(0,10)||'sin inicio')} – ${escapeHtml(row.ends_at?.slice(0,10)||'sin fin')}</small>`;addAction(item,row.is_active?'Desactivar':'Activar',async()=>{try{await api(`promotions?id=eq.${row.id}`,{method:'PATCH',body:{is_active:!row.is_active},prefer:'return=minimal'});loadPromotions();}catch(error){item.append(document.createTextNode(errorText(error)));}},'button secondary');list.append(item);});
  }
  $('promotionForm').addEventListener('submit',async event=>{event.preventDefault();try{await api('promotions',{method:'POST',body:{name:$('promoName').value.trim(),discount_percent:$('promoPercent').value?Number($('promoPercent').value):null,starts_at:$('promoStarts').value?`${$('promoStarts').value}T00:00:00Z`:null,ends_at:$('promoEnds').value?`${$('promoEnds').value}T23:59:59Z`:null,is_active:true},prefer:'return=minimal'});event.target.reset();await loadPromotions();}catch(error){alert(errorText(error));}});

  async function loadCoupons() {
    const rows=await api('coupons?select=*&order=created_at.desc');const list=$('couponList');if(!list)return;list.replaceChildren();
    (rows||[]).forEach(row=>{const item=document.createElement('div');item.className='row-button';item.innerHTML=`<strong>${escapeHtml(row.code)}</strong><small>${escapeHtml(row.discount_percent||0)}% · ${escapeHtml(row.is_active?'Activo':'Inactivo')} · usos ${escapeHtml(row.redemption_count)}</small>`;addAction(item,row.is_active?'Desactivar':'Activar',async()=>{try{await api(`coupons?id=eq.${row.id}`,{method:'PATCH',body:{is_active:!row.is_active},prefer:'return=minimal'});loadCoupons();}catch(error){item.append(document.createTextNode(errorText(error)));}},'button secondary');list.append(item);});
  }
  $('couponForm').addEventListener('submit',async event=>{event.preventDefault();try{await api('coupons',{method:'POST',body:{code:$('couponCode').value.trim().toUpperCase(),discount_percent:Number($('couponPercent').value),is_active:true,starts_at:$('couponStarts').value?`${$('couponStarts').value}T00:00:00Z`:null,ends_at:$('couponEnds').value?`${$('couponEnds').value}T23:59:59Z`:null},prefer:'return=minimal'});event.target.reset();await loadCoupons();}catch(error){alert(errorText(error));}});

  async function loadAdminUsers() {
    const rows=await api('authorized_admins?select=*&order=created_at.asc');const list=$('adminUserList');if(!list)return;list.replaceChildren();
    (rows||[]).forEach(row=>{const item=document.createElement('div');item.className='row-button';item.innerHTML=`<strong>${escapeHtml(row.email)}</strong><small>${row.is_active?'Acceso habilitado':'Acceso revocado'}</small>`;addAction(item,row.is_active?'Revocar acceso':'Reactivar acceso',async()=>{try{await api(`authorized_admins?email=eq.${encodeURIComponent(row.email)}`,{method:'PATCH',body:{is_active:!row.is_active},prefer:'return=minimal'});loadAdminUsers();}catch(error){$('adminUserError').textContent=errorText(error);}},'button secondary');list.append(item);});
  }
  $('adminUserForm').addEventListener('submit',async event=>{event.preventDefault();const email=$('adminUserEmail').value.trim().toLowerCase();if(!window.confirm(`¿Dar acceso administrativo a ${email}? La persona necesitará un correo verificado de Supabase Auth.`))return;try{await api('authorized_admins',{method:'POST',body:{email,is_active:true},headers:{Prefer:'resolution=merge-duplicates,return=minimal'},prefer:'resolution=merge-duplicates,return=minimal'});event.target.reset();await loadAdminUsers();}catch(error){$('adminUserError').textContent=errorText(error);}});

  async function refreshStatus() { try { if (await verifyAdmin()) showApp(true); else showApp(false); } catch (error) { showApp(false); $('loginError').textContent=errorText(error); } }
  refreshStatus();
})();
