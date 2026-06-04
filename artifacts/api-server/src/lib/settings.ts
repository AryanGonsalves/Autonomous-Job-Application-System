import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULTS: Record<string, string> = {
  keywords: JSON.stringify(["data analyst", "data scientist", "business analyst", "analytics engineer"]),
  avoidKeywords: JSON.stringify(["senior", "lead", "principal", "staff", "director", "manager", "head of", "vp", "vice president"]),
  locationPreference: "United States",
  dailyLimit: "100",
  contactEmail: "",
  contactPhone: "",
  openaiApiKey: "",
  linkedinEmail: "",
  linkedinPassword: "",
  indeedEmail: "",
  indeedPassword: "",
  handshakeAsuEmail: "",
  handshakeAsuPassword: "",
  imapGmailEmail: "",
  imapGmailAppPassword: "",
  imapYahooEmail: "",
  imapYahooAppPassword: "",
  // When "true", confirmation emails in the Sent folder are imported as manual
  // application records. Off by default to avoid mixing manual applies with the
  // bot's own applications.
  importManualFromSent: "false",
  enableLinkedin: "true",
  enableIndeed: "true",
  enableGreenhouse: "true",
  enableLever: "true",
  enableHandshake: "false",
  enableResumeTailoring: "false",
  scheduledTime: "08:00",
  schedulerSlot1: "08:00",
  schedulerSlot2: "",
  schedulerSlot3: "",
};

export async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (row) return row.value;
  return DEFAULTS[key] ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value } });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function parseSettings(raw: Record<string, string>) {
  return {
    contactEmail: raw.contactEmail || null,
    contactPhone: raw.contactPhone || null,
    keywords: JSON.parse(raw.keywords || "[]") as string[],
    avoidKeywords: JSON.parse(raw.avoidKeywords || "[]") as string[],
    locationPreference: raw.locationPreference || "Remote",
    dailyLimit: parseInt(raw.dailyLimit || "100", 10),
    openaiApiKey: raw.openaiApiKey || null,
    linkedinEmail: raw.linkedinEmail || null,
    linkedinPassword: raw.linkedinPassword || null,
    indeedEmail: raw.indeedEmail || null,
    indeedPassword: raw.indeedPassword || null,
    handshakeAsuEmail: raw.handshakeAsuEmail || null,
    handshakeAsuPassword: raw.handshakeAsuPassword || null,
    imapGmailEmail: raw.imapGmailEmail || null,
    imapGmailAppPassword: raw.imapGmailAppPassword || null,
    imapYahooEmail: raw.imapYahooEmail || null,
    imapYahooAppPassword: raw.imapYahooAppPassword || null,
    enableLinkedin: raw.enableLinkedin === "true",
    enableIndeed: raw.enableIndeed === "true",
    enableGreenhouse: raw.enableGreenhouse === "true",
    enableLever: raw.enableLever === "true",
    enableHandshake: raw.enableHandshake === "true",
    enableResumeTailoring: raw.enableResumeTailoring === "true",
    scheduledTime: raw.scheduledTime || "08:00",
    schedulerSlot1: raw.schedulerSlot1 || "08:00",
    schedulerSlot2: raw.schedulerSlot2 || null,
    schedulerSlot3: raw.schedulerSlot3 || null,
  };
}
