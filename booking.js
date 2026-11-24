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
      p_website: formData.get('website') || ''
    };
    try {
      const response = await fetch(`${baseUrl}/rest/v1/rpc/submit_reservation_request`, {
        method: 'POST',
        headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        if (details.code === '23P01') throw new Error('Esas fechas se acaban de ocupar. Actualiza el calendario y prueba otras.');
        throw new Error('No se pudo guardar la solicitud. Inténtalo de nuevo en unos minutos.');
      }
      const reservationId = await response.json();
      form.reset();
      selectedCheckIn = '';
      selectedCheckOut = '';
      selectingDeparture = false;
      const readableId = Array.isArray(reservationId) ? reservationId[0] : reservationId;
      message.className = 'form-message status-pending';
      message.append(document.createTextNode(`Solicitud ${readableId} guardada como pendiente. Las fechas no se bloquearán hasta que el propietario confirme el depósito. `));
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
