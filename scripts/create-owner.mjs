#!/usr/bin/env node
/**
 * Oppretter (eller registrerer) eierkontoen.
 *
 *   node --env-file=.env.local scripts/create-owner.mjs eier@myhrtreogdesign.com
 *
 * Passordet leses fra terminalen (vises ikke og havner ikke i shell-historikken).
 * Krever NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY.
 * E-posten må også stå i OWNER_EMAILS.
 */
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";

const email = (process.argv[2] ?? "").trim().toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !email.includes("@")) {
  console.error("Bruk: node --env-file=.env.local scripts/create-owner.mjs <e-post>");
  process.exit(1);
}
if (!url || !key) {
  console.error("Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const owners = (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
if (!owners.includes(email)) console.warn(`Advarsel: ${email} står ikke i OWNER_EMAILS – innlogging vil bli avvist til den legges til.`);

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : "");
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let userId;
const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
const existing = list.users.find((u) => u.email?.toLowerCase() === email);

if (existing) {
  userId = existing.id;
  console.log(`Fant eksisterende bruker ${email}.`);
} else {
  const password = await askHidden("Velg passord (minst 12 tegn): ");
  if (password.length < 12) {
    console.error("Passordet må ha minst 12 tegn.");
    process.exit(1);
  }
  const again = await askHidden("Gjenta passord: ");
  if (again !== password) {
    console.error("Passordene er ikke like.");
    process.exit(1);
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Opprettet bruker ${email}.`);
}

const { error: insErr } = await admin.from("users").upsert({ id: userId, email, role: "owner" });
if (insErr) throw insErr;
console.log("Brukeren er registrert som eier. Du kan nå logge inn.");
