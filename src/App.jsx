import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase client ──────────────────────────────────────────────────────────
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function dbFetchRooms() {
  const { data, error } = await supabase.from("rooms").select("*").order("name");
  if (error) throw error;
  return data;
}
async function dbUpsertRoom(room) {
  const { error } = await supabase.from("rooms").upsert(room);
  if (error) throw error;
}
async function dbDeleteRoom(id) {
  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) throw error;
}
async function dbFetchAdmins() {
  const { data, error } = await supabase.from("admins").select("*").order("name");
  if (error) throw error;
  return data;
}
async function dbUpsertAdmin(admin) {
  const { error } = await supabase.from("admins").upsert(admin);
  if (error) throw error;
}
async function dbDeleteAdmin(id) {
  const { error } = await supabase.from("admins").delete().eq("id", id);
  if (error) throw error;
}
async function dbFetchSettings() {
  const { data, error } = await supabase.from("settings").select("*");
  if (error) throw error;
  const m = {};
  data.forEach(r => { m[r.key] = r.value; });
  return {
    schoolName:        m["school_name"]            || "Your University",
    emailEnabled:      m["email_enabled"]          === "true",
    serviceId:         m["email_service_id"]       || "",
    publicKey:         m["email_public_key"]       || "",
    templateIdApprove: m["email_template_approve"] || "",
    templateIdDeny:    m["email_template_deny"]    || "",
  };
}
async function dbSaveSetting(key, value) {
  const { error } = await supabase.from("settings").upsert({ key, value: String(value) });
  if (error) throw error;
}
async function dbFetchRequests() {
  const { data, error } = await supabase
    .from("requests").select("*").order("submitted_at", { ascending: false });
  if (error) throw error;
  return data.map(r => ({
    id:                r.id,
    professorName:     r.professor_name,
    professorEmail:    r.professor_email  || "",
    department:        r.department       || "",
    course:            r.course,
    roomPref:          r.room_pref        || "",
    assignedRoom:      r.assigned_room    || null,
    date:              r.date,
    startTime:         r.start_time,
    endTime:           r.end_time,
    notes:             r.notes            || "",
    status:            r.status,
    directBooking:     r.direct_booking   || false,
    seriesId:          r.series_id        || null,
    recurrencePattern: r.recurrence_pattern || null,
    reviewedBy:        r.reviewed_by      || null,
    lastEditedBy:      r.last_edited_by   || null,
    lastEditedAt:      r.last_edited_at   || null,
    submittedAt:       r.submitted_at,
  }));
}
async function dbUpsertRequest(req) {
  const { error } = await supabase.from("requests").upsert({
    id:                 req.id,
    professor_name:     req.professorName,
    professor_email:    req.professorEmail    || null,
    department:         req.department        || null,
    course:             req.course,
    room_pref:          req.roomPref          || null,
    assigned_room:      req.assignedRoom      || null,
    date:               req.date,
    start_time:         req.startTime,
    end_time:           req.endTime,
    notes:              req.notes             || "",
    status:             req.status,
    direct_booking:     req.directBooking     || false,
    series_id:          req.seriesId          || null,
    recurrence_pattern: req.recurrencePattern || null,
    reviewed_by:        req.reviewedBy        || null,
    last_edited_by:     req.lastEditedBy      || null,
    last_edited_at:     req.lastEditedAt      || null,
    submitted_at:       req.submittedAt,
  });
  if (error) throw error;
}
async function dbDeleteRequest(id) {
  const { error } = await supabase.from("requests").delete().eq("id", id);
  if (error) throw error;
}
async function dbDeleteSeries(seriesId) {
  const { error } = await supabase.from("requests").delete().eq("series_id", seriesId);
  if (error) throw error;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_SCHOOL = "Your University";
const DEFAULT_EMAIL_CONFIG = {
  serviceId: "", templateIdApprove: "", templateIdDeny: "",
  publicKey: "", enabled: false,
};
const ROOM_TYPES = ["Classroom","Lecture Hall","Computer Lab","Seminar Room","Auditorium","Conference Room","Laboratory","Studio","Other"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const STATUS_COLORS = { approved:"#22c55e", denied:"#ef4444", pending:"#f59e0b" };
const STATUS_BG = { approved:"#052e1620", denied:"#450a0a20", pending:"#451a0320" };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt12 = t => { if(!t) return ""; const [h,m]=t.split(":").map(Number); return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`; };
const fmtDate = d => { if(!d) return ""; return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}); };
const getDaysInMonth = (y,m) => new Date(y,m+1,0).getDate();
const getFirstDay = (y,m) => new Date(y,m,1).getDay();

// ─── EmailJS sender ───────────────────────────────────────────────────────────
async function sendEmailNotification({ emailConfig, req, status, assignedRoomName, schoolName, adminName }) {
  if (!emailConfig.enabled || !emailConfig.serviceId || !emailConfig.publicKey) return { ok: false, reason: "not_configured" };
  if (!req.professorEmail) return { ok: false, reason: "no_email" };
  const templateId = status === "approved" ? emailConfig.templateIdApprove : emailConfig.templateIdDeny;
  if (!templateId) return { ok: false, reason: "no_template" };
  const templateParams = {
    to_email: req.professorEmail, to_name: req.professorName, course_name: req.course,
    department: req.department, event_date: fmtDate(req.date), start_time: fmt12(req.startTime),
    end_time: fmt12(req.endTime), room_name: assignedRoomName || "N/A",
    status: status.toUpperCase(), reviewed_by: adminName, school_name: schoolName, notes: req.notes || "None",
  };
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_id: emailConfig.serviceId, template_id: templateId, user_id: emailConfig.publicKey, template_params: templateParams }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "send_failed" };
  } catch (e) { return { ok: false, reason: "network_error" }; }
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --navy:#0f1f3d;--navy-mid:#1a3460;--gold:#c8973a;--gold-light:#e8b95c;
  --cream:#faf7f2;--cream-dark:#f0ebe0;--slate:#4a5568;--text:#1a1a2e;
  --border:#d8cfc0;--card:#fff;
  --shadow:0 2px 12px rgba(15,31,61,.10);--shadow-lg:0 8px 32px rgba(15,31,61,.16);
}
body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--text);}
.app{min-height:100vh;display:flex;flex-direction:column;}

/* LOGIN */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--navy);padding:1rem;}
.login-box{background:white;border-radius:16px;padding:2.5rem;width:100%;max-width:420px;box-shadow:var(--shadow-lg);border-top:4px solid var(--gold);}
.login-logo{text-align:center;margin-bottom:1.75rem;}
.login-logo .shield{width:52px;height:52px;background:var(--gold);clip-path:polygon(50% 0%,100% 20%,100% 70%,50% 100%,0% 70%,0% 20%);display:inline-flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:.75rem;}
.login-logo h1{font-family:'DM Serif Display',serif;font-size:1.5rem;color:var(--navy);}
.login-logo p{color:var(--slate);font-size:.85rem;margin-top:.25rem;}
.login-error{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:8px;padding:.65rem 1rem;font-size:.85rem;margin-bottom:1rem;}
.login-hint{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:.65rem 1rem;font-size:.79rem;color:#0369a1;margin-top:.75rem;line-height:1.6;}

/* NAV */
.nav{background:var(--navy);padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;height:64px;border-bottom:3px solid var(--gold);position:sticky;top:0;z-index:100;}
.nav-brand{display:flex;align-items:center;gap:10px;}
.nav-brand .shield{width:34px;height:34px;background:var(--gold);clip-path:polygon(50% 0%,100% 20%,100% 70%,50% 100%,0% 70%,0% 20%);display:flex;align-items:center;justify-content:center;font-size:15px;}
.nav-brand h1{color:white;font-family:'DM Serif Display',serif;font-size:1.1rem;}
.nav-brand span{color:var(--gold-light);font-size:.72rem;font-weight:300;display:block;}
.nav-right{display:flex;align-items:center;gap:8px;}
.nav-tabs{display:flex;gap:3px;}
.nav-tab{padding:7px 13px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:500;color:rgba(255,255,255,.65);border:1px solid transparent;transition:all .2s;background:none;}
.nav-tab:hover{color:white;background:rgba(255,255,255,.08);}
.nav-tab.active{color:var(--gold-light);background:rgba(200,151,58,.15);border-color:rgba(200,151,58,.35);}
.nav-user{color:rgba(255,255,255,.8);font-size:.79rem;padding:5px 11px;background:rgba(255,255,255,.08);border-radius:20px;display:flex;align-items:center;gap:6px;}
.nav-logout{background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.2);padding:5px 10px;border-radius:6px;font-size:.77rem;cursor:pointer;transition:all .2s;}
.nav-logout:hover{background:rgba(255,255,255,.2);color:white;}
.pub-nav{background:var(--navy);padding:0 1.5rem;display:flex;align-items:center;justify-content:space-between;height:56px;border-bottom:3px solid var(--gold);}
.pub-nav-brand{display:flex;align-items:center;gap:10px;}
.pub-nav-brand .shield{width:30px;height:30px;background:var(--gold);clip-path:polygon(50% 0%,100% 20%,100% 70%,50% 100%,0% 70%,0% 20%);display:flex;align-items:center;justify-content:center;font-size:13px;}
.pub-nav-brand h1{color:white;font-family:'DM Serif Display',serif;font-size:1rem;}
.admin-link{color:var(--gold-light);font-size:.78rem;cursor:pointer;text-decoration:underline;opacity:.8;}
.admin-link:hover{opacity:1;}

/* MAIN */
.main{flex:1;padding:2rem;max-width:1200px;margin:0 auto;width:100%;}
.card{background:var(--card);border-radius:12px;border:1px solid var(--border);box-shadow:var(--shadow);padding:1.5rem;margin-bottom:1.25rem;}
.card-title{font-family:'DM Serif Display',serif;font-size:1.3rem;color:var(--navy);margin-bottom:1.25rem;padding-bottom:.75rem;border-bottom:2px solid var(--cream-dark);}

/* FORM */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;}
.form-group{display:flex;flex-direction:column;gap:5px;}
.form-group.full{grid-column:1/-1;}
.form-label{font-size:.77rem;font-weight:600;color:var(--slate);text-transform:uppercase;letter-spacing:.05em;}
.form-input,.form-select,.form-textarea{padding:9px 13px;border-radius:8px;border:1.5px solid var(--border);font-family:'DM Sans',sans-serif;font-size:.9rem;color:var(--text);background:var(--cream);transition:border-color .2s,box-shadow .2s;outline:none;}
.form-input:focus,.form-select:focus,.form-textarea:focus{border-color:var(--navy-mid);box-shadow:0 0 0 3px rgba(26,52,96,.1);}
.form-input:disabled{opacity:.55;cursor:not-allowed;background:#f1f5f9;}
.form-textarea{resize:vertical;min-height:72px;}
.form-hint{font-size:.74rem;color:#94a3b8;margin-top:2px;}

/* BUTTONS */
.btn{padding:9px 20px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:.87rem;font-weight:600;cursor:pointer;border:none;transition:all .2s;display:inline-flex;align-items:center;gap:6px;}
.btn-primary{background:var(--navy);color:white;}
.btn-primary:hover{background:var(--navy-mid);transform:translateY(-1px);}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.btn-gold{background:var(--gold);color:var(--navy);}
.btn-gold:hover{background:var(--gold-light);}
.btn-sm{padding:5px 12px;font-size:.78rem;}
.btn-approve{background:#16a34a;color:white;}
.btn-approve:hover{background:#15803d;}
.btn-deny{background:#dc2626;color:white;}
.btn-deny:hover{background:#b91c1c;}
.btn-outline{background:transparent;color:var(--navy);border:1.5px solid var(--navy);}
.btn-outline:hover{background:var(--navy);color:white;}
.btn-danger-sm{background:transparent;color:#dc2626;border:1.5px solid #fca5a5;border-radius:7px;padding:4px 11px;font-size:.77rem;font-weight:600;cursor:pointer;transition:all .2s;}
.btn-danger-sm:hover{background:#fef2f2;border-color:#dc2626;}

/* BADGE */
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:.73rem;font-weight:600;text-transform:capitalize;}
.badge::before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor;}

/* REQ CARD */
.req-card{border:1px solid var(--border);border-radius:10px;padding:1rem 1.2rem;background:var(--cream);margin-bottom:.7rem;transition:box-shadow .2s,border-color .2s;}
.req-card:hover{box-shadow:var(--shadow);border-color:#c8b99a;}
.req-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:.5rem;}
.req-card-title{font-weight:600;font-size:.93rem;color:var(--navy);}
.req-card-meta{font-size:.8rem;color:var(--slate);margin-top:2px;}
.req-card-details{display:flex;flex-wrap:wrap;gap:7px;margin-top:.5rem;}
.chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;background:white;border:1px solid var(--border);border-radius:6px;font-size:.77rem;color:var(--slate);}
.req-actions{display:flex;gap:8px;margin-top:.8rem;}

/* STATS */
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem;}
.stat-card{background:var(--card);border-radius:10px;border:1px solid var(--border);padding:1rem 1.2rem;box-shadow:var(--shadow);}
.stat-num{font-family:'DM Serif Display',serif;font-size:1.9rem;color:var(--navy);}
.stat-label{font-size:.77rem;color:var(--slate);font-weight:500;margin-top:2px;}
.stat-card.gold{border-top:3px solid var(--gold);}
.stat-card.green{border-top:3px solid #22c55e;}
.stat-card.red{border-top:3px solid #ef4444;}
.stat-card.blue{border-top:3px solid #3b82f6;}

/* TABS */
.tab-bar{display:flex;gap:4px;background:var(--cream-dark);padding:4px;border-radius:8px;margin-bottom:1.2rem;}
.tab-btn{flex:1;padding:7px 10px;border-radius:6px;cursor:pointer;border:none;background:none;font-family:'DM Sans',sans-serif;font-size:.82rem;font-weight:500;color:var(--slate);transition:all .2s;}
.tab-btn.active{background:white;color:var(--navy);box-shadow:0 1px 4px rgba(0,0,0,.1);font-weight:600;}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(15,31,61,.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(2px);}
.modal{background:white;border-radius:14px;padding:2rem;width:100%;max-width:560px;box-shadow:var(--shadow-lg);border:1px solid var(--border);animation:slideUp .25s ease;max-height:90vh;overflow-y:auto;}
@keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:none;}}
.modal-title{font-family:'DM Serif Display',serif;font-size:1.25rem;color:var(--navy);margin-bottom:1.2rem;}
.modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:1.5rem;}

/* CALENDAR */
.cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;}
.cal-month-label{font-family:'DM Serif Display',serif;font-size:1.4rem;color:var(--navy);}
.cal-nav-btn{background:var(--cream-dark);border:1.5px solid var(--border);border-radius:8px;width:36px;height:36px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;transition:all .2s;}
.cal-nav-btn:hover{background:var(--navy);color:white;border-color:var(--navy);}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
.cal-day-header{text-align:center;font-size:.72rem;font-weight:700;color:var(--slate);text-transform:uppercase;padding:.4rem 0;letter-spacing:.04em;}
.cal-cell{min-height:88px;border:1px solid var(--border);border-radius:8px;padding:.35rem .4rem;background:white;cursor:pointer;transition:border-color .2s,box-shadow .2s;}
.cal-cell:hover{border-color:var(--navy);box-shadow:0 2px 8px rgba(15,31,61,.1);}
.cal-cell.other-month{background:var(--cream);opacity:.5;}
.cal-cell.today{border-color:var(--gold);border-width:2px;}
.cal-date-num{font-size:.79rem;font-weight:600;color:var(--slate);margin-bottom:.25rem;}
.cal-cell.today .cal-date-num{color:var(--gold);font-weight:700;}
.cal-event-dot{font-size:.69rem;padding:1px 5px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;font-weight:500;}
.cal-more{font-size:.67rem;color:var(--slate);margin-top:2px;}
.cal-filter-row{display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap;align-items:center;}
.cal-filter-row .form-select{max-width:180px;padding:7px 11px;font-size:.82rem;}
.day-detail-overlay{position:fixed;inset:0;background:rgba(15,31,61,.45);z-index:150;display:flex;align-items:center;justify-content:center;padding:1rem;}

/* SIGN */
.sign-view{min-height:100vh;background:var(--navy);display:flex;flex-direction:column;}
.sign-header{background:var(--navy-mid);border-bottom:3px solid var(--gold);padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;}
.sign-header h2{color:white;font-family:'DM Serif Display',serif;font-size:1.15rem;}
.sign-clock{color:var(--gold-light);font-size:1.4rem;font-family:'DM Serif Display',serif;}
.sign-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;padding:2rem;}
.sign-card{border-radius:14px;overflow:hidden;border:2px solid transparent;box-shadow:0 4px 24px rgba(0,0,0,.3);}
.sign-card-header{padding:1rem 1.2rem;display:flex;align-items:center;justify-content:space-between;}
.sign-room-name{color:white;font-family:'DM Serif Display',serif;font-size:1.25rem;}
.sign-room-info{color:rgba(255,255,255,.7);font-size:.77rem;}
.sign-status-dot{width:13px;height:13px;border-radius:50%;animation:pulse 2s infinite;flex-shrink:0;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.5;}}
.sign-card-body{padding:1.1rem;background:rgba(0,0,0,.2);}
.sign-event-title{color:white;font-weight:600;font-size:.97rem;margin-bottom:3px;}
.sign-event-prof{color:rgba(255,255,255,.75);font-size:.83rem;}
.sign-event-time{color:var(--gold-light);font-size:1.05rem;font-weight:600;margin-top:7px;}
.sign-vacant{color:rgba(255,255,255,.4);font-size:.88rem;font-style:italic;text-align:center;padding:1rem 0;}

/* TABLES */
.data-table{width:100%;border-collapse:collapse;font-size:.87rem;}
.data-table th{text-align:left;padding:8px 10px;font-size:.73rem;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid var(--border);background:var(--cream);}
.data-table td{padding:9px 10px;border-bottom:1px solid var(--cream-dark);vertical-align:middle;}
.data-table tr:last-child td{border-bottom:none;}
.data-table tr:hover td{background:#fdf9f3;}
.pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:.72rem;font-weight:600;background:rgba(15,31,61,.08);color:var(--navy);}

/* EMAIL SETUP */
.setup-step{display:flex;gap:1rem;margin-bottom:1.25rem;padding:1rem 1.1rem;background:var(--cream);border:1px solid var(--border);border-radius:10px;}
.step-num{width:28px;height:28px;border-radius:50%;background:var(--navy);color:white;font-size:.8rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;}
.step-body h4{font-size:.9rem;font-weight:600;color:var(--navy);margin-bottom:.3rem;}
.step-body p{font-size:.82rem;color:var(--slate);line-height:1.55;}
.step-body code{background:white;border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:.79rem;font-family:monospace;color:var(--navy);}
.step-body a{color:var(--navy-mid);font-weight:600;}
.email-status{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;font-size:.79rem;font-weight:600;}
.email-status.on{background:#dcfce7;color:#15803d;}
.email-status.off{background:#fee2e2;color:#b91c1c;}
.email-status.partial{background:#fef9c3;color:#92400e;}
.template-box{background:#1e293b;border-radius:10px;padding:1rem 1.2rem;font-family:monospace;font-size:.78rem;color:#e2e8f0;line-height:1.7;overflow-x:auto;margin-top:.5rem;}
.template-var{color:#7dd3fc;}
.copy-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.8);border-radius:5px;padding:3px 9px;font-size:.73rem;cursor:pointer;transition:all .2s;font-family:'DM Sans',sans-serif;}
.copy-btn:hover{background:rgba(255,255,255,.2);}

.divider-label{font-size:.74rem;font-weight:700;color:var(--slate);text-transform:uppercase;letter-spacing:.06em;margin:1.5rem 0 .75rem;display:flex;align-items:center;gap:10px;}
.divider-label::after{content:'';flex:1;height:1px;background:var(--border);}
.notif-badge{background:#ef4444;color:white;border-radius:10px;font-size:.68rem;font-weight:700;padding:1px 6px;margin-left:4px;}

/* DIRECT BOOKING */
.booking-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;}
.booking-card{background:var(--cream);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;margin-bottom:.7rem;transition:box-shadow .2s;}
.booking-card:hover{box-shadow:var(--shadow);}
.booking-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;margin-bottom:.5rem;}
.booking-card-title{font-weight:600;font-size:.92rem;color:var(--navy);}
.booking-card-meta{font-size:.79rem;color:var(--slate);margin-top:2px;}
.booking-room-badge{background:var(--navy);color:white;padding:3px 10px;border-radius:6px;font-size:.75rem;font-weight:600;white-space:nowrap;}
.conflict-row{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.65rem .9rem;font-size:.82rem;color:#b91c1c;margin-top:.75rem;}
.avail-row{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:.65rem .9rem;font-size:.82rem;color:#15803d;margin-top:.75rem;}
@media(max-width:900px){.booking-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.booking-grid{grid-template-columns:1fr;}}
.info-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:.75rem 1rem;font-size:.83rem;color:#92400e;margin-bottom:1rem;}
.success-box{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:.75rem 1rem;font-size:.83rem;color:#15803d;margin-bottom:1rem;}
.empty{text-align:center;padding:2.5rem 1rem;color:var(--slate);}
.empty-icon{font-size:2.25rem;margin-bottom:.7rem;}
.submit-success{text-align:center;padding:2.5rem 1rem;}
.submit-success .big-check{font-size:3rem;margin-bottom:.8rem;}
.submit-success h3{font-family:'DM Serif Display',serif;font-size:1.4rem;color:var(--navy);}
.submit-success p{color:var(--slate);margin-top:.4rem;font-size:.88rem;}

@media(max-width:700px){
  .form-grid{grid-template-columns:1fr;}
  .stats-row{grid-template-columns:1fr 1fr;}
  .nav-tab{padding:6px 8px;font-size:.7rem;}
  .sign-grid{grid-template-columns:1fr;}
  .cal-grid{gap:2px;}
  .cal-cell{min-height:56px;}
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// APP ROOT — Supabase connected, all data saved permanently
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [page, setPage]                    = useState("professor");
  const [adminUser, setAdminUser]          = useState(null);
  const [requests, setRequests]            = useState([]);
  const [rooms, setRooms]                  = useState([]);
  const [admins, setAdmins]                = useState([]);
  const [schoolName, setSchoolNameState]   = useState(DEFAULT_SCHOOL);
  const [emailConfig, setEmailConfigState] = useState(DEFAULT_EMAIL_CONFIG);
  const [loading, setLoading]              = useState(true);
  const [toast, setToast]                  = useState(null);
  const [clock, setClock]                  = useState(new Date());

  // Load all data on mount
  const loadAll = useCallback(async () => {
    try {
      const [reqs, rms, adms, settings] = await Promise.all([
        dbFetchRequests(), dbFetchRooms(), dbFetchAdmins(), dbFetchSettings()
      ]);
      setRequests(reqs); setRooms(rms); setAdmins(adms);
      setSchoolNameState(settings.schoolName);
      setEmailConfigState({
        enabled: settings.emailEnabled, serviceId: settings.serviceId,
        publicKey: settings.publicKey, templateIdApprove: settings.templateIdApprove,
        templateIdDeny: settings.templateIdDeny,
      });
    } catch (e) { console.error("Failed to load from Supabase:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Realtime updates — all 3 admins see changes instantly without refreshing
  useEffect(() => {
    const channel = supabase.channel("realtime-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "requests" },
        () => dbFetchRequests().then(setRequests).catch(console.error)
      ).subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const showToast = (msg, type="success") => {
    setToast({msg,type}); setTimeout(() => setToast(null), 3500);
  };
  const pendingCount = requests.filter(r => r.status === "pending").length;

  // ── Supabase-aware state mutators ──────────────────────────────────────────
  const saveRequest = async (req) => {
    await dbUpsertRequest(req);
    setRequests(p => p.find(r=>r.id===req.id) ? p.map(r=>r.id===req.id?req:r) : [req,...p]);
  };
  const removeRequest = async (id) => {
    await dbDeleteRequest(id); setRequests(p=>p.filter(r=>r.id!==id));
  };
  const removeRequestsBySeries = async (seriesId) => {
    await dbDeleteSeries(seriesId); setRequests(p=>p.filter(r=>r.seriesId!==seriesId));
  };
  const saveRoom = async (room) => {
    await dbUpsertRoom(room);
    setRooms(p => p.find(r=>r.id===room.id) ? p.map(r=>r.id===room.id?room:r) : [...p,room]);
  };
  const removeRoom = async (id) => {
    await dbDeleteRoom(id); setRooms(p=>p.filter(r=>r.id!==id));
  };
  const saveAdmin = async (admin) => {
    await dbUpsertAdmin(admin);
    setAdmins(p => p.find(a=>a.id===admin.id) ? p.map(a=>a.id===admin.id?admin:a) : [...p,admin]);
  };
  const removeAdmin = async (id) => {
    await dbDeleteAdmin(id); setAdmins(p=>p.filter(a=>a.id!==id));
  };
  const setSchoolName = async (name) => {
    await dbSaveSetting("school_name", name); setSchoolNameState(name);
  };
  const setEmailConfig = async (cfg) => {
    await Promise.all([
      dbSaveSetting("email_enabled",          cfg.enabled),
      dbSaveSetting("email_service_id",       cfg.serviceId),
      dbSaveSetting("email_public_key",       cfg.publicKey),
      dbSaveSetting("email_template_approve", cfg.templateIdApprove),
      dbSaveSetting("email_template_deny",    cfg.templateIdDeny),
    ]);
    setEmailConfigState(cfg);
  };

  // Show loading screen while fetching from Supabase
  if (loading) return (
    <>
      <style>{css}</style>
      <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
        background:"var(--navy)",flexDirection:"column",gap:"1rem"}}>
        <div style={{width:48,height:48,background:"var(--gold)",
          clipPath:"polygon(50% 0%,100% 20%,100% 70%,50% 100%,0% 70%,0% 20%)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🎓</div>
        <div style={{color:"rgba(255,255,255,.7)",fontSize:".9rem",fontFamily:"'DM Sans',sans-serif"}}>
          Loading Room Scheduler…
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {page === "professor" && (
          <ProfessorView
            requests={requests} rooms={rooms} schoolName={schoolName}
            showToast={showToast} onGoAdmin={() => setPage("admin-login")}
            saveRequest={saveRequest}
          />
        )}
        {page === "admin-login" && (
          <AdminLogin admins={admins}
            onLogin={a => { setAdminUser(a); setPage("admin"); }}
            onBack={() => setPage("professor")} schoolName={schoolName} />
        )}
        {page === "admin" && adminUser && (
          <AdminApp
            adminUser={adminUser}
            onLogout={() => { setAdminUser(null); setPage("professor"); }}
            requests={requests} rooms={rooms} admins={admins}
            schoolName={schoolName} emailConfig={emailConfig}
            setSchoolName={setSchoolName} setEmailConfig={setEmailConfig}
            clock={clock} showToast={showToast} pendingCount={pendingCount}
            saveRequest={saveRequest} removeRequest={removeRequest}
            removeRequestsBySeries={removeRequestsBySeries}
            saveRoom={saveRoom} removeRoom={removeRoom}
            saveAdmin={saveAdmin} removeAdmin={removeAdmin}
          />
        )}
      </div>
      {toast && (
        <div className="toast" style={{background:
          toast.type==="error"?"#b91c1c":toast.type==="warn"?"#92400e":"#15803d"}}>
          {toast.type==="error"?"✕":"✓"} {toast.msg}
        </div>
      )}
      <style>{`.toast{position:fixed;bottom:2rem;right:2rem;z-index:300;color:white;padding:11px 18px;border-radius:10px;font-size:.87rem;font-weight:500;box-shadow:var(--shadow-lg);animation:toastIn .3s ease,toastOut .3s ease 3.2s forwards;}@keyframes toastIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}@keyframes toastOut{to{opacity:0;transform:translateY(10px);}}`}</style>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFESSOR VIEW (PUBLIC)
// ═══════════════════════════════════════════════════════════════════════════════
function ProfessorView({ requests, rooms, schoolName, showToast, onGoAdmin, saveRequest }) {
  const [tab, setTab] = useState("new");
  const [submitted, setSubmitted] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [form, setForm] = useState({ professorName:"", professorEmail:"", department:"", course:"", roomPref:"", date:"", startTime:"", endTime:"", notes:"" });
  const set = (k,v) => setForm(f => ({...f,[k]:v}));

  const handleSubmit = async () => {
    if (!form.professorName||!form.professorEmail||!form.course||!form.date||!form.startTime||!form.endTime) { alert('Please fill in all required fields, including your email.'); return; }
    if (!form.professorEmail.includes('@')) { alert('Please enter a valid email address.'); return; }
    try {
      const newReq = { id:'REQ'+Date.now().toString().slice(-8), ...form, status:'pending', submittedAt:new Date().toISOString(), assignedRoom:null };
      await saveRequest(newReq);
      setSubmitted(true);
      showToast("Request submitted — you'll receive an email when reviewed");
    } catch(e) { showToast('Failed to submit — please try again', 'error'); }
  };

  const myRequests = requests.filter(r => filterName && r.professorName.toLowerCase().includes(filterName.toLowerCase()));

  return (
    <>
      <nav className="pub-nav">
        <div className="pub-nav-brand">
          <div className="shield">🎓</div>
          <h1>{schoolName} — Room Requests</h1>
        </div>
        <span className="admin-link" onClick={onGoAdmin}>Admin Login →</span>
      </nav>
      <div className="main">
        <div className="tab-bar">
          <button className={`tab-btn ${tab==="new"?"active":""}`} onClick={() => { setTab("new"); setSubmitted(false); }}>📝 New Request</button>
          <button className={`tab-btn ${tab==="status"?"active":""}`} onClick={() => setTab("status")}>🔍 Check My Requests</button>
        </div>

        {tab === "new" && (
          <div className="card">
            <div className="card-title">Room Reservation Request</div>
            {submitted ? (
              <div className="submit-success">
                <div className="big-check">📬</div>
                <h3>Request Submitted!</h3>
                <p>Your request is with the Registrar's Office.<br/>You'll receive an <strong>email notification</strong> once it's reviewed.</p>
                <br/>
                <button className="btn btn-primary" onClick={() => { setSubmitted(false); setForm({ professorName:"", professorEmail:"", department:"", course:"", roomPref:"", date:"", startTime:"", endTime:"", notes:"" }); }}>Submit Another</button>
              </div>
            ) : (
              <>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Professor Name *</label>
                    <input className="form-input" value={form.professorName} onChange={e=>set("professorName",e.target.value)} placeholder="Dr. Jane Smith"/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Your Email * <span style={{color:"#22c55e",fontSize:".72rem",fontWeight:500,textTransform:"none",letterSpacing:0}}>— for notifications</span></label>
                    <input className="form-input" type="email" value={form.professorEmail} onChange={e=>set("professorEmail",e.target.value)} placeholder="jsmith@university.edu"/>
                    <span className="form-hint">You'll receive an email when your request is approved or denied.</span>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Department *</label>
                    <input className="form-input" value={form.department} onChange={e=>set("department",e.target.value)} placeholder="e.g. Biology"/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Preferred Room</label>
                    <select className="form-select" value={form.roomPref} onChange={e=>set("roomPref",e.target.value)}>
                      <option value="">No preference</option>
                      {rooms.map(r=><option key={r.id} value={r.id}>{r.name} – {r.building} (cap. {r.capacity})</option>)}
                    </select>
                  </div>
                  <div className="form-group full">
                    <label className="form-label">Course / Event *</label>
                    <input className="form-input" value={form.course} onChange={e=>set("course",e.target.value)} placeholder="e.g. BIO 201 – Cell Biology or Faculty Senate Meeting"/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date *</label>
                    <input className="form-input" type="date" value={form.date} onChange={e=>set("date",e.target.value)}/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Start Time *</label>
                    <input className="form-input" type="time" value={form.startTime} onChange={e=>set("startTime",e.target.value)}/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Time *</label>
                    <input className="form-input" type="time" value={form.endTime} onChange={e=>set("endTime",e.target.value)}/>
                  </div>
                  <div className="form-group full">
                    <label className="form-label">Notes / Special Requirements</label>
                    <textarea className="form-textarea" value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="e.g. Need projector, extra chairs, AV equipment..."/>
                  </div>
                </div>
                <div style={{marginTop:"1.25rem",display:"flex",justifyContent:"flex-end"}}>
                  <button className="btn btn-primary" onClick={handleSubmit}>📤 Submit Request</button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "status" && (
          <div className="card">
            <div className="card-title">Check My Requests</div>
            <div className="form-group" style={{marginBottom:"1rem",maxWidth:300}}>
              <label className="form-label">Your Name</label>
              <input className="form-input" value={filterName} onChange={e=>setFilterName(e.target.value)} placeholder="Type your name…"/>
            </div>
            {myRequests.length===0
              ? <div className="empty"><div className="empty-icon">🔍</div><p>No requests found. Type your name above.</p></div>
              : myRequests.map(r=><ReqCard key={r.id} req={r} rooms={rooms} isAdmin={false}/>)
            }
          </div>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN LOGIN
// ═══════════════════════════════════════════════════════════════════════════════
function AdminLogin({ admins, onLogin, onBack, schoolName }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handle = () => {
    const admin = admins.find(a => a.email.toLowerCase()===email.toLowerCase() && a.password===password);
    if (admin) onLogin(admin);
    else setError("Incorrect email or password. Please try again.");
  };

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-logo">
          <div className="shield">🎓</div>
          <h1>{schoolName}</h1>
          <p>Registrar & Admin Portal</p>
        </div>
        {error && <div className="login-error">⚠️ {error}</div>}
        <div className="form-group" style={{marginBottom:"1rem"}}>
          <label className="form-label">Email Address</label>
          <input className="form-input" type="email" value={email} onChange={e=>{setEmail(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&handle()} placeholder="yourname@university.edu"/>
        </div>
        <div className="form-group" style={{marginBottom:"1.25rem"}}>
          <label className="form-label">Password</label>
          <input className="form-input" type="password" value={password} onChange={e=>{setPassword(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&handle()} placeholder="••••••••"/>
        </div>
        <button className="btn btn-primary" style={{width:"100%",justifyContent:"center"}} onClick={handle}>Sign In to Admin Portal</button>
        <div className="login-hint">
          <strong>Demo accounts</strong> (password: <code style={{background:"rgba(3,105,161,.1)",padding:"1px 5px",borderRadius:3}}>admin123</code>):<br/>
          {admins.map(a=><div key={a.id} style={{marginTop:3}}>• {a.email} — {a.role}</div>)}
        </div>
        <div style={{textAlign:"center",marginTop:"1rem"}}>
          <span style={{color:"var(--slate)",fontSize:".82rem",cursor:"pointer",textDecoration:"underline"}} onClick={onBack}>← Back to Professor Portal</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN APP SHELL
// ═══════════════════════════════════════════════════════════════════════════════
function AdminApp({ adminUser, onLogout, requests, rooms, admins,
  schoolName, emailConfig, setSchoolName, setEmailConfig,
  clock, showToast, pendingCount,
  saveRequest, removeRequest, removeRequestsBySeries,
  saveRoom, removeRoom, saveAdmin, removeAdmin }) {
  const [view, setView] = useState("dashboard");
  const db = { saveRequest, removeRequest, removeRequestsBySeries, saveRoom, removeRoom, saveAdmin, removeAdmin };

  return (
    <>
      <nav className="nav">
        <div className="nav-brand">
          <div className="shield">🎓</div>
          <div><h1>{schoolName}</h1><span>Admin Portal</span></div>
        </div>
        <div className="nav-right">
          <div className="nav-tabs">
            {[["dashboard","📋 Dashboard"],["calendar","📅 Calendar"],["signs","🖥 Signs"],["settings","⚙️ Settings"]].map(([v,label])=>(
              <button key={v} className={`nav-tab ${view===v?"active":""}`} onClick={()=>setView(v)}>
                {label}{v==="dashboard"&&pendingCount>0&&<span className="notif-badge">{pendingCount}</span>}
              </button>
            ))}
          </div>
          <div className="nav-user">👤 {adminUser.name.split(" ")[0]}</div>
          <button className="nav-logout" onClick={onLogout}>Sign Out</button>
        </div>
      </nav>
      {view==="dashboard" && <Dashboard requests={requests} rooms={rooms} admins={admins} adminUser={adminUser} emailConfig={emailConfig} schoolName={schoolName} showToast={showToast} {...db}/>}
      {view==="calendar"  && <CalendarView requests={requests} rooms={rooms} admins={admins} adminUser={adminUser} emailConfig={emailConfig} schoolName={schoolName} showToast={showToast} {...db}/>}
      {view==="signs"     && <SignView requests={requests} rooms={rooms} clock={clock} schoolName={schoolName}/>}
      {view==="settings"  && <Settings rooms={rooms} schoolName={schoolName} admins={admins} emailConfig={emailConfig} setSchoolName={setSchoolName} setEmailConfig={setEmailConfig} showToast={showToast} saveRoom={saveRoom} removeRoom={removeRoom} saveAdmin={saveAdmin} removeAdmin={removeAdmin}/>}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({ requests, rooms, admins, adminUser, emailConfig, schoolName, showToast, saveRequest, removeRequest, removeRequestsBySeries }) {
  const [tab, setTab]             = useState("pending");
  const [approveModal, setApproveModal] = useState(null);
  const [editModal, setEditModal]       = useState(null);
  const [cancelModal, setCancelModal]   = useState(null);

  const pending  = requests.filter(r=>r.status==="pending");
  const approved = requests.filter(r=>r.status==="approved"&&!r.directBooking);
  const denied   = requests.filter(r=>r.status==="denied");
  const direct   = requests.filter(r=>r.status==="approved"&&r.directBooking===true);

  const handleApprove = async (id, roomId) => {
    const req = requests.find(r=>r.id===id);
    const roomName = rooms.find(r=>r.id===roomId)?.name || roomId;
    await saveRequest({...req, status:"approved", assignedRoom:roomId, reviewedBy:adminUser.name});
    setApproveModal(null);
    const result = await sendEmailNotification({ emailConfig, req, status:"approved", assignedRoomName:roomName, schoolName, adminName:adminUser.name });
    if (result.ok) showToast(`Approved & email sent to ${req.professorEmail}`);
    else if (result.reason==="not_configured") showToast("Approved ✓ — configure EmailJS in Settings to send notifications","warn");
    else if (result.reason==="no_email") showToast("Approved ✓ — no email on file for this professor","warn");
    else showToast("Approved ✓ — email send failed, check EmailJS config","warn");
  };

  const handleDeny = async (id) => {
    const req = requests.find(r=>r.id===id);
    await saveRequest({...req, status:"denied", assignedRoom:null, reviewedBy:adminUser.name});
    const result = await sendEmailNotification({ emailConfig, req, status:"denied", assignedRoomName:"", schoolName, adminName:adminUser.name });
    if (result.ok) showToast(`Denied — email sent to ${req.professorEmail}`);
    else showToast("Denied ✓","warn");
  };

  const handleEdit = async (id, changes) => {
    const req = requests.find(r=>r.id===id);
    await saveRequest({...req, ...changes});
    setEditModal(null);
    showToast("Booking updated successfully");
  };

  const handleCancelReservation = async (id) => {
    await removeRequest(id);
    setCancelModal(null);
    showToast("Reservation cancelled and removed");
  };

  const handleDelete = async (id) => {
    await removeRequest(id);
    showToast("Booking removed");
  };

  const displayed = tab==="pending"?pending:tab==="approved"?approved:denied;

  return (
    <div className="main">
      {!emailConfig.enabled && (
        <div className="info-box">📧 <strong>Email notifications not configured.</strong> Go to ⚙️ Settings → Email Notifications to set up EmailJS.</div>
      )}
      {emailConfig.enabled && (
        <div className="success-box">✅ <strong>Email notifications active.</strong> Professors receive emails when requests are approved or denied.</div>
      )}
      {pending.length>0 && (
        <div className="info-box">📬 <strong>{pending.length} pending request{pending.length>1?"s":""}</strong> — visible to all {admins.length} admins: {admins.map(a=>a.name.split(" ")[0]).join(", ")}.</div>
      )}
      <div className="stats-row">
        <div className="stat-card gold"><div className="stat-num">{pending.length}</div><div className="stat-label">Pending</div></div>
        <div className="stat-card green"><div className="stat-num">{approved.length}</div><div className="stat-label">Approved</div></div>
        <div className="stat-card red"><div className="stat-num">{denied.length}</div><div className="stat-label">Denied</div></div>
        <div className="stat-card blue"><div className="stat-num">{requests.length}</div><div className="stat-label">Total</div></div>
      </div>
      <div className="card">
        <div className="card-title">Room Assignments</div>
        <div className="tab-bar">
          <button className={`tab-btn ${tab==="pending"?"active":""}`} onClick={()=>setTab("pending")}>⏳ Pending ({pending.length})</button>
          <button className={`tab-btn ${tab==="approved"?"active":""}`} onClick={()=>setTab("approved")}>✅ Approved ({approved.length})</button>
          <button className={`tab-btn ${tab==="denied"?"active":""}`} onClick={()=>setTab("denied")}>❌ Denied ({denied.length})</button>
          <button className={`tab-btn ${tab==="direct"?"active":""}`} onClick={()=>setTab("direct")}>📌 Direct ({direct.length})</button>
        </div>
        {tab==="direct" ? (
          <DirectBooking requests={requests} rooms={rooms} adminUser={adminUser} emailConfig={emailConfig} schoolName={schoolName} showToast={showToast} saveRequest={saveRequest} removeRequest={removeRequest} removeRequestsBySeries={removeRequestsBySeries} onDelete={handleDelete}/>
        ) : (
          displayed.length===0
            ? <div className="empty"><div className="empty-icon">{tab==="pending"?"🎉":"📋"}</div><p>No {tab} requests.</p></div>
            : displayed.map(r=>(
                <ReqCard key={r.id} req={r} rooms={rooms} isAdmin={true}
                  onApprove={()=>setApproveModal(r)}
                  onDeny={()=>handleDeny(r.id)}
                  onEdit={()=>setEditModal(r)}
                  onCancel={()=>setCancelModal(r)}
                />
              ))
        )}
      </div>

      {approveModal && <AssignModal req={approveModal} rooms={rooms} requests={requests} onClose={()=>setApproveModal(null)} onApprove={handleApprove}/>}
      {editModal   && <EditBookingModal req={editModal} rooms={rooms} requests={requests} adminUser={adminUser} onClose={()=>setEditModal(null)} onSave={changes=>handleEdit(editModal.id,changes)}/>}
      {cancelModal && <CancelReservationModal req={cancelModal} rooms={rooms} onClose={()=>setCancelModal(null)} onConfirm={()=>handleCancelReservation(cancelModal.id)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECT BOOKING  (admin assigns room without a professor request, with recurrence)
// ═══════════════════════════════════════════════════════════════════════════════

// Generate all dates for a recurrence pattern
function generateRecurringDates(startDate, endDate, pattern, selectedDays) {
  const dates = [];
  if (!startDate || !endDate) return dates;
  const start = new Date(startDate + "T12:00:00");
  const end   = new Date(endDate   + "T12:00:00");
  if (end < start) return dates;

  if (pattern === "once") {
    dates.push(startDate);
    return dates;
  }

  let current = new Date(start);
  while (current <= end) {
    const dow = current.getDay(); // 0=Sun…6=Sat
    const dateStr = current.toISOString().slice(0,10);

    if (pattern === "daily") {
      dates.push(dateStr);
    } else if (pattern === "weekly") {
      if (selectedDays.includes(dow)) dates.push(dateStr);
    } else if (pattern === "biweekly") {
      // biweekly: same days of week, every 2 weeks
      const weekNum = Math.floor((current - start) / (7 * 86400000));
      if (selectedDays.includes(dow) && weekNum % 2 === 0) dates.push(dateStr);
    } else if (pattern === "monthly") {
      // same day-of-month as start
      if (current.getDate() === start.getDate()) dates.push(dateStr);
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const RECUR_LABELS = { once:"One-time", daily:"Every Day", weekly:"Weekly", biweekly:"Bi-weekly", monthly:"Monthly (same date)" };

function DirectBooking({ requests, rooms, adminUser, emailConfig, schoolName, showToast, saveRequest, removeRequest, removeRequestsBySeries, onDelete }) {
  const BLANK = {
    professorName:"", professorEmail:"", department:"", course:"",
    assignedRoom:"", startTime:"", endTime:"", notes:"",
    // recurrence
    pattern:"once", startDate:"", endDate:"", selectedDays:[1,3], // Mon+Wed default
  };
  const [form, setForm]       = useState(BLANK);
  const [saved, setSaved]     = useState(null);   // { count, conflicts }
  const [editTarget, setEditTarget] = useState(null);
  const [deleteSeries, setDeleteSeries] = useState(null); // seriesId to confirm delete
  const [expandedSeries, setExpandedSeries] = useState({});
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const toggleDay = (d) => set("selectedDays", form.selectedDays.includes(d)
    ? form.selectedDays.filter(x=>x!==d)
    : [...form.selectedDays, d].sort());

  // ── Preview dates ──
  const previewDates = form.pattern==="once"
    ? (form.startDate ? [form.startDate] : [])
    : generateRecurringDates(form.startDate, form.endDate, form.pattern, form.selectedDays);

  // ── Conflict check across ALL preview dates ──
  const conflictDates = previewDates.filter(date =>
    form.assignedRoom && form.startTime && form.endTime &&
    requests.some(r =>
      r.status==="approved" &&
      r.assignedRoom===form.assignedRoom &&
      r.date===date &&
      (editTarget ? r.seriesId!==editTarget.seriesId : true) &&
      !(form.endTime<=r.startTime || form.startTime>=r.endTime)
    )
  );
  const cleanDates = previewDates.filter(d=>!conflictDates.includes(d));

  // ── Submit ──
  const handleBook = async () => {
    if (!form.professorName||!form.course||!form.assignedRoom||!form.startDate||!form.startTime||!form.endTime) {
      alert("Fill in: Name, Course, Room, Start Date, Start Time, and End Time."); return;
    }
    if (form.pattern!=="once" && !form.endDate) {
      alert("Please set a Repeat Until date."); return;
    }
    if ((form.pattern==="weekly"||form.pattern==="biweekly") && form.selectedDays.length===0) {
      alert("Select at least one day of the week."); return;
    }
    if (cleanDates.length===0) {
      alert("All dates in this range have conflicts. Adjust the room, time, or date range."); return;
    }

    const room = rooms.find(r=>r.id===form.assignedRoom);
    const seriesId = editTarget ? editTarget.seriesId : "SER"+Date.now().toString().slice(-7);
    const submittedAt = new Date().toISOString();

    if (editTarget) {
      // Remove all old bookings in this series, then re-create
      await removeRequestsBySeries(editTarget.seriesId);
      const newOnes = cleanDates.map((date,i) => ({
        id: "DIR"+Date.now().toString().slice(-6)+i,
        professorName: form.professorName,
        professorEmail: form.professorEmail,
        department: form.department,
        course: form.course,
        assignedRoom: form.assignedRoom,
        roomPref: form.assignedRoom,
        date,
        startTime: form.startTime,
        endTime: form.endTime,
        notes: form.notes,
        status: "approved",
        directBooking: true,
        seriesId,
        recurrencePattern: form.pattern,
        reviewedBy: adminUser.name,
        submittedAt,
      }));
      for (const b of newOnes) { await saveRequest(b); }
      setEditTarget(null);
      showToast(`Series updated — ${cleanDates.length} booking${cleanDates.length!==1?"s":""} saved`);
    } else {
      const newBookings = cleanDates.map((date,i) => ({
        id: "DIR"+Date.now().toString().slice(-6)+i,
        professorName: form.professorName,
        professorEmail: form.professorEmail,
        department: form.department,
        course: form.course,
        assignedRoom: form.assignedRoom,
        roomPref: form.assignedRoom,
        date,
        startTime: form.startTime,
        endTime: form.endTime,
        notes: form.notes,
        status: "approved",
        directBooking: true,
        seriesId,
        recurrencePattern: form.pattern,
        reviewedBy: adminUser.name,
        submittedAt,
      }));
      for (const b of newBookings) { await saveRequest(b); }

      // Email first occurrence only
      if (form.professorEmail && newBookings.length>0) {
        const result = await sendEmailNotification({
          emailConfig, req: newBookings[0], status:"approved",
          assignedRoomName: room?.name||form.assignedRoom, schoolName, adminName:adminUser.name
        });
        if (result.ok) showToast(`${cleanDates.length} booking${cleanDates.length!==1?"s":""} created & email sent to ${form.professorEmail}`);
        else showToast(`${cleanDates.length} booking${cleanDates.length!==1?"s":""} created — set up EmailJS in Settings to email professors`, "warn");
      } else {
        showToast(`${cleanDates.length} booking${cleanDates.length!==1?"s":""} created successfully`);
      }
      setSaved({ count: cleanDates.length, skipped: conflictDates.length });
    }
    setForm(BLANK);
  };

  const startEdit = (seriesId) => {
    const series = requests.filter(r=>r.seriesId===seriesId).sort((a,b)=>a.date.localeCompare(b.date));
    if (!series.length) return;
    const first = series[0];
    setEditTarget({ seriesId });
    setForm({
      professorName: first.professorName,
      professorEmail: first.professorEmail||"",
      department: first.department||"",
      course: first.course,
      assignedRoom: first.assignedRoom,
      startTime: first.startTime,
      endTime: first.endTime,
      notes: first.notes||"",
      pattern: first.recurrencePattern||"once",
      startDate: first.date,
      endDate: series[series.length-1].date,
      selectedDays: [...new Set(series.map(r=>new Date(r.date+"T12:00:00").getDay()))].sort(),
    });
    setSaved(null);
    window.scrollTo({top:0,behavior:"smooth"});
  };

  const confirmDeleteSeries = async (seriesId) => {
    await removeRequestsBySeries(seriesId);
    setDeleteSeries(null);
    showToast("Series removed");
  };

  const cancelEdit = () => { setEditTarget(null); setForm(BLANK); };

  // ── Group direct bookings by seriesId ──
  const directBookings = requests.filter(r=>r.status==="approved"&&r.directBooking===true);
  const seriesMap = {};
  directBookings.forEach(b => {
    const sid = b.seriesId || b.id;
    if (!seriesMap[sid]) seriesMap[sid] = [];
    seriesMap[sid].push(b);
  });
  const seriesList = Object.entries(seriesMap)
    .map(([sid, bookings]) => ({
      seriesId: sid,
      bookings: bookings.sort((a,b)=>a.date.localeCompare(b.date)),
    }))
    .sort((a,b)=>a.bookings[0].date.localeCompare(b.bookings[0].date));

  const needsEndDate = form.pattern !== "once";
  const needsDays    = form.pattern !== "once" && form.pattern !== "monthly" && form.pattern !== "daily";

  return (
    <>
      {/* ══════ FORM ══════ */}
      <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:12,padding:"1.35rem",marginBottom:"1.25rem"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontFamily:"'DM Serif Display',serif",fontSize:"1.1rem",color:"var(--navy)"}}>
              {editTarget ? "✏️ Edit Booking Series" : "📌 Assign Room Directly"}
            </div>
            <div style={{fontSize:".8rem",color:"var(--slate)",marginTop:2}}>
              Assign a room one-time or set up a recurring series — for courses, lab sections, meetings, and more.
            </div>
          </div>
          {editTarget && <button className="btn btn-outline btn-sm" onClick={cancelEdit}>✕ Cancel</button>}
        </div>

        {saved && !editTarget && (
          <div className="success-box" style={{marginBottom:"1rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
            <span>✅ <strong>{saved.count} booking{saved.count!==1?"s":""} created!</strong>{saved.skipped>0 && ` (${saved.skipped} date${saved.skipped!==1?"s":""} skipped due to conflicts)`}</span>
            <button className="btn btn-sm btn-primary" onClick={()=>setSaved(null)}>+ Book Another</button>
          </div>
        )}

        {/* ── Core fields ── */}
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Professor / Person *</label>
            <input className="form-input" value={form.professorName} onChange={e=>set("professorName",e.target.value)} placeholder="Dr. Jane Smith"/>
          </div>
          <div className="form-group">
            <label className="form-label">Email <span style={{color:"#94a3b8",fontWeight:400,textTransform:"none",fontSize:".71rem",letterSpacing:0}}>— optional, for notification</span></label>
            <input className="form-input" type="email" value={form.professorEmail} onChange={e=>set("professorEmail",e.target.value)} placeholder="jsmith@university.edu"/>
          </div>
          <div className="form-group">
            <label className="form-label">Department</label>
            <input className="form-input" value={form.department} onChange={e=>set("department",e.target.value)} placeholder="e.g. Biology"/>
          </div>
          <div className="form-group">
            <label className="form-label">Assign Room *</label>
            <select className="form-select" value={form.assignedRoom} onChange={e=>set("assignedRoom",e.target.value)}>
              <option value="">Select room…</option>
              {rooms.map(r=><option key={r.id} value={r.id}>{r.name} — {r.building} (cap. {r.capacity})</option>)}
            </select>
          </div>
          <div className="form-group full">
            <label className="form-label">Course / Event Name *</label>
            <input className="form-input" value={form.course} onChange={e=>set("course",e.target.value)} placeholder="e.g. HIST 101 – World History or Department Meeting"/>
          </div>
          <div className="form-group">
            <label className="form-label">Start Time *</label>
            <input className="form-input" type="time" value={form.startTime} onChange={e=>set("startTime",e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">End Time *</label>
            <input className="form-input" type="time" value={form.endTime} onChange={e=>set("endTime",e.target.value)}/>
          </div>
          <div className="form-group full">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Setup notes, equipment needs, etc." style={{minHeight:56}}/>
          </div>
        </div>

        {/* ── Recurrence section ── */}
        <div style={{marginTop:"1rem",padding:"1rem 1.1rem",background:"white",borderRadius:10,border:"1px solid var(--border)"}}>
          <div style={{fontWeight:700,fontSize:".85rem",color:"var(--navy)",textTransform:"uppercase",letterSpacing:".05em",marginBottom:".75rem"}}>🔁 Recurrence — <span style={{fontWeight:400,textTransform:"none",color:"var(--slate)",fontSize:".82rem",letterSpacing:0}}>choose Weekly or Bi-weekly to pick specific days</span></div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Repeat Pattern *</label>
              <select className="form-select" value={form.pattern} onChange={e=>set("pattern",e.target.value)}>
                {Object.entries(RECUR_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{form.pattern==="once" ? "Date *" : "Start Date *"}</label>
              <input className="form-input" type="date" value={form.startDate} onChange={e=>set("startDate",e.target.value)}/>
            </div>
            {needsEndDate && (
              <div className="form-group">
                <label className="form-label">Repeat Until *</label>
                <input className="form-input" type="date" value={form.endDate} min={form.startDate||undefined} onChange={e=>set("endDate",e.target.value)}/>
              </div>
            )}
          </div>

          {/* Day-of-week picker — shown for weekly and biweekly */}
          {needsDays && (
            <div style={{marginTop:"1rem",background:"#f0f4ff",border:"2px solid #c7d2fe",borderRadius:10,padding:"1rem 1.1rem"}}>
              <div style={{fontSize:".85rem",fontWeight:700,color:"#3730a3",marginBottom:".65rem"}}>
                📅 Which days of the week? (select all that apply)
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {DAY_LABELS.map((label,i)=>{
                  const active = form.selectedDays.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={()=>toggleDay(i)}
                      style={{
                        padding:"8px 18px",
                        borderRadius:24,
                        border:"2px solid",
                        cursor:"pointer",
                        fontFamily:"inherit",
                        fontWeight:700,
                        fontSize:".9rem",
                        background: active?"#3730a3":"white",
                        color: active?"white":"#4b5563",
                        borderColor: active?"#3730a3":"#d1d5db",
                        transition:"all .15s",
                        boxShadow: active?"0 2px 8px rgba(55,48,163,.3)":"none",
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
              {form.selectedDays.length === 0 && (
                <div style={{marginTop:".5rem",fontSize:".78rem",color:"#dc2626",fontWeight:600}}>
                  ⚠ Please select at least one day
                </div>
              )}
              {form.selectedDays.length > 0 && (
                <div style={{marginTop:".5rem",fontSize:".78rem",color:"#15803d",fontWeight:600}}>
                  ✓ Selected: {form.selectedDays.map(d=>DAY_LABELS[d]).join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Preview panel */}
          {previewDates.length > 0 && form.startTime && form.endTime && (
            <div style={{marginTop:"1rem",background:"var(--cream)",borderRadius:8,padding:".85rem 1rem",border:"1px solid var(--border)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".6rem",flexWrap:"wrap",gap:6}}>
                <div style={{fontWeight:700,fontSize:".8rem",color:"var(--navy)"}}>
                  📋 Preview — {previewDates.length} date{previewDates.length!==1?"s":""} total
                  {conflictDates.length>0 && <span style={{color:"#b91c1c",marginLeft:8}}>({conflictDates.length} conflict{conflictDates.length!==1?"s":" "})</span>}
                  {cleanDates.length>0 && <span style={{color:"#15803d",marginLeft:4}}>({cleanDates.length} will be booked)</span>}
                </div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,maxHeight:120,overflowY:"auto"}}>
                {previewDates.map(date=>{
                  const hasConflict = conflictDates.includes(date);
                  return (
                    <span key={date} style={{
                      padding:"2px 9px",borderRadius:5,fontSize:".74rem",fontWeight:600,
                      background: hasConflict?"#fef2f2":"#dcfce7",
                      color: hasConflict?"#b91c1c":"#15803d",
                      border:`1px solid ${hasConflict?"#fecaca":"#86efac"}`,
                    }}>
                      {hasConflict?"⚠":"✓"} {new Date(date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",weekday:"short"})}
                    </span>
                  );
                })}
              </div>
              {conflictDates.length>0 && (
                <div style={{fontSize:".78rem",color:"#92400e",marginTop:".5rem"}}>
                  ⚠ Conflicting dates will be skipped. {cleanDates.length} booking{cleanDates.length!==1?"s":""} will be created.
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{marginTop:"1.1rem",display:"flex",justifyContent:"flex-end",gap:10}}>
          {editTarget && <button className="btn btn-outline" onClick={cancelEdit}>Cancel</button>}
          <button
            className="btn btn-approve"
            style={{opacity:cleanDates.length===0?.5:1}}
            disabled={cleanDates.length===0}
            onClick={handleBook}
          >
            {editTarget
              ? `💾 Update Series`
              : form.pattern==="once"
                ? "📌 Assign Room Now"
                : `📌 Book ${cleanDates.length||""} Session${cleanDates.length!==1?"s":""}`
            }
          </button>
        </div>
      </div>

      {/* ══════ SERIES LIST ══════ */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:".75rem"}}>
        <div style={{fontWeight:600,fontSize:".85rem",color:"var(--slate)"}}>
          EXISTING DIRECT BOOKINGS
          <span style={{background:"var(--navy)",color:"white",borderRadius:10,padding:"1px 8px",fontSize:".72rem",marginLeft:6}}>{directBookings.length}</span>
          <span style={{color:"#94a3b8",fontWeight:400,fontSize:".78rem",marginLeft:8}}>in {seriesList.length} series</span>
        </div>
      </div>

      {seriesList.length===0 ? (
        <div className="empty" style={{padding:"1.5rem"}}>
          <div className="empty-icon">📌</div>
          <p>No direct bookings yet. Use the form above to assign rooms.</p>
        </div>
      ) : (
        seriesList.map(({seriesId, bookings}) => {
          const first    = bookings[0];
          const last     = bookings[bookings.length-1];
          const room     = rooms.find(r=>r.id===first.assignedRoom);
          const isMulti  = bookings.length > 1;
          const expanded = expandedSeries[seriesId];
          const pattern  = first.recurrencePattern||"once";

          return (
            <div key={seriesId} className="booking-card">
              <div className="booking-card-header">
                <div style={{flex:1,minWidth:0}}>
                  <div className="booking-card-title">{first.course}</div>
                  <div className="booking-card-meta">
                    {first.professorName}
                    {first.department&&` · ${first.department}`}
                    {first.professorEmail&&<span style={{color:"#94a3b8"}}> · {first.professorEmail}</span>}
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,flexShrink:0}}>
                  <div className="booking-room-badge">{room?.name||first.assignedRoom}</div>
                  {isMulti && (
                    <span style={{background:"#ede9fe",color:"#7c3aed",padding:"2px 8px",borderRadius:10,fontSize:".71rem",fontWeight:700}}>
                      🔁 {RECUR_LABELS[pattern]||pattern} · {bookings.length} sessions
                    </span>
                  )}
                </div>
              </div>

              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:".45rem"}}>
                <span className="chip">🕐 {fmt12(first.startTime)} – {fmt12(first.endTime)}</span>
                {isMulti ? (
                  <>
                    <span className="chip">📅 {fmtDate(first.date)} → {fmtDate(last.date)}</span>
                    {needsDays && first.recurrencePattern && (
                      <span className="chip">
                        {[...new Set(bookings.map(b=>DAY_LABELS[new Date(b.date+"T12:00:00").getDay()]))].join(" · ")}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="chip">📅 {fmtDate(first.date)}</span>
                )}
                {room&&<span className="chip">🏛 {room.building}</span>}
                <span className="chip" style={{background:"#f0fdf4",borderColor:"#86efac",color:"#15803d"}}>📌 Direct</span>
                {first.reviewedBy&&<span className="chip">👤 by {first.reviewedBy}</span>}
              </div>

              {first.notes&&<div style={{marginTop:".4rem",fontSize:".79rem",color:"#64748b",fontStyle:"italic"}}>💬 {first.notes}</div>}

              {/* Expandable dates list */}
              {isMulti && (
                <div style={{marginTop:".6rem"}}>
                  <button
                    onClick={()=>setExpandedSeries(s=>({...s,[seriesId]:!s[seriesId]}))}
                    style={{background:"none",border:"none",cursor:"pointer",color:"var(--navy-mid)",fontSize:".79rem",fontWeight:600,padding:0,display:"flex",alignItems:"center",gap:5}}
                  >
                    {expanded?"▲ Hide":"▼ Show"} all {bookings.length} dates
                  </button>
                  {expanded && (
                    <div style={{marginTop:".5rem",display:"flex",flexWrap:"wrap",gap:5}}>
                      {bookings.map(b=>(
                        <span key={b.id} style={{padding:"2px 9px",borderRadius:5,fontSize:".74rem",fontWeight:600,background:"#dcfce7",color:"#15803d",border:"1px solid #86efac"}}>
                          {new Date(b.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",weekday:"short"})}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{marginTop:".75rem",display:"flex",gap:8,flexWrap:"wrap"}}>
                <button className="btn btn-outline btn-sm" onClick={()=>startEdit(seriesId)}>✏️ Edit {isMulti?"Series":"Booking"}</button>
                <button className="btn-danger-sm" onClick={()=>setDeleteSeries({seriesId,count:bookings.length,name:first.course})}>
                  🗑 Remove {isMulti?`All ${bookings.length} Sessions`:"Booking"}
                </button>
              </div>
              <div style={{marginTop:".4rem",fontSize:".7rem",color:"#94a3b8"}}>Created {new Date(first.submittedAt).toLocaleString()}</div>
            </div>
          );
        })
      )}

      {/* Delete series confirm */}
      {deleteSeries && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setDeleteSeries(null)}>
          <div className="modal" style={{maxWidth:420}}>
            <div className="modal-title">Remove Booking Series?</div>
            <p style={{color:"#64748b",fontSize:".9rem",lineHeight:1.6}}>
              This will remove <strong>all {deleteSeries.count} session{deleteSeries.count!==1?"s":""}</strong> of
              "{deleteSeries.name}" from the schedule. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn btn-outline btn-sm" onClick={()=>setDeleteSeries(null)}>Cancel</button>
              <button className="btn btn-deny btn-sm" onClick={()=>confirmDeleteSeries(deleteSeries.seriesId)}>
                Remove All {deleteSeries.count} Sessions
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function CalendarView({ requests, rooms, admins, adminUser, emailConfig, schoolName, showToast, saveRequest, removeRequest, removeRequestsBySeries }) {
  const now = new Date();
  const [year, setYear]         = useState(now.getFullYear());
  const [month, setMonth]       = useState(now.getMonth());
  const [roomFilter, setRoomFilter] = useState("");
  const [dayDetail, setDayDetail]   = useState(null);
  const [approveModal, setApproveModal] = useState(null);
  const [editModal, setEditModal]       = useState(null);
  const [cancelModal, setCancelModal]   = useState(null);

  const prevMonth = () => { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); };
  const nextMonth = () => { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDay(year, month);
  const todayStr = now.toISOString().slice(0,10);

  const cells = [];
  for(let i=0;i<firstDay;i++) cells.push({blank:true,day:getDaysInMonth(year,month===0?11:month-1)-firstDay+1+i});
  for(let d=1;d<=daysInMonth;d++) cells.push({blank:false,day:d});
  const rem=(7-(cells.length%7))%7;
  for(let i=1;i<=rem;i++) cells.push({blank:true,day:i});

  const eventsForDay = d => {
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    return requests.filter(r=>r.date===ds&&r.status!=="denied"&&(roomFilter===""||r.assignedRoom===roomFilter||r.roomPref===roomFilter));
  };
  const openDay = d => {
    const ds=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    setDayDetail({dateStr:ds, events:requests.filter(r=>r.date===ds&&(roomFilter===""||r.assignedRoom===roomFilter||r.roomPref===roomFilter))});
  };
  const eventBg  = s=>s==="approved"?"#dcfce7":s==="pending"?"#fef9c3":"#fee2e2";
  const eventTxt = s=>s==="approved"?"#15803d":s==="pending"?"#92400e":"#b91c1c";

  const handleApprove = async (id, roomId) => {
    const req = requests.find(r=>r.id===id);
    const roomName = rooms.find(r=>r.id===roomId)?.name||roomId;
    await saveRequest({...req, status:"approved", assignedRoom:roomId, reviewedBy:adminUser.name});
    setApproveModal(null); setDayDetail(null);
    const result = await sendEmailNotification({emailConfig,req,status:"approved",assignedRoomName:roomName,schoolName,adminName:adminUser.name});
    if(result.ok) showToast(`Approved & email sent to ${req.professorEmail}`);
    else showToast("Approved ✓ — configure email in Settings to notify professors","warn");
  };
  const handleDeny = async (id) => {
    const req = requests.find(r=>r.id===id);
    await saveRequest({...req, status:"denied", assignedRoom:null, reviewedBy:adminUser.name});
    setDayDetail(null);
    const result = await sendEmailNotification({emailConfig,req,status:"denied",assignedRoomName:"",schoolName,adminName:adminUser.name});
    if(result.ok) showToast(`Denied — email sent to ${req.professorEmail}`);
    else showToast("Denied ✓","warn");
  };
  const handleEdit = async (id, changes) => {
    const req = requests.find(r=>r.id===id);
    await saveRequest({...req,...changes});
    setEditModal(null); setDayDetail(null);
    showToast("Booking updated successfully");
  };
  const handleCancelReservation = async (id) => {
    await removeRequest(id);
    setCancelModal(null); setDayDetail(null);
    showToast("Reservation cancelled and removed");
  };

  return (
    <div className="main">
      <div className="card">
        <div className="cal-nav">
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <div className="cal-month-label">{MONTHS[month]} {year}</div>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>
        <div className="cal-filter-row">
          <select className="form-select" value={roomFilter} onChange={e=>setRoomFilter(e.target.value)}>
            <option value="">All Rooms</option>
            {rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div style={{display:"flex",gap:10,fontSize:".77rem",color:"var(--slate)",alignItems:"center",flexWrap:"wrap"}}>
            {[["#dcfce7","#15803d","Approved"],["#fef9c3","#92400e","Pending"],["#fee2e2","#b91c1c","Denied"]].map(([bg,c,l])=>(
              <span key={l} style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{width:10,height:10,borderRadius:2,background:bg,border:`1px solid ${c}`,display:"inline-block"}}/>
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="cal-grid">
          {DAYS.map(d=><div key={d} className="cal-day-header">{d}</div>)}
          {cells.map((cell,i)=>{
            const evts=cell.blank?[]:eventsForDay(cell.day);
            const ds=!cell.blank?`${year}-${String(month+1).padStart(2,"0")}-${String(cell.day).padStart(2,"0")}`:"";
            return (
              <div key={i} className={`cal-cell ${cell.blank?"other-month":""} ${ds===todayStr?"today":""}`} onClick={()=>!cell.blank&&openDay(cell.day)}>
                <div className="cal-date-num">{cell.day}</div>
                {evts.slice(0,3).map(ev=>(
                  <div key={ev.id} className="cal-event-dot" style={{background:eventBg(ev.status),color:eventTxt(ev.status)}}>
                    {fmt12(ev.startTime)} {ev.course.split(" ").slice(0,3).join(" ")}
                  </div>
                ))}
                {evts.length>3&&<div className="cal-more">+{evts.length-3} more</div>}
              </div>
            );
          })}
        </div>
      </div>
      {dayDetail && (
        <div className="day-detail-overlay" onClick={e=>e.target===e.currentTarget&&setDayDetail(null)}>
          <div className="modal" style={{maxWidth:620}}>
            <div className="modal-title">📅 {fmtDate(dayDetail.dateStr)}</div>
            {dayDetail.events.length===0
              ? <div className="empty" style={{padding:"1.5rem"}}><div className="empty-icon">✨</div><p>No bookings on this day.</p></div>
              : dayDetail.events.sort((a,b)=>a.startTime.localeCompare(b.startTime)).map(ev=>(
                  <ReqCard key={ev.id} req={ev} rooms={rooms} isAdmin={true}
                    onApprove={()=>{ setApproveModal(ev); }}
                    onDeny={()=>handleDeny(ev.id)}
                    onEdit={()=>{ setEditModal(ev); setDayDetail(null); }}
                    onCancel={()=>{ setCancelModal(ev); setDayDetail(null); }}
                  />
                ))
            }
            <div className="modal-actions"><button className="btn btn-outline btn-sm" onClick={()=>setDayDetail(null)}>Close</button></div>
          </div>
        </div>
      )}
      {approveModal && <AssignModal req={approveModal} rooms={rooms} requests={requests} onClose={()=>setApproveModal(null)} onApprove={handleApprove}/>}
      {editModal   && <EditBookingModal req={editModal} rooms={rooms} requests={requests} adminUser={adminUser} onClose={()=>setEditModal(null)} onSave={changes=>handleEdit(editModal.id,changes)}/>}
      {cancelModal && <CancelReservationModal req={cancelModal} rooms={rooms} onClose={()=>setCancelModal(null)} onConfirm={()=>handleCancelReservation(cancelModal.id)}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOM SIGNS
// ═══════════════════════════════════════════════════════════════════════════════
function SignView({ requests, rooms, clock, schoolName }) {
  const today = clock.toISOString().slice(0,10);
  const nowMins = clock.getHours()*60+clock.getMinutes();
  const toMins = t=>parseInt(t)*60+parseInt(t.split(":")[1]);
  return (
    <div className="sign-view">
      <div className="sign-header">
        <div>
          <h2>🎓 {schoolName} — Room Status</h2>
          <div style={{color:"rgba(255,255,255,.6)",fontSize:".79rem"}}>{clock.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
        </div>
        <div className="sign-clock">{clock.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"})}</div>
      </div>
      {rooms.length===0
        ? <div style={{color:"rgba(255,255,255,.4)",textAlign:"center",padding:"4rem",fontSize:"1rem"}}>No rooms configured — go to ⚙️ Settings.</div>
        : <div className="sign-grid">
            {rooms.map(room=>{
              const evts=requests.filter(r=>r.status==="approved"&&r.assignedRoom===room.id&&r.date===today).sort((a,b)=>a.startTime.localeCompare(b.startTime));
              const cur=evts.find(r=>nowMins>=toMins(r.startTime)&&nowMins<toMins(r.endTime));
              const nxt=!cur&&evts.find(r=>toMins(r.startTime)>nowMins);
              const occ=!!cur;
              return (
                <div key={room.id} className="sign-card" style={{background:occ?"linear-gradient(135deg,#7f1d1d,#991b1b)":"linear-gradient(135deg,#064e3b,#065f46)",borderColor:occ?"#f87171":"#34d399"}}>
                  <div className="sign-card-header">
                    <div><div className="sign-room-name">{room.name}</div><div className="sign-room-info">{room.building} · {room.type} · Cap. {room.capacity}</div></div>
                    <div className="sign-status-dot" style={{background:occ?"#f87171":"#34d399"}}/>
                  </div>
                  <div className="sign-card-body">
                    {cur?(<>
                      <div style={{display:"inline-block",background:"rgba(248,113,113,.25)",color:"#fca5a5",padding:"2px 10px",borderRadius:20,fontSize:".72rem",fontWeight:700,marginBottom:7}}>IN USE</div>
                      <div className="sign-event-title">{cur.course}</div><div className="sign-event-prof">{cur.professorName}</div>
                      <div className="sign-event-time">{fmt12(cur.startTime)} – {fmt12(cur.endTime)}</div>
                    </>):nxt?(<>
                      <div style={{display:"inline-block",background:"rgba(52,211,153,.2)",color:"#6ee7b7",padding:"2px 10px",borderRadius:20,fontSize:".72rem",fontWeight:700,marginBottom:7}}>AVAILABLE</div>
                      <div className="sign-vacant">Next: {nxt.course}</div>
                      <div className="sign-event-time" style={{textAlign:"center"}}>{fmt12(nxt.startTime)} – {fmt12(nxt.endTime)}</div>
                    </>):(<>
                      <div style={{display:"inline-block",background:"rgba(52,211,153,.2)",color:"#6ee7b7",padding:"2px 10px",borderRadius:20,fontSize:".72rem",fontWeight:700,marginBottom:7}}>AVAILABLE</div>
                      <div className="sign-vacant">No events scheduled today</div>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
function Settings({ rooms, schoolName, admins, emailConfig, setSchoolName, setEmailConfig, showToast, saveRoom, removeRoom, saveAdmin, removeAdmin }) {
  const [tab, setTab] = useState("email");
  const [nameInput, setNameInput] = useState(schoolName);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [editRoom, setEditRoom] = useState(null);
  const [deleteRoom, setDeleteRoom] = useState(null);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [editAdmin, setEditAdmin] = useState(null);
  const [deleteAdmin, setDeleteAdmin] = useState(null);
  const [emailCfg, setEmailCfg] = useState({...emailConfig});
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [copied, setCopied] = useState("");

  const saveEmail = async () => { await setEmailConfig(emailCfg); showToast("Email settings saved"); };

  const testConnection = async () => {
    if(!testEmail||!testEmail.includes("@")){ alert("Enter a valid test email address."); return; }
    setTesting(true);
    const fakeReq = { professorName:"Test Professor", professorEmail:testEmail, course:"TEST 101 - Test Course", department:"Test Dept", date:"2026-04-01", startTime:"10:00", endTime:"11:00", notes:"This is a test notification." };
    const result = await sendEmailNotification({emailConfig:emailCfg,req:fakeReq,status:"approved",assignedRoomName:"Test Room 101",schoolName,adminName:"System Test"});
    setTesting(false);
    if(result.ok) showToast(`Test email sent successfully to ${testEmail}`);
    else showToast(`Test failed: ${result.reason}. Check your EmailJS credentials.`,"error");
  };

  const copyVar = (v) => { navigator.clipboard?.writeText(v); setCopied(v); setTimeout(()=>setCopied(""),1500); };

  const emailReady = emailCfg.serviceId && emailCfg.publicKey && emailCfg.templateIdApprove && emailCfg.templateIdDeny;
  const emailStatus = !emailCfg.enabled ? "off" : !emailReady ? "partial" : "on";

  const templateVars = ["{{to_name}}","{{to_email}}","{{course_name}}","{{department}}","{{event_date}}","{{start_time}}","{{end_time}}","{{room_name}}","{{status}}","{{reviewed_by}}","{{school_name}}","{{notes}}"];

  return (
    <div className="main">
      <div className="tab-bar">
        <button className={`tab-btn ${tab==="email"?"active":""}`} onClick={()=>setTab("email")}>📧 Email Notifications</button>
        <button className={`tab-btn ${tab==="admins"?"active":""}`} onClick={()=>setTab("admins")}>👥 Admins</button>
        <button className={`tab-btn ${tab==="rooms"?"active":""}`} onClick={()=>setTab("rooms")}>🚪 Rooms</button>
        <button className={`tab-btn ${tab==="general"?"active":""}`} onClick={()=>setTab("general")}>🏫 General</button>
      </div>

      {/* ── EMAIL TAB ── */}
      {tab === "email" && (
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",paddingBottom:".75rem",borderBottom:"2px solid var(--cream-dark)"}}>
            <div className="card-title" style={{margin:0,border:"none",padding:0}}>📧 Email Notifications</div>
            <span className={`email-status ${emailStatus}`}>
              {emailStatus==="on"?"✓ Active":emailStatus==="partial"?"⚠ Incomplete":"✕ Off"}
            </span>
          </div>

          {/* How it works */}
          <div className="divider-label">How it works</div>
          <p style={{fontSize:".85rem",color:"var(--slate)",lineHeight:1.65,marginBottom:"1rem"}}>
            This app uses <strong>EmailJS</strong> — a free service that sends emails directly from the browser with no backend or server needed.
            Professors receive an email the moment their request is approved or denied. Setup takes about 10 minutes.
          </p>

          {/* Step by step */}
          <div className="divider-label">Setup Steps</div>
          {[
            { n:1, title:"Create a free EmailJS account", body: <>Go to <a href="https://www.emailjs.com" target="_blank" rel="noreferrer">emailjs.com</a> and sign up for free. The free tier allows <strong>200 emails/month</strong> — enough for most universities.</> },
            { n:2, title:"Connect your email service", body: <>In EmailJS dashboard → <strong>Email Services</strong> → Add New Service. Choose Gmail, Outlook, or your university's SMTP. Follow the connection wizard. Copy your <strong>Service ID</strong> (looks like <code>service_xxxxxxx</code>).</> },
            { n:3, title:"Create two email templates", body: <>Go to <strong>Email Templates</strong> → Create New Template. Make one for <strong>Approval</strong> and one for <strong>Denial</strong>. Use the template variables listed below. Copy each <strong>Template ID</strong> (looks like <code>template_xxxxxxx</code>).</> },
            { n:4, title:"Get your Public Key", body: <>In EmailJS dashboard → <strong>Account</strong> → API Keys. Copy your <strong>Public Key</strong>.</> },
            { n:5, title:"Paste your credentials below and save", body: <>Enter all four values below, toggle notifications ON, and click Save. Use the test button to verify before going live.</> },
          ].map(s=>(
            <div key={s.n} className="setup-step">
              <div className="step-num">{s.n}</div>
              <div className="step-body"><h4>{s.title}</h4><p>{s.body}</p></div>
            </div>
          ))}

          {/* Template Variables Reference */}
          <div className="divider-label">Template Variables for EmailJS</div>
          <p style={{fontSize:".82rem",color:"var(--slate)",marginBottom:".75rem"}}>Copy and paste these into your EmailJS email template. Click any variable to copy it.</p>
          <div className="template-box">
            <div style={{marginBottom:".5rem",color:"#94a3b8",fontSize:".74rem"}}>// Available variables — use in Subject, Body, or To field</div>
            {templateVars.map(v=>(
              <div key={v} style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
                <span className="template-var">{v}</span>
                <button className="copy-btn" onClick={()=>copyVar(v)}>{copied===v?"✓ copied":"copy"}</button>
              </div>
            ))}
          </div>
          <div style={{marginTop:".75rem",background:"#1e293b",borderRadius:10,padding:"1rem 1.2rem"}}>
            <div style={{color:"#94a3b8",fontSize:".74rem",marginBottom:".5rem"}}>// Example approval email body</div>
            <div style={{fontFamily:"monospace",fontSize:".78rem",color:"#e2e8f0",lineHeight:1.7}}>
              <div>Dear <span className="template-var">{"{{to_name}}"}</span>,</div>
              <div style={{marginTop:6}}>Your room request for <span className="template-var">{"{{course_name}}"}</span> has been <span className="template-var">{"{{status}}"}</span>.</div>
              <div style={{marginTop:6}}>📅 Date: <span className="template-var">{"{{event_date}}"}</span></div>
              <div>🕐 Time: <span className="template-var">{"{{start_time}}"}</span> – <span className="template-var">{"{{end_time}}"}</span></div>
              <div>🚪 Room: <span className="template-var">{"{{room_name}}"}</span></div>
              <div style={{marginTop:6}}>Reviewed by <span className="template-var">{"{{reviewed_by}}"}</span></div>
              <div style={{marginTop:6}}>— <span className="template-var">{"{{school_name}}"}</span> Registrar's Office</div>
            </div>
          </div>

          {/* Credentials Form */}
          <div className="divider-label">Your EmailJS Credentials</div>
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Service ID</label>
              <input className="form-input" value={emailCfg.serviceId} onChange={e=>setEmailCfg(c=>({...c,serviceId:e.target.value}))} placeholder="service_xxxxxxx"/>
            </div>
            <div className="form-group">
              <label className="form-label">Public Key</label>
              <input className="form-input" value={emailCfg.publicKey} onChange={e=>setEmailCfg(c=>({...c,publicKey:e.target.value}))} placeholder="Your EmailJS public key"/>
            </div>
            <div className="form-group">
              <label className="form-label">Approval Template ID</label>
              <input className="form-input" value={emailCfg.templateIdApprove} onChange={e=>setEmailCfg(c=>({...c,templateIdApprove:e.target.value}))} placeholder="template_xxxxxxx"/>
              <span className="form-hint">Sent when a request is approved</span>
            </div>
            <div className="form-group">
              <label className="form-label">Denial Template ID</label>
              <input className="form-input" value={emailCfg.templateIdDeny} onChange={e=>setEmailCfg(c=>({...c,templateIdDeny:e.target.value}))} placeholder="template_xxxxxxx"/>
              <span className="form-hint">Sent when a request is denied</span>
            </div>
            <div className="form-group full" style={{flexDirection:"row",alignItems:"center",gap:12,background:"var(--cream)",padding:".85rem 1rem",borderRadius:8,border:"1px solid var(--border)"}}>
              <input type="checkbox" id="emailEnabled" checked={emailCfg.enabled} onChange={e=>setEmailCfg(c=>({...c,enabled:e.target.checked}))} style={{width:18,height:18,cursor:"pointer"}}/>
              <label htmlFor="emailEnabled" style={{cursor:"pointer",fontWeight:600,color:"var(--navy)",fontSize:".9rem"}}>
                Enable email notifications — professors receive emails on approval/denial
              </label>
            </div>
          </div>
          <div style={{display:"flex",gap:10,marginTop:"1.25rem",flexWrap:"wrap",alignItems:"center"}}>
            <button className="btn btn-primary" onClick={saveEmail}>💾 Save Email Settings</button>
            <div style={{display:"flex",gap:8,alignItems:"center",flex:1,minWidth:240}}>
              <input className="form-input" style={{flex:1}} type="email" value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="test@email.com — send a test email"/>
              <button className="btn btn-outline" onClick={testConnection} disabled={testing||!emailCfg.serviceId}>
                {testing?"Sending…":"🧪 Send Test"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADMINS TAB ── */}
      {tab === "admins" && (
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",paddingBottom:".75rem",borderBottom:"2px solid var(--cream-dark)"}}>
            <span className="card-title" style={{margin:0,border:"none",padding:0}}>👥 Admin Accounts</span>
            <button className="btn btn-gold btn-sm" onClick={()=>setShowAddAdmin(true)}>+ Add Admin</button>
          </div>
          <div className="info-box">All {admins.length} admins see every new request simultaneously. Any admin can approve or deny.</div>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Email / Login</th><th>Role</th><th style={{width:130}}>Actions</th></tr></thead>
            <tbody>
              {admins.map(a=>(
                <tr key={a.id}>
                  <td><strong>{a.name}</strong></td>
                  <td style={{color:"var(--slate)",fontSize:".83rem"}}>{a.email}</td>
                  <td><span className="pill">{a.role}</span></td>
                  <td><div style={{display:"flex",gap:6}}><button className="btn btn-outline btn-sm" onClick={()=>setEditAdmin(a)}>Edit</button><button className="btn-danger-sm" onClick={()=>setDeleteAdmin(a)}>Remove</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(showAddAdmin||editAdmin)&&<AdminModal admin={editAdmin} existingEmails={admins.map(a=>a.email)} onClose={()=>{setShowAddAdmin(false);setEditAdmin(null);}} onSave={async a=>{if(editAdmin){await saveAdmin(a);showToast("Admin updated");}else{await saveAdmin(a);showToast("Admin added");} setShowAddAdmin(false);setEditAdmin(null);}}/>}
          {deleteAdmin&&<ConfirmModal title="Remove Admin" message={`Remove "${deleteAdmin.name}"? They'll lose login access.`} onConfirm={async ()=>{await removeAdmin(deleteAdmin.id);setDeleteAdmin(null);showToast("Admin removed");}} onCancel={()=>setDeleteAdmin(null)}/>}
        </div>
      )}

      {/* ── ROOMS TAB ── */}
      {tab === "rooms" && (
        <div className="card">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem",paddingBottom:".75rem",borderBottom:"2px solid var(--cream-dark)"}}>
            <span className="card-title" style={{margin:0,border:"none",padding:0}}>🚪 Manage Rooms</span>
            <button className="btn btn-gold btn-sm" onClick={()=>setShowAddRoom(true)}>+ Add Room</button>
          </div>
          {rooms.length===0
            ? <div className="empty"><div className="empty-icon">🏫</div><p>No rooms yet. Add your first room.</p></div>
            : <table className="data-table">
                <thead><tr><th>Room Name</th><th>Building</th><th>Type</th><th>Cap.</th><th>ID</th><th style={{width:130}}>Actions</th></tr></thead>
                <tbody>
                  {rooms.map(r=>(
                    <tr key={r.id}>
                      <td><strong>{r.name}</strong></td><td style={{color:"var(--slate)"}}>{r.building}</td>
                      <td><span className="pill">{r.type}</span></td><td style={{color:"var(--slate)"}}>{r.capacity}</td>
                      <td style={{fontFamily:"monospace",fontSize:".79rem",color:"#94a3b8"}}>{r.id}</td>
                      <td><div style={{display:"flex",gap:6}}><button className="btn btn-outline btn-sm" onClick={()=>setEditRoom(r)}>Edit</button><button className="btn-danger-sm" onClick={()=>setDeleteRoom(r)}>Remove</button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
          {(showAddRoom||editRoom)&&<RoomModal room={editRoom} existingIds={rooms.map(r=>r.id)} onClose={()=>{setShowAddRoom(false);setEditRoom(null);}} onSave={async r=>{if(editRoom){await saveRoom(r);showToast("Room updated");}else{await saveRoom(r);showToast("Room added");} setShowAddRoom(false);setEditRoom(null);}}/>}
          {deleteRoom&&<ConfirmModal title="Remove Room" message={`Remove "${deleteRoom.name}"?`} onConfirm={async ()=>{await removeRoom(deleteRoom.id);setDeleteRoom(null);showToast("Room removed");}} onCancel={()=>setDeleteRoom(null)}/>}
        </div>
      )}

      {/* ── GENERAL TAB ── */}
      {tab === "general" && (
        <div className="card">
          <div className="card-title">🏫 General Settings</div>
          <div className="divider-label">Institution Name</div>
          <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
            <div className="form-group" style={{flex:1,minWidth:240}}>
              <label className="form-label">University or College Name</label>
              <input className="form-input" value={nameInput} onChange={e=>setNameInput(e.target.value)} onKeyDown={async e=>{if(e.key==="Enter"){await setSchoolName(nameInput.trim());showToast("School name updated");}}} placeholder="e.g. Florida State University"/>
            </div>
            <button className="btn btn-primary" onClick={async ()=>{await setSchoolName(nameInput.trim());showToast("School name updated");}}>Save Name</button>
          </div>
          <p style={{marginTop:".6rem",fontSize:".8rem",color:"#94a3b8"}}>Appears in the nav bar, Room Signs display, professor portal, and email notifications.</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════
function ReqCard({ req, rooms, isAdmin, onApprove, onDeny, onEdit, onCancel }) {
  const assigned = req.assignedRoom ? rooms.find(r=>r.id===req.assignedRoom) : null;
  const pref     = req.roomPref     ? rooms.find(r=>r.id===req.roomPref)     : null;
  const isApproved = req.status === "approved";
  return (
    <div className="req-card" style={isApproved ? {borderLeft:"3px solid #22c55e"} : {}}>
      <div className="req-card-header">
        <div>
          <div className="req-card-title">{req.course}</div>
          <div className="req-card-meta">
            {req.professorName}
            {req.professorEmail&&<span style={{color:"#94a3b8"}}> · {req.professorEmail}</span>}
            {req.department&&<span> · {req.department}</span>}
          </div>
        </div>
        <span className="badge" style={{color:STATUS_COLORS[req.status],background:STATUS_BG[req.status]}}>{req.status}</span>
      </div>
      <div className="req-card-details">
        <span className="chip">📅 {fmtDate(req.date)}</span>
        <span className="chip">🕐 {fmt12(req.startTime)} – {fmt12(req.endTime)}</span>
        {pref&&!req.directBooking&&<span className="chip">🔖 Prefers: {pref.name}</span>}
        {assigned&&<span className="chip" style={{background:"#f0fdf4",borderColor:"#86efac"}}>✅ {assigned.name}</span>}
        {req.directBooking&&<span className="chip" style={{background:"#f0fdf4",borderColor:"#86efac",color:"#15803d"}}>📌 Direct</span>}
        {req.reviewedBy&&<span className="chip">👤 by {req.reviewedBy}</span>}
        {req.lastEditedBy&&<span className="chip" style={{background:"#fef9c3",borderColor:"#fde68a",color:"#92400e"}}>✏️ Edited by {req.lastEditedBy}</span>}
      </div>
      {req.notes&&<div style={{marginTop:".45rem",fontSize:".8rem",color:"#64748b",fontStyle:"italic"}}>💬 {req.notes}</div>}

      {/* Pending actions */}
      {isAdmin&&req.status==="pending"&&(
        <div className="req-actions">
          <button className="btn btn-sm btn-approve" onClick={onApprove}>✓ Approve & Assign</button>
          <button className="btn btn-sm btn-deny" onClick={onDeny}>✗ Deny</button>
        </div>
      )}

      {/* Approved actions — edit or cancel */}
      {isAdmin&&isApproved&&(
        <div className="req-actions">
          <button className="btn btn-sm btn-outline" onClick={onEdit} style={{gap:5}}>
            ✏️ Edit Booking
          </button>
          <button className="btn btn-sm" onClick={onCancel}
            style={{background:"transparent",color:"#dc2626",border:"1.5px solid #fca5a5",borderRadius:8,gap:5}}>
            ✕ Cancel Reservation
          </button>
        </div>
      )}

      <div style={{marginTop:".45rem",fontSize:".71rem",color:"#94a3b8"}}>Submitted {new Date(req.submittedAt).toLocaleString()}</div>
    </div>
  );
}

// ── Edit Booking Modal (change room, date, times, notes on an approved booking) ──
function EditBookingModal({ req, rooms, requests, adminUser, onClose, onSave }) {
  const [form, setForm] = useState({
    assignedRoom: req.assignedRoom || "",
    date:         req.date,
    startTime:    req.startTime,
    endTime:      req.endTime,
    notes:        req.notes || "",
  });
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const conflicts = form.assignedRoom && form.date && form.startTime && form.endTime
    ? requests.filter(r =>
        r.id !== req.id &&
        r.status === "approved" &&
        r.assignedRoom === form.assignedRoom &&
        r.date === form.date &&
        !(form.endTime <= r.startTime || form.startTime >= r.endTime)
      )
    : [];

  const changed =
    form.assignedRoom !== req.assignedRoom ||
    form.date         !== req.date         ||
    form.startTime    !== req.startTime    ||
    form.endTime      !== req.endTime      ||
    form.notes        !== (req.notes||"");

  const handleSave = () => {
    if (!form.assignedRoom||!form.date||!form.startTime||!form.endTime) {
      alert("Room, date, start time, and end time are required."); return;
    }
    if (form.startTime >= form.endTime) { alert("End time must be after start time."); return; }
    if (conflicts.length > 0) { alert("This room has a conflict at the new time. Please adjust."); return; }
    onSave({ ...form, lastEditedBy: adminUser.name, lastEditedAt: new Date().toISOString() });
  };

  const room = rooms.find(r=>r.id===form.assignedRoom);

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:580}}>
        <div className="modal-title">✏️ Edit Approved Booking</div>

        {/* Summary of original */}
        <div style={{background:"#f8f5ef",borderRadius:8,padding:".85rem 1rem",marginBottom:"1.25rem",border:"1px solid #e0d9ce"}}>
          <div style={{fontWeight:600,color:"#0f1f3d",fontSize:".93rem"}}>{req.course}</div>
          <div style={{color:"#64748b",fontSize:".82rem",marginTop:3}}>
            {req.professorName}
            {req.professorEmail && <> · <span style={{color:"#94a3b8"}}>{req.professorEmail}</span></>}
          </div>
          <div style={{color:"#94a3b8",fontSize:".78rem",marginTop:4}}>
            Original: {fmtDate(req.date)} · {fmt12(req.startTime)}–{fmt12(req.endTime)} · {rooms.find(r=>r.id===req.assignedRoom)?.name||req.assignedRoom}
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group full">
            <label className="form-label">Room</label>
            <select className="form-select" value={form.assignedRoom} onChange={e=>set("assignedRoom",e.target.value)}>
              <option value="">Select room…</option>
              {rooms.map(r=><option key={r.id} value={r.id}>{r.name} – {r.building} (cap. {r.capacity})</option>)}
            </select>
          </div>
          <div className="form-group full">
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={form.date} onChange={e=>set("date",e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">Start Time</label>
            <input className="form-input" type="time" value={form.startTime} onChange={e=>set("startTime",e.target.value)}/>
          </div>
          <div className="form-group">
            <label className="form-label">End Time</label>
            <input className="form-input" type="time" value={form.endTime} onChange={e=>set("endTime",e.target.value)}/>
          </div>
          <div className="form-group full">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" style={{minHeight:60}} value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Any updated setup notes…"/>
          </div>
        </div>

        {/* Conflict / availability feedback */}
        {form.assignedRoom && form.date && form.startTime && form.endTime && (
          conflicts.length > 0 ? (
            <div className="conflict-row" style={{marginTop:".75rem"}}>
              ⚠️ <strong>Conflict:</strong> {conflicts.map(c=>`"${c.course}" (${fmt12(c.startTime)}–${fmt12(c.endTime)})`).join(", ")} is already in this room.
            </div>
          ) : changed ? (
            <div className="avail-row" style={{marginTop:".75rem"}}>
              ✓ {room?.name} is available on {fmtDate(form.date)} from {fmt12(form.startTime)} to {fmt12(form.endTime)}.
            </div>
          ) : null
        )}

        {/* Change summary */}
        {changed && (
          <div style={{marginTop:".85rem",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:".7rem 1rem",fontSize:".81rem",color:"#92400e"}}>
            <strong>Changes summary:</strong>
            {form.date !== req.date && <div>📅 Date: {fmtDate(req.date)} → <strong>{fmtDate(form.date)}</strong></div>}
            {(form.startTime!==req.startTime||form.endTime!==req.endTime) && <div>🕐 Time: {fmt12(req.startTime)}–{fmt12(req.endTime)} → <strong>{fmt12(form.startTime)}–{fmt12(form.endTime)}</strong></div>}
            {form.assignedRoom!==req.assignedRoom && <div>🚪 Room: {rooms.find(r=>r.id===req.assignedRoom)?.name||req.assignedRoom} → <strong>{room?.name||form.assignedRoom}</strong></div>}
            {form.notes!==(req.notes||"") && <div>💬 Notes updated</div>}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!changed||conflicts.length>0}
            style={{opacity:(!changed||conflicts.length>0)?.5:1}}
            onClick={handleSave}
          >
            💾 Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cancel Reservation Modal ──
function CancelReservationModal({ req, rooms, onClose, onConfirm }) {
  const room = req.assignedRoom ? rooms.find(r=>r.id===req.assignedRoom) : null;
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{maxWidth:440}}>
        <div className="modal-title">✕ Cancel Reservation</div>
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:".85rem 1rem",marginBottom:"1.1rem"}}>
          <div style={{fontWeight:600,color:"#991b1b",fontSize:".93rem"}}>{req.course}</div>
          <div style={{color:"#b91c1c",fontSize:".82rem",marginTop:3}}>
            {req.professorName} · {fmtDate(req.date)} · {fmt12(req.startTime)}–{fmt12(req.endTime)}
            {room && <> · {room.name}</>}
          </div>
        </div>
        <p style={{color:"#64748b",fontSize:".88rem",lineHeight:1.6}}>
          This will <strong>cancel and remove</strong> this approved booking from the schedule.
          The room will become available for that time slot.
          {req.professorEmail && <> The professor (<strong>{req.professorEmail}</strong>) will <em>not</em> be automatically emailed — notify them manually if needed.</>}
        </p>
        <div className="modal-actions">
          <button className="btn btn-outline btn-sm" onClick={onClose}>Keep Booking</button>
          <button className="btn btn-deny btn-sm" onClick={onConfirm}>Cancel Reservation</button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ req, rooms, requests, onClose, onApprove }) {
  const [sel, setSel] = useState(req.roomPref||"");
  const conflicts = requests.filter(r=>r.id!==req.id&&r.status==="approved"&&r.assignedRoom===sel&&r.date===req.date&&!(req.endTime<=r.startTime||req.startTime>=r.endTime));
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-title">Approve & Assign Room</div>
        <div style={{background:"#f8f5ef",borderRadius:8,padding:".85rem 1rem",marginBottom:"1.25rem",border:"1px solid #e0d9ce"}}>
          <div style={{fontWeight:600,color:"#0f1f3d",fontSize:".93rem"}}>{req.course}</div>
          <div style={{color:"#64748b",fontSize:".82rem",marginTop:3}}>{req.professorName} · {fmtDate(req.date)} · {fmt12(req.startTime)} – {fmt12(req.endTime)}</div>
          {req.professorEmail&&<div style={{color:"#94a3b8",fontSize:".79rem",marginTop:3}}>📧 Email will be sent to: {req.professorEmail}</div>}
        </div>
        <div className="form-group">
          <label className="form-label">Select Room</label>
          <select className="form-select" value={sel} onChange={e=>setSel(e.target.value)}>
            <option value="">Choose a room…</option>
            {rooms.map(r=><option key={r.id} value={r.id}>{r.name} – {r.building} (cap. {r.capacity})</option>)}
          </select>
        </div>
        {sel&&conflicts.length>0&&<div style={{marginTop:".75rem",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:".75rem",fontSize:".82rem",color:"#b91c1c"}}>⚠️ Conflict: <strong>{conflicts[0].course}</strong> is already booked here.</div>}
        {sel&&conflicts.length===0&&<div style={{marginTop:".75rem",background:"#f0fdf4",border:"1px solid #86efac",borderRadius:8,padding:".75rem",fontSize:".82rem",color:"#15803d"}}>✓ No conflicts — slot is free.</div>}
        <div className="modal-actions">
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-approve btn-sm" disabled={!sel||conflicts.length>0} style={{opacity:!sel||conflicts.length>0?.5:1}} onClick={()=>onApprove(req.id,sel)}>
            Confirm & Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminModal({ admin, existingEmails, onClose, onSave }) {
  const [form, setForm] = useState(admin?{...admin}:{id:"A"+Date.now(),name:"",email:"",role:"Registrar",password:""});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const handle=()=>{
    if(!form.name.trim()){alert("Name required.");return;}
    if(!form.email.includes("@")){alert("Valid email required.");return;}
    if(!admin&&existingEmails.includes(form.email.toLowerCase())){alert("Email already in use.");return;}
    if(!form.password||form.password.length<4){alert("Password must be at least 4 characters.");return;}
    onSave({...form});
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-title">{admin?"✏️ Edit Admin":"👤 Add Admin Account"}</div>
        <div className="form-grid">
          <div className="form-group full"><label className="form-label">Full Name *</label><input className="form-input" value={form.name} onChange={e=>set("name",e.target.value)} placeholder="Dr. Patricia Reynolds"/></div>
          <div className="form-group full"><label className="form-label">Email / Login *</label><input className="form-input" type="email" value={form.email} onChange={e=>set("email",e.target.value)} placeholder="name@university.edu"/></div>
          <div className="form-group"><label className="form-label">Role</label><input className="form-input" value={form.role} onChange={e=>set("role",e.target.value)} placeholder="e.g. Registrar"/></div>
          <div className="form-group"><label className="form-label">Password *</label><input className="form-input" type="password" value={form.password} onChange={e=>set("password",e.target.value)} placeholder="Set a password"/></div>
        </div>
        <div className="modal-actions"><button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-primary btn-sm" onClick={handle}>{admin?"Save Changes":"Add Admin"}</button></div>
      </div>
    </div>
  );
}

function RoomModal({ room, existingIds, onClose, onSave }) {
  const [form, setForm] = useState(room?{...room,capacity:String(room.capacity)}:{id:"",name:"",building:"",type:"Classroom",capacity:""});
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const autoId=()=>{if(!room&&!form.id&&form.name)set("id",form.name.replace(/[^a-zA-Z0-9]/g,"").toUpperCase().slice(0,6));};
  const handle=()=>{
    if(!form.name.trim()){alert("Room name required.");return;}
    if(!form.building.trim()){alert("Building required.");return;}
    if(!form.id.trim()){alert("Room ID required.");return;}
    if(!room&&existingIds.includes(form.id.trim().toUpperCase())){alert("ID already in use.");return;}
    if(!form.capacity||isNaN(form.capacity)||Number(form.capacity)<1){alert("Valid capacity required.");return;}
    onSave({...form,id:room?form.id:form.id.trim().toUpperCase(),capacity:Number(form.capacity)});
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-title">{room?"✏️ Edit Room":"🚪 Add New Room"}</div>
        <div className="form-grid">
          <div className="form-group full"><label className="form-label">Room Name *</label><input className="form-input" value={form.name} onChange={e=>set("name",e.target.value)} onBlur={autoId} placeholder="e.g. Room 201"/></div>
          <div className="form-group full"><label className="form-label">Building *</label><input className="form-input" value={form.building} onChange={e=>set("building",e.target.value)} placeholder="e.g. Science Hall"/></div>
          <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={form.type} onChange={e=>set("type",e.target.value)}>{ROOM_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
          <div className="form-group"><label className="form-label">Capacity *</label><input className="form-input" type="number" min="1" value={form.capacity} onChange={e=>set("capacity",e.target.value)} placeholder="30"/></div>
          <div className="form-group full"><label className="form-label">Room ID * {!room&&<span style={{fontWeight:400,textTransform:"none",fontSize:".74rem",color:"#94a3b8",letterSpacing:0}}>(auto-filled)</span>}</label><input className="form-input" value={form.id} disabled={!!room} onChange={e=>set("id",e.target.value.toUpperCase().replace(/\s/g,""))} placeholder="e.g. R201"/></div>
        </div>
        <div className="modal-actions"><button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button><button className="btn btn-primary btn-sm" onClick={handle}>{room?"Save Changes":"Add Room"}</button></div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div className="modal" style={{maxWidth:400}}>
        <div className="modal-title">{title}</div>
        <p style={{color:"#64748b",fontSize:".9rem",lineHeight:1.6}}>{message}</p>
        <div className="modal-actions"><button className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button><button className="btn btn-deny btn-sm" onClick={onConfirm}>Confirm</button></div>
      </div>
    </div>
  );
}

