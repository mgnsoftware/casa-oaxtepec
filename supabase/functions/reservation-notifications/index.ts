import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
const restHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...restHeaders, ...(init.headers || {}) } });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}
async function requireAdmin(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Se requiere iniciar sesión como administrador.");
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("Sesión inválida o vencida.");
  const user = await res.json();
  if (!user.email_confirmed_at) throw new Error("El correo debe estar verificado.");
  if (user.app_metadata?.role === "admin") return user;
  const rows = await db(`authorized_admins?email=eq.${encodeURIComponent(user.email.toLowerCase())}&is_active=eq.true&select=email&limit=1`);
  if (!rows?.length) throw new Error("Esta cuenta no tiene acceso administrativo.");
  return user;
}
async function getReservation(id: string) {
  const rows = await db(`reservations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!rows?.length) throw new Error("No se encontró la solicitud.");
  return rows[0];
}
async function getSettings() {
  const rows = await db("reservation_settings?id=eq.1&select=*&limit=1");
  return rows?.[0] || {};
}
function money(value: number | null) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value || 0); }
function esc(value: unknown) { return String(value ?? "").replace(/[&<>\"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!)); }
function dateMx(date: string) { return new Date(`${date}T12:00:00-06:00`).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" }); }
function reservationHtml(r: any, s: any, title: string) {
  return `<h2>${esc(title)} · Casa Oaxtepec</h2><p>Hola ${esc(r.guest_name)},</p><p>Solicitud ${esc(r.id)} · ${dateMx(r.check_in)} al ${dateMx(r.check_out)} · ${r.guests} huéspedes.</p><p>Evento: ${esc(r.event_type || "Estancia")}. Horario: entrada ${esc(r.check_in_time || "09:00")}, salida ${esc(r.check_out_time || "18:00")}.</p><p>Total: <b>${money(r.quoted_total)}</b> MXN. Precio antes de descuento: ${money(r.quoted_base_total)}; descuento: ${money(r.discount_total)}.</p><p>${esc(s.deposit_instructions || "")}</p><p>${esc(s.bank_name || "")} · Titular: ${esc(s.account_holder || "")}<br>CLABE: ${esc(s.clabe || "")}<br>Cuenta: ${esc(s.account_number || "")}</p><p>Dudas: ${esc(s.owner_email || "")}</p>`;
}
async function makeVoucher(r: any, s: any) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.08, 0.24, 0.34); let y = 750;
  const line = (text: string, isBold = false, size = 10, gap = 18) => {
    const font = isBold ? bold : regular;
    const words = String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ").split(/\s+/); let current = "";
    for (const word of words) { const next = current ? `${current} ${word}` : word; if (font.widthOfTextAtSize(next, size) > 520 && current) { page.drawText(current, { x: 46, y, size, font, color: navy }); y -= gap; current = word; } else current = next; }
    if (current) { page.drawText(current, { x: 46, y, size, font, color: navy }); y -= gap; }
  };
  page.drawText("CASA OAXTEPEC", { x: 46, y, size: 20, font: bold, color: navy }); y -= 25;
  page.drawText("AUTORIZACION DE ESTANCIA / CONTROL DE ACCESO", { x: 46, y, size: 11, font: bold, color: navy }); y -= 28;
  line(`Folio: ${r.id}`, true); line(`Huesped titular: ${r.guest_name}`); line(`Correo: ${r.guest_email}`); line(`Telefono: ${r.guest_phone || "No proporcionado"}`);
  line(`Llegada: ${dateMx(r.check_in)} ${r.check_in_time || ""}`); line(`Salida: ${dateMx(r.check_out)} ${r.check_out_time || ""}`); line(`Personas: ${r.guests}    Evento: ${r.event_type || "Estancia"}`); line(`Domicilio: ${s.property_address || "Casa Oaxtepec"}`);
  line(`Total: ${money(r.quoted_total)} MXN    Descuento: ${money(r.discount_total)} MXN`, true); y -= 6;
  line("VEHICULOS REGISTRADOS", true);
  const vehicles = Array.isArray(r.vehicle_details) ? r.vehicle_details : [];
  if (!vehicles.length) line("Sin vehiculos registrados.");
  vehicles.forEach((v: any, i: number) => line(`${i + 1}. Conductor: ${v.driver || ""} | Marca/modelo: ${v.model || ""} | Color: ${v.color || ""} | Placas: ${v.plate || ""} | Ocupantes: ${v.occupants || ""}`));
  y -= 4; line("La confirmacion acredita que el propietario valido el deposito y autorizo las fechas indicadas."); line("Respetar el aforo y las reglas de la propiedad. Presentar esta autorizacion al ingreso.");
  y -= 20; page.drawLine({ start: { x: 46, y }, end: { x: 270, y }, thickness: 0.8, color: navy }); page.drawLine({ start: { x: 340, y }, end: { x: 566, y }, thickness: 0.8, color: navy }); y -= 14;
  page.drawText("Firma del huesped", { x: 105, y, size: 9, font: regular, color: navy }); page.drawText("Autorizacion propietario", { x: 390, y, size: 9, font: regular, color: navy });
  return new Uint8Array(await pdf.save());
}
async function sendEmail(to: string, subject: string, html: string, attachment?: Uint8Array, filename = "autorizacion-casa-oaxtepec.pdf") {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("EMAIL_FROM");
  if (!key || !from || !to) return { sent: false, reason: !to ? "sin destinatario" : "falta configurar RESEND_API_KEY o EMAIL_FROM" };
  const body: any = { from, to: [to], subject, html };
  if (attachment) { let binary = ""; for (let i = 0; i < attachment.length; i += 0x8000) binary += String.fromCharCode(...attachment.subarray(i, i + 0x8000)); body.attachments = [{ filename, content: btoa(binary) }]; }
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Proveedor de correo ${response.status}: ${await response.text()}`);
  return { sent: true, data: await response.json() };
}
async function sendWhatsApp(to: string, template: string, params: string[]) {
  const token = Deno.env.get("WA_ACCESS_TOKEN"), phoneId = Deno.env.get("WA_PHONE_NUMBER_ID");
  if (!token || !phoneId || !template || !to) return { sent: false, reason: "WhatsApp Business no configurado" };
  const version = Deno.env.get("WA_API_VERSION") || "v27.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/\D/g, ""), type: "template", template: { name: template, language: { code: Deno.env.get("WA_TEMPLATE_LANGUAGE") || "es_MX" }, components: [{ type: "body", parameters: params.map(text => ({ type: "text", text })) }] } }) });
  if (!response.ok) throw new Error(`WhatsApp ${response.status}: ${await response.text()}`);
  return { sent: true, data: await response.json() };
}
async function logSend(reservationId: string, event: string, channel: string, recipient: string, messageId?: string) {
  await db("reservation_notification_log", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ reservation_id: reservationId, event_key: event, channel, recipient, provider_message_id: messageId || null }) });
}
async function alreadySent(reservationId: string, event: string, channel: string, recipient: string) {
  if (!recipient) return false;
  const rows = await db(`reservation_notification_log?reservation_id=eq.${reservationId}&event_key=eq.${encodeURIComponent(event)}&channel=eq.${encodeURIComponent(channel)}&recipient=eq.${encodeURIComponent(recipient)}&select=id&limit=1`); return !!rows?.length;
}
function mexicoTodayPlus2() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 2)); return d.toISOString().slice(0, 10);
}
async function reminders() {
  const target = mexicoTodayPlus2(), s = await getSettings();
  const rows = await db(`reservations?status=eq.confirmed&check_in=eq.${target}&select=*`);
  const results = [];
  for (const r of rows) {
    const event = `stay_reminder:${target}`;
    const html = `<h2>Recordatorio de estancia · Casa Oaxtepec</h2><p>En dos dias inicia la estancia de ${esc(r.guest_name)} (${dateMx(r.check_in)}). Folio: ${esc(r.id)}. Huespedes: ${r.guests}. Telefono: ${esc(r.guest_phone || "no proporcionado")}.</p>`;
    const emails: unknown[] = [];
    if (!(await alreadySent(r.id,event,"email",r.guest_email))) { const sent=await sendEmail(r.guest_email,"Recordatorio: tu estancia en Casa Oaxtepec es en dos días",html); emails.push(sent); if(sent.sent) await logSend(r.id,event,"email",r.guest_email,sent.data?.id); }
    if (s.owner_email && !(await alreadySent(r.id,event,"email",s.owner_email))) { const sent=await sendEmail(s.owner_email,`Recordatorio de llegada · ${r.guest_name}`,html); emails.push(sent); if(sent.sent) await logSend(r.id,event,"email",s.owner_email,sent.data?.id); }
    let whatsapps: unknown[] = [];
    if (Deno.env.get("WA_GUEST_REMINDER_TEMPLATE") && r.guest_phone && !(await alreadySent(r.id,`${event}:whatsapp`,"whatsapp",r.guest_phone))) { const sent = await sendWhatsApp(r.guest_phone, Deno.env.get("WA_GUEST_REMINDER_TEMPLATE")!, [r.guest_name, dateMx(r.check_in), r.id]); whatsapps.push(sent); if (sent.sent) await logSend(r.id, `${event}:whatsapp`, "whatsapp", r.guest_phone, sent.data?.messages?.[0]?.id); }
    if (Deno.env.get("WA_OWNER_REMINDER_TEMPLATE") && s.owner_whatsapp && !(await alreadySent(r.id,`${event}:whatsapp`,"whatsapp",s.owner_whatsapp))) { const sent = await sendWhatsApp(s.owner_whatsapp, Deno.env.get("WA_OWNER_REMINDER_TEMPLATE")!, [r.guest_name, dateMx(r.check_in), r.id]); whatsapps.push(sent); if (sent.sent) await logSend(r.id, `${event}:whatsapp`, "whatsapp", s.owner_whatsapp, sent.data?.messages?.[0]?.id); }
    results.push({ id: r.id, emails, whatsapps });
  }
  return { target, count: rows.length, results };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    if (!serviceKey) throw new Error("Función sin credenciales de servidor configuradas.");
    const body = await req.json(), action = body.action;
    if (action === "send_reminders") {
      const secret = Deno.env.get("REMINDER_CRON_TOKEN");
      if (!secret || req.headers.get("x-cron-token") !== secret) return json({ error: "No autorizado" }, 401);
      return json(await reminders());
    }
    const user = await requireAdmin(req);
    if (action === "voucher_link") {
      const r = await getReservation(body.reservation_id); if (!r.voucher_storage_path) return json({ error: "Aún no hay comprobante PDF generado." }, 404);
      const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/reservation-documents/${r.voucher_storage_path}`, { method: "POST", headers: restHeaders, body: JSON.stringify({ expiresIn: 900 }) });
      if (!res.ok) throw new Error(`No se pudo crear el enlace del PDF: ${await res.text()}`);
      const signed = await res.json(); return json({ url: `${supabaseUrl}/storage/v1${signed.signedURL}` });
    }
    if (action !== "deposit_instructions" && action !== "reservation_confirmed") return json({ error: "Acción no válida" }, 400);
    const r = await getReservation(body.reservation_id), s = await getSettings();
    if (action === "deposit_instructions" && r.status !== "approved") return json({ error: "La solicitud debe estar autorizada antes de enviar instrucciones." }, 409);
    if (action === "reservation_confirmed" && r.status !== "confirmed") return json({ error: "La solicitud debe estar confirmada después de validar el depósito." }, 409);
    let pdf: Uint8Array | undefined;
    if (action === "reservation_confirmed") {
      pdf = await makeVoucher(r, s); const path = `${r.id}/autorizacion-${r.id}.pdf`;
      const upload = await fetch(`${supabaseUrl}/storage/v1/object/reservation-documents/${path}`, { method: "POST", headers: { ...restHeaders, "Content-Type": "application/pdf", "x-upsert": "true" }, body: pdf });
      if (!upload.ok) throw new Error(`No se pudo guardar el PDF: ${await upload.text()}`);
      await db(`reservations?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ voucher_storage_path: path }) });
    }
    const title = action === "reservation_confirmed" ? "Estancia confirmada" : "Solicitud autorizada · instrucciones de depósito";
    const subject = action === "reservation_confirmed" ? "Tu estancia en Casa Oaxtepec está confirmada" : "Casa Oaxtepec: solicitud autorizada y datos para depósito";
    const guest = await alreadySent(r.id,action,"email",r.guest_email) ? {sent:false,reason:"ya enviado"} : await sendEmail(r.guest_email, subject, reservationHtml(r, s, title), pdf);
    if (guest.sent) await logSend(r.id, action, "email", r.guest_email, guest.data?.id);
    let owner = { sent: false, reason: "no requerido" };
    if (action === "reservation_confirmed" && s.owner_email && !(await alreadySent(r.id,action,"email",s.owner_email))) { owner = await sendEmail(s.owner_email, `Estancia confirmada · ${r.guest_name}`, reservationHtml(r, s, title), pdf); if (owner.sent) await logSend(r.id, action, "email", s.owner_email, owner.data?.id); }
    return json({ ok: true, email_guest: guest, email_owner: owner, voucher_generated: !!pdf, voucher_storage_path: pdf ? `${r.id}/autorizacion-${r.id}.pdf` : null, administered_by: user.email });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Error interno" }, 400); }
});
