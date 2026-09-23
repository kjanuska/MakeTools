// Validation rules for profile files. Edit these to change what the app accepts.
// Every field also can't contain , " or line breaks, or start/end with a space
// (see engine.ts). Any error blocks saving.
import type { ProfileField } from "../formats/profiles";
import type { Rules } from "./engine";

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

export const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

/** Two-digit years from this year to +10 (e.g. 26..36 in 2026). */
export function ccYearOptions(now: Date = new Date()): string[] {
  const start = now.getFullYear() % 100;
  return Array.from({ length: 11 }, (_, i) => String((start + i) % 100).padStart(2, "0"));
}

const DIGITS = /^\d+$/;

export const PROFILE_RULES: Rules<ProfileField> = {
  profileName: { required: true, unique: true, reserved: ["ALL"] },
  firstName:   { required: true },
  lastName:    { required: true },
  email:       { required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: "isn't a valid email" },
  address1:    { required: true },
  address2:    {},
  city:        { required: true },
  state:       { required: true, options: US_STATES, mustBeOption: true },
  zipcode:     { required: true, pattern: /^\d{5}$/, patternMessage: "must be exactly 5 digits" },
  country:     { required: true, options: ["US"], mustBeOption: true },
  phoneNumber: { required: true, pattern: /^\d{10}$/, patternMessage: "must be exactly 10 digits" },
  ccNumber:    { required: true, pattern: DIGITS, patternMessage: "must be digits only" },
  ccMonth:     { required: true, options: MONTHS, mustBeOption: true },
  // Older years stay valid for existing rows; the dropdown just starts at this year.
  ccYear:      { required: true, options: () => ccYearOptions(), pattern: /^\d{2}$/, patternMessage: "must be 2 digits" },
  cvv:         { required: true, pattern: DIGITS, patternMessage: "must be digits only" },
};
