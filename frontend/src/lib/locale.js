export const COUNTRIES = [
  { code: "SY", nameAr: "سوريا", nameEn: "Syria", currency: "SYP", timezones: ["Asia/Damascus"] },
  { code: "SA", nameAr: "السعودية", nameEn: "Saudi Arabia", currency: "SAR", timezones: ["Asia/Riyadh"] },
  { code: "AE", nameAr: "الإمارات", nameEn: "United Arab Emirates", currency: "AED", timezones: ["Asia/Dubai"] },
  { code: "EG", nameAr: "مصر", nameEn: "Egypt", currency: "EGP", timezones: ["Africa/Cairo"] },
  { code: "JO", nameAr: "الأردن", nameEn: "Jordan", currency: "JOD", timezones: ["Asia/Amman"] },
  { code: "IQ", nameAr: "العراق", nameEn: "Iraq", currency: "IQD", timezones: ["Asia/Baghdad"] },
  { code: "LB", nameAr: "لبنان", nameEn: "Lebanon", currency: "LBP", timezones: ["Asia/Beirut"] },
  { code: "KW", nameAr: "الكويت", nameEn: "Kuwait", currency: "KWD", timezones: ["Asia/Kuwait"] },
  { code: "QA", nameAr: "قطر", nameEn: "Qatar", currency: "QAR", timezones: ["Asia/Qatar"] },
  { code: "BH", nameAr: "البحرين", nameEn: "Bahrain", currency: "BHD", timezones: ["Asia/Bahrain"] },
  { code: "OM", nameAr: "عُمان", nameEn: "Oman", currency: "OMR", timezones: ["Asia/Muscat"] },
  { code: "YE", nameAr: "اليمن", nameEn: "Yemen", currency: "YER", timezones: ["Asia/Aden"] },
  { code: "TR", nameAr: "تركيا", nameEn: "Turkey", currency: "TRY", timezones: ["Europe/Istanbul"] },
  { code: "US", nameAr: "الولايات المتحدة", nameEn: "United States", currency: "USD", timezones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"] },
  { code: "GB", nameAr: "المملكة المتحدة", nameEn: "United Kingdom", currency: "GBP", timezones: ["Europe/London"] },
  { code: "XX", nameAr: "دولي / أخرى", nameEn: "International / Other", currency: "USD", timezones: [] },
];

export const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "SAR", "AED", "EGP", "SYP", "JOD", "IQD", "LBP", "KWD", "QAR", "BHD", "OMR", "YER", "TRY"];

export const CURRENCY_LABELS = {
  en: Object.fromEntries(CURRENCY_OPTIONS.map((c) => [c, c])),
  ar: {
    USD: "دولار أمريكي", EUR: "يورو", GBP: "جنيه إسترليني", SAR: "ريال سعودي", AED: "درهم إماراتي",
    EGP: "جنيه مصري", SYP: "ليرة سورية", JOD: "دينار أردني", IQD: "دينار عراقي", LBP: "ليرة لبنانية",
    KWD: "دينار كويتي", QAR: "ريال قطري", BHD: "دينار بحريني", OMR: "ريال عماني", YER: "ريال يمني", TRY: "ليرة تركية",
  },
};

export function countryByCode(code) {
  return COUNTRIES.find((c) => c.code === code) || null;
}

export function countryName(c, lang) {
  if (!c) return "";
  return lang === "ar" ? c.nameAr : c.nameEn;
}

export function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byTz = COUNTRIES.find((c) => c.timezones.includes(tz));
    if (byTz) return byTz;
  } catch { /* ignore */ }
  try {
    const region = (navigator.language || "").split("-")[1]?.toUpperCase();
    const byLang = COUNTRIES.find((c) => c.code === region && c.code !== "XX");
    if (byLang) return byLang;
  } catch { /* ignore */ }
  return countryByCode("SY");
}

let REGIONAL_PREFS = { date_format: "dmy", number_format: "western" };

export function setRegionalPrefs(p) {
  if (!p) return;
  REGIONAL_PREFS = {
    date_format: ["dmy", "mdy", "ymd"].includes(p.date_format) ? p.date_format : REGIONAL_PREFS.date_format,
    number_format: ["western", "european", "arabic"].includes(p.number_format) ? p.number_format : REGIONAL_PREFS.number_format,
  };
}

export function getRegionalPrefs() {
  return REGIONAL_PREFS;
}

export const NUMBER_LOCALES = { western: "en-US", european: "de-DE", arabic: "ar-EG" };
