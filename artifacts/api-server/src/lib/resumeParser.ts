import * as fs from "fs";
import * as path from "path";

// pdf-parse v2 uses pdfjs-dist which requires DOMMatrix — a browser-only API.
// Polyfill it for Node.js so text extraction works without a browser environment.
if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;
    constructor(_init?: string | number[]) {}
    multiply(_other?: any) { return new (globalThis as any).DOMMatrix(); }
    translate(_tx = 0, _ty = 0, _tz = 0) { return new (globalThis as any).DOMMatrix(); }
    scale(_sx = 1, _sy?: number, _sz = 1, _ox = 0, _oy = 0, _oz = 0) { return new (globalThis as any).DOMMatrix(); }
    rotate(_rx = 0, _ry?: number, _rz?: number) { return new (globalThis as any).DOMMatrix(); }
    rotateAxisAngle(_x = 0, _y = 0, _z = 0, _angle = 0) { return new (globalThis as any).DOMMatrix(); }
    skewX(_sx = 0) { return new (globalThis as any).DOMMatrix(); }
    skewY(_sy = 0) { return new (globalThis as any).DOMMatrix(); }
    flipX() { return new (globalThis as any).DOMMatrix(); }
    flipY() { return new (globalThis as any).DOMMatrix(); }
    inverse() { return new (globalThis as any).DOMMatrix(); }
    transformPoint(p?: any) { return { x: p?.x ?? 0, y: p?.y ?? 0, z: p?.z ?? 0, w: p?.w ?? 1 }; }
    toFloat32Array() { return new Float32Array(6); }
    toFloat64Array() { return new Float64Array(16); }
    toString() { return "matrix(1, 0, 0, 1, 0, 0)"; }
    static fromMatrix(other?: any) { return new (globalThis as any).DOMMatrix(); }
    static fromFloat32Array(_a: Float32Array) { return new (globalThis as any).DOMMatrix(); }
    static fromFloat64Array(_a: Float64Array) { return new (globalThis as any).DOMMatrix(); }
  };
}

export interface ParsedResume {
  name: string;
  email: string;
  phone: string | null;
  linkedinUrl: string | null;
  summary: string | null;
  experience: WorkExperience[];
  education: Education[];
  skills: string[];
  projects: string[];
}

export interface WorkExperience {
  title: string;
  company: string;
  dates: string;
  bullets: string[];
}

export interface Education {
  degree: string;
  institution: string;
  year: string | null;
}

export async function parseResume(filePath: string, mimeType: string): Promise<{ rawText: string; parsed: ParsedResume }> {
  let rawText = "";

  if (mimeType === "application/pdf" || filePath.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    rawText = data.text;
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filePath.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    rawText = result.value;
  } else {
    rawText = fs.readFileSync(filePath, "utf-8");
  }

  const parsed = extractStructuredData(rawText);
  return { rawText, parsed };
}

function extractStructuredData(text: string): ParsedResume {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const phoneMatch = text.match(/(\+?1?\s*[\-(]?\d{3}[\s\-.)]*\d{3}[\s\-.]*\d{4})/);
  const linkedinMatch = text.match(/linkedin\.com\/in\/[\w-]+/i);

  const email = emailMatch?.[0] ?? "unknown@example.com";
  const phone = phoneMatch?.[0] ?? null;
  const linkedinUrl = linkedinMatch ? `https://${linkedinMatch[0]}` : null;

  // Attempt to find name from first non-empty line
  const name = lines[0] ?? "Candidate";

  // Extract skills section
  const skills: string[] = [];
  const skillKeywords = ["python", "sql", "r", "tableau", "power bi", "excel", "spark", "hadoop", "airflow",
    "dbt", "looker", "snowflake", "redshift", "bigquery", "aws", "gcp", "azure", "tensorflow",
    "scikit-learn", "pandas", "numpy", "matplotlib", "seaborn", "machine learning", "statistics",
    "javascript", "typescript", "react", "node", "java", "scala", "go", "rust"];

  const lowerText = text.toLowerCase();
  for (const skill of skillKeywords) {
    if (lowerText.includes(skill)) {
      skills.push(skill.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "));
    }
  }

  // Extract experience blocks (heuristic)
  const experience: WorkExperience[] = [];
  const expSection = extractSection(text, ["experience", "work history", "employment"]);
  if (expSection) {
    const expBlocks = parseExperienceBlocks(expSection);
    experience.push(...expBlocks);
  }

  // Extract education blocks
  const education: Education[] = [];
  const eduSection = extractSection(text, ["education", "academic"]);
  if (eduSection) {
    const eduBlocks = parseEducationBlocks(eduSection);
    education.push(...eduBlocks);
  }

  // Extract projects/certifications
  const projects: string[] = [];
  const projSection = extractSection(text, ["projects", "certifications", "publications"]);
  if (projSection) {
    const projLines = projSection.split("\n").filter((l) => l.trim().length > 10).slice(0, 5);
    projects.push(...projLines.map((l) => l.trim()));
  }

  // Summary
  const summarySection = extractSection(text, ["summary", "objective", "profile", "about"]);
  const summary = summarySection?.split("\n").filter((l) => l.trim().length > 20)[0] ?? null;

  return { name, email, phone, linkedinUrl, summary, experience, education, skills, projects };
}

function extractSection(text: string, keywords: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lowerText.indexOf(kw);
    if (idx === -1) continue;
    // Find next section heading
    const afterSection = text.slice(idx + kw.length);
    const sectionEnd = afterSection.search(/\n[A-Z][A-Z\s]{3,}\n/);
    return sectionEnd !== -1 ? afterSection.slice(0, sectionEnd) : afterSection.slice(0, 2000);
  }
  return null;
}

function parseExperienceBlocks(section: string): WorkExperience[] {
  const blocks: WorkExperience[] = [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);

  let current: WorkExperience | null = null;
  for (const line of lines) {
    // Date pattern signals a new experience block
    const datePattern = /(\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    const titlePattern = /^(senior|junior|lead|principal|staff|head|director|manager|analyst|scientist|engineer|consultant|associate)/i;

    if (datePattern.test(line) && line.length < 80) {
      if (current) blocks.push(current);
      current = {
        title: lines[lines.indexOf(line) - 1] ?? "Role",
        company: "Company",
        dates: line,
        bullets: [],
      };
    } else if (current && line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
      current?.bullets.push(line.replace(/^[•\-*]\s*/, ""));
    } else if (titlePattern.test(line) && line.length < 100) {
      if (current) blocks.push(current);
      current = { title: line, company: "Company", dates: "", bullets: [] };
    }
  }
  if (current) blocks.push(current);
  return blocks.slice(0, 6);
}

function parseEducationBlocks(section: string): Education[] {
  const blocks: Education[] = [];
  const lines = section.split("\n").map((l) => l.trim()).filter(Boolean);

  // Match actual degree names with word boundaries to avoid false positives
  // (e.g. "ma" matching "Machine", "ms" matching "maps", "ba" matching "Basics")
  const degreeKeywords = /\b(bachelor|master|phd|doctorate|mba|b\.s\.?|m\.s\.?|b\.a\.?|m\.a\.?|b\.eng|m\.eng|b\.tech|m\.tech|associate)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (degreeKeywords.test(line)) {
      const yearMatch = line.match(/\b(19|20)\d{2}\b/);
      // Institution is the preceding line (university name comes before degree line in most resumes)
      const institution = lines[i - 1] ?? lines[i + 1] ?? "Institution";
      blocks.push({
        degree: line,
        institution,
        year: yearMatch?.[0] ?? null,
      });
    }
  }
  return blocks.slice(0, 4);
}
