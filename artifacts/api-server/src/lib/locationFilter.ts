const US_STATES: string[] = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
  "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
];

const US_ABBREVIATIONS: string[] = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID",
  "IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS",
  "MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
  "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV",
  "WI","WY","DC",
];

const US_PHRASES = [
  "United States", "USA", "U.S.A", "U.S.", ", US", "/ US", "(US)",
  "(USA)", "America", "United States of America",
];

const NON_US_COUNTRIES = [
  "Canada", "United Kingdom", "UK", "Australia", "Germany", "France",
  "India", "Japan", "China", "Brazil", "Mexico", "Spain", "Italy",
  "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Switzerland",
  "Austria", "Belgium", "Portugal", "Poland", "Czech Republic", "Ireland",
  "Singapore", "Hong Kong", "South Korea", "New Zealand", "Argentina",
  "Colombia", "Chile", "Peru", "Israel", "UAE", "Dubai", "London",
  "Toronto", "Montreal", "Vancouver", "Sydney", "Melbourne", "Berlin",
  "Paris", "Amsterdam", "Stockholm", "Copenhagen", "Dublin", "Zurich",
  "Mumbai", "Bangalore", "Delhi", "Tokyo", "Beijing", "Shanghai",
  "São Paulo", "Buenos Aires", "Bogotá", "Warsaw", "Prague",
];

/**
 * Returns true if the location string appears to be a US-based location.
 * "Remote" is treated as US unless a non-US country is also present.
 */
export function isUsLocation(location: string | null | undefined): boolean {
  if (!location) return true; // No location specified — allow through
  const loc = location.trim();
  if (!loc) return true;

  const lower = loc.toLowerCase();

  // Check for explicit non-US country names first
  const hasNonUs = NON_US_COUNTRIES.some(
    (country) => lower.includes(country.toLowerCase())
  );

  // "Remote" — only allow if no non-US country mentioned
  if (lower.includes("remote") || lower.includes("anywhere") || lower.includes("worldwide")) {
    return !hasNonUs;
  }

  if (hasNonUs) return false;

  // Check US phrases
  for (const phrase of US_PHRASES) {
    if (loc.toLowerCase().includes(phrase.toLowerCase())) return true;
  }

  // Check US state names
  for (const state of US_STATES) {
    if (loc.includes(state)) return true;
  }

  // Check 2-letter abbreviations (e.g. ", CA" or " NY " or "(TX)")
  for (const abbr of US_ABBREVIATIONS) {
    const pattern = new RegExp(`(?:^|[\\s,.(])${abbr}(?:[\\s,.)$]|$)`, "i");
    if (pattern.test(loc)) return true;
  }

  // If the location contains a city + state-like pattern (e.g. "San Francisco, CA")
  const cityStatePattern = /^.+,\s*[A-Z]{2}$/;
  if (cityStatePattern.test(loc.trim())) return true;

  return false;
}

/**
 * Resolves a human-readable country/region label from a location string.
 */
export function resolveCountry(location: string | null | undefined): string {
  if (!location) return "unknown";
  const loc = location.trim().toLowerCase();

  if (!loc) return "unknown";

  if (
    loc.includes("remote") ||
    loc.includes("anywhere") ||
    loc.includes("worldwide")
  ) {
    const hasNonUs = NON_US_COUNTRIES.some((c) =>
      loc.includes(c.toLowerCase())
    );
    return hasNonUs ? "international" : "US (remote)";
  }

  const hasNonUs = NON_US_COUNTRIES.some((c) => loc.includes(c.toLowerCase()));
  if (hasNonUs) {
    for (const country of NON_US_COUNTRIES) {
      if (loc.includes(country.toLowerCase())) return country;
    }
    return "international";
  }

  return "US";
}

/** Returns true if the job title contains any of the user's avoid-keywords (case-insensitive). */
export function isTitleAvoided(title: string, avoidKeywords: string[]): boolean {
  if (!avoidKeywords.length) return false;
  const lower = title.toLowerCase();
  return avoidKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}
