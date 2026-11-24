(() => {
  const config = window.CASA_OAXTEPEC_CONFIG || {};
  const baseUrl = (config.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = config.supabaseAnonKey || '';
  const form = document.getElementById('bookingForm');
  if (!form) return;

  const submitButton = document.getElementById('submitReservation');
  const message = document.getElementById('formMessage');
  const checkInInput = document.getElementById('checkin');
  const checkOutInput = document.getElementById('checkout');
  const monthLabel = document.getElementById('calendarMonth');
  const calendarDays = document.getElementById('calendarDays');
  const formGrid = form.querySelector('.form-grid');
  const consentText = form.querySelector('.consent span');
  consentText.textContent = 'Autorizo guardar mis datos de contacto, fechas y, si registro vehículos, sus placas y datos de acceso para gestionar la solicitud, enviar avisos de la estancia por correo electrónico y, cuando esté habilitado, WhatsApp, y preparar la autorización de ingreso.';
  function addBookingField(labelText, name, type, options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = `field${options.full ? ' full' : ''}`;
    const label = document.createElement('label'); label.textContent = labelText; label.htmlFor = `booking-${name}`;
    let input;
    if (options.select) {
      input = document.createElement('select');
      options.select.forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); });
    } else { input = document.createElement('input'); input.type = type; }
    input.id = `booking-${name}`; input.name = name;
    Object.entries(options.attrs || {}).forEach(([key, value]) => input.setAttribute(key, value));
    wrapper.append(label, input); formGrid.append(wrapper);
    return input;
  }
  const eventInput = addBookingField('Tipo de evento', 'event_type', 'text', { attrs: { maxlength: '100', placeholder: 'Reunión familiar, descanso…' } });
  const arrivalTimeInput = addBookingField('Hora de llegada', 'check_in_time', 'time', { attrs: { value: '09:00', required: '' } });
  const departureTimeInput = addBookingField('Hora de salida', 'check_out_time', 'time', { attrs: { value: '18:00', required: '' } });
  const vehicleCountInput = addBookingField('Número de automóviles', 'vehicle_count', 'number', { attrs: { min: '0', max: '12', value: '0', required: '' } });
  const vehicleField = document.createElement('div'); vehicleField.className = 'field full'; vehicleField.innerHTML = '<label>Datos de vehículos para el acceso</label><div id="vehicleDetails" class="form-grid"></div>'; formGrid.append(vehicleField);
  const vehicleDetails = vehicleField.querySelector('#vehicleDetails');
  const quotePreview = document.createElement('div'); quotePreview.className = 'availability field full'; quotePreview.id = 'quotePreview'; quotePreview.textContent = 'Selecciona llegada y salida para consultar el precio estimado.';
  form.insertBefore(quotePreview, form.querySelector('.consent'));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toIsoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let visibleMonth = new Date(currentMonth);
  const maxMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 23, 1);
  const rangeEnd = new Date(today.getFullYear(), today.getMonth() + 24, today.getDate());
  let confirmedStays = [];
  let selectedCheckIn = '';
  let selectedCheckOut = '';
  let selectingDeparture = false;
  let availabilityLoaded = false;
  let currentQuote = null;
  let quoteSequence = 0;

  function nightIsUnavailable(date) {
    return confirmedStays.some(stay => date >= stay.check_in && date < stay.check_out);
  }

  function stayConflicts(start, end) {
    for (let day = new Date(`${start}T12:00:00`); toIsoDate(day) < end; day.setDate(day.getDate() + 1)) {
      if (nightIsUnavailable(toIsoDate(day))) return true;
    }
    return false;
  }

  function renderCalendar() {
    monthLabel.textContent = visibleMonth.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    calendarDays.replaceChildren();
    const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    for (let i = 0; i < offset; i += 1) {
      const blank = document.createElement('span');
      blank.className = 'calendar-blank';
      blank.setAttribute('aria-hidden', 'true');
      calendarDays.append(blank);
    }
    const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
      const iso = toIsoDate(date);
      const bookedNight = nightIsUnavailable(iso);
      const blockedByRange = selectingDeparture && selectedCheckIn && iso > selectedCheckIn && stayConflicts(selectedCheckIn, iso);
      const past = iso < toIsoDate(today);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(day);
      button.className = bookedNight ? 'booked-night' : '';
      button.setAttribute('aria-label', `${date.toLocaleDateString('es-MX')}${bookedNight ? ', noche confirmada' : ''}`);
      button.disabled = past || (!selectingDeparture && bookedNight) || (selectingDeparture && (iso <= selectedCheckIn || blockedByRange));
      if (iso === selectedCheckIn || iso === selectedCheckOut || (selectedCheckIn && selectedCheckOut && iso > selectedCheckIn && iso < selectedCheckOut)) {
        button.classList.add('selected-date');
      }
      button.addEventListener('click', () => chooseDate(iso));
      calendarDays.append(button);
    }
    document.getElementById('calendarPrev').disabled = visibleMonth <= currentMonth;
    document.getElementById('calendarNext').disabled = visibleMonth >= maxMonth;
  }

  function chooseDate(iso) {
    if (!selectingDeparture || selectedCheckOut) {
      selectedCheckIn = iso;
      selectedCheckOut = '';
      selectingDeparture = true;
      checkInInput.value = iso;
      checkOutInput.value = '';
      message.textContent = 'Ahora selecciona la fecha de salida.';
    } else {
      if (iso <= selectedCheckIn || stayConflicts(selectedCheckIn, iso)) {
        message.textContent = 'Ese rango incluye noches ya confirmadas. Elige otra salida.';
        return;
      }
      selectedCheckOut = iso;
      selectingDeparture = false;
      checkOutInput.value = iso;
      message.textContent = '';
      refreshQuote();
    }
    renderCalendar();
  }

  document.getElementById('calendarPrev').addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('calendarNext').addEventListener('click', () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  async function loadUnavailableDates() {
    if (!baseUrl || !apiKey) throw new Error('Falta la configuración de Supabase.');
    const response = await fetch(`${baseUrl}/rest/v1/rpc/get_unavailable_dates`, {
      method: 'POST',
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_from: toIsoDate(today), p_to: toIsoDate(rangeEnd) })
    });
    if (!response.ok) throw new Error(`No se pudo cargar la disponibilidad (${response.status}).`);
    confirmedStays = await response.json();
    availabilityLoaded = true;
    submitButton.disabled = false;
    submitButton.textContent = 'Enviar solicitud';
    document.querySelector('.calendar-help').textContent = 'Las noches en rojo ya están confirmadas. Las solicitudes pendientes no bloquean fechas.';
    renderCalendar();
  }

  function showWhatsAppLink(reservationId, data) {
    const phone = (config.whatsappNumber || '525562959980').replace(/\D/g, '');
    const whatsappMessage = [
      'Nueva solicitud de Casa Oaxtepec',
      `Folio: ${reservationId}`,
      `Nombre: ${data.p_guest_name}`,
      `Correo: ${data.p_guest_email}`,
      `Teléfono: ${data.p_guest_phone || 'No proporcionado'}`,
      `Llegada: ${data.p_check_in}`,
      `Salida: ${data.p_check_out}`,
      `Huéspedes: ${data.p_guests}`,
      `Automóviles: ${data.p_vehicle_count}`,
      ...(data.p_vehicle_details || []).map((vehicle, index) => `Auto ${index + 1}: ${vehicle.vehicle || 'Vehículo'} · ${vehicle.color} · placas ${vehicle.plate} · conductor ${vehicle.driver} · ${vehicle.occupants} personas`),
      `Precio antes de descuento: $${currentQuote?.base_total ?? '—'} MXN`,
      `Descuento: $${currentQuote?.discount_total ?? '—'} MXN`,
      `Total estimado: $${currentQuote?.total ?? '—'} MXN`,
      `Mensaje: ${data.p_guest_message || 'Sin mensaje'}`,
      'Estado: PENDIENTE DE AUTORIZACIÓN'
    ].join('\n');
    const link = document.createElement('a');
    link.className = 'whatsapp-link';
    link.href = `https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Avisar al propietario por WhatsApp';
    message.append(document.createElement('br'), link);
  }

  function renderVehicleInputs() {
    const count = Math.max(0, Math.min(12, Number(vehicleCountInput.value || 0)));
    vehicleDetails.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const group = document.createElement('fieldset');
      group.className = 'field full';
      group.style.cssText = 'border:1px solid #e5e6df;border-radius:8px;padding:10px 12px';
      const legend = document.createElement('legend'); legend.textContent = `Automóvil ${index + 1}`; group.append(legend);
      const row = document.createElement('div'); row.className = 'form-grid';
      [['driver','Conductor','text'],['vehicle','Marca y modelo (opcional)','text'],['plate','Placas','text'],['color','Color','text'],['occupants','Personas en este auto','number']].forEach(([key,label,type]) => {
        const wrap = document.createElement('div'); wrap.className = 'field'; const labelNode = document.createElement('label'); labelNode.textContent = label; labelNode.htmlFor = `vehicle-${index}-${key}`;
        const input = document.createElement('input'); input.type = type; input.id = labelNode.htmlFor; input.name = `vehicle_${index}_${key}`; input.dataset.vehicleIndex = String(index); input.dataset.vehicleKey = key;
        if (key === 'occupants') { input.min = '1'; input.max = '12'; input.value = '1'; input.required = true; }
        if (['driver','plate','color'].includes(key)) { input.required = true; input.maxLength = key === 'plate' ? 20 : 120; }
        if (key === 'plate') input.placeholder = 'Ej. ABC-123';
        wrap.append(labelNode,input); row.append(wrap);
      });
      group.append(row); vehicleDetails.append(group);
    }
  }
  vehicleCountInput.addEventListener('input', renderVehicleInputs);
  renderVehicleInputs();

  async function refreshQuote() {
    const sequence = ++quoteSequence;
    if (!selectedCheckIn || !selectedCheckOut) { currentQuote = null; quotePreview.textContent = 'Selecciona llegada y salida para consultar el precio estimado.'; return; }
    quotePreview.textContent = 'Calculando precio estimado…';
    try {
      const response = await fetch(`${baseUrl}/rest/v1/rpc/quote_reservation`, { method:'POST', headers:{apikey:apiKey,Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'}, body:JSON.stringify({p_check_in:selectedCheckIn,p_check_out:selectedCheckOut}) });
      if (!response.ok) throw new Error('No se pudo calcular el precio.');
      const quote = await response.json(); if (sequence !== quoteSequence) return;
      currentQuote = quote;
      quotePreview.textContent = `${quote.nights} noches · Antes de descuento ${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(quote.base_total)} · Descuento ${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(quote.discount_total)} · Total estimado ${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(quote.total)}. El anfitrión validará la cotización antes de solicitar el depósito.`;
    } catch (error) { if (sequence === quoteSequence) { currentQuote = null; quotePreview.textContent = error.message || 'No se pudo calcular el precio.'; } }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!availabilityLoaded) {
      message.textContent = 'No se pudo verificar el calendario. Inténtalo de nuevo más tarde.';
      return;
    }
    if (!selectedCheckIn || !selectedCheckOut || selectedCheckOut <= selectedCheckIn) {
      message.textContent = 'Selecciona llegada y salida en el calendario.';
      return;
    }
    const vehicleCount = Number(vehicleCountInput.value || 0);
    const vehicleRows = Array.from({ length: vehicleCount }, (_, index) => {
      const value = key => vehicleDetails.querySelector(`[data-vehicle-index="${index}"][data-vehicle-key="${key}"]`)?.value.trim() || '';
      return { driver:value('driver'), vehicle:value('vehicle'), plate:value('plate'), color:value('color'), occupants:Number(value('occupants') || 0) };
    });
    if (vehicleRows.some(vehicle => !vehicle.driver || !vehicle.plate || !vehicle.color || vehicle.occupants < 1)
      || vehicleRows.reduce((sum, vehicle) => sum + vehicle.occupants, 0) > Number(form.guests.value)) {
      message.textContent = 'Completa conductor, placas, color y personas de cada automóvil. La suma de ocupantes no puede superar los huéspedes.';
      return;
    }
    if (!currentQuote || currentQuote.check_in !== selectedCheckIn || currentQuote.check_out !== selectedCheckOut) {
      await refreshQuote();
      if (!currentQuote) { message.textContent = 'No se pudo obtener una cotización vigente. Inténtalo nuevamente.'; return; }
    }
    if (stayConflicts(selectedCheckIn, selectedCheckOut)) {
      message.textContent = 'Alguien confirmó esas fechas hace un momento. Actualiza la página y elige otras.';
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Guardando…';
    message.className = 'form-message';
    message.replaceChildren();
    const formData = new FormData(form);
    const data = {
      p_guest_name: formData.get('name'),
      p_guest_email: formData.get('email'),
      p_guest_phone: formData.get('phone') || null,
      p_check_in: selectedCheckIn,
      p_check_out: selectedCheckOut,
      p_guests: Number(formData.get('guests')),
      p_guest_message: formData.get('message') || null,
      p_website: formData.get('website') || '',
      p_event_type: formData.get('event_type') || null,
      p_check_in_time: formData.get('check_in_time') || '09:00',
      p_check_out_time: formData.get('check_out_time') || '18:00',
      p_vehicle_count: vehicleCount,
      p_vehicle_details: vehicleRows
    };
    try {
      const response = await fetch(`${baseUrl}/rest/v1/rpc/submit_reservation_request_v2`, {
        method: 'POST',
        headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        if (details.code === '23P01') throw new Error('Esas fechas se acaban de ocupar. Actualiza el calendario y prueba otras.');
        throw new Error('No se pudo guardar la solicitud. Inténtalo de nuevo en unos minutos.');
      }
      const result = await response.json();
      form.reset();
      selectedCheckIn = '';
      selectedCheckOut = '';
      selectingDeparture = false;
      currentQuote = null;
      renderVehicleInputs(); quotePreview.textContent = 'Selecciona llegada y salida para consultar el precio estimado.';
      const readableId = result.id;
      message.className = 'form-message status-pending';
      message.append(document.createTextNode(`Solicitud ${readableId} guardada como pendiente. Total estimado ${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(result.quote.total)}. Las fechas no se bloquearán hasta que el propietario confirme el depósito. `));
      showWhatsAppLink(readableId, data);
      renderCalendar();
    } catch (error) {
      message.className = 'form-message';
      message.textContent = error.message || 'No se pudo enviar la solicitud.';
    } finally {
      submitButton.disabled = !availabilityLoaded;
      submitButton.textContent = availabilityLoaded ? 'Enviar solicitud' : 'Calendario no disponible';
    }
  });

  document.getElementById('year').textContent = new Date().getFullYear();
  submitButton.disabled = true;
  submitButton.textContent = 'Cargando disponibilidad…';
  renderCalendar();
  loadUnavailableDates().catch(error => {
    console.error(error);
    document.querySelector('.calendar-help').textContent = 'No se pudo consultar disponibilidad. Vuelve a cargar la página para intentarlo otra vez.';
    submitButton.textContent = 'Calendario no disponible';
  });
})();
