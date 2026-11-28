/**
 * Utilities for normalizing employee joining dates and checking whether
 * a given YYYY-MM-DD calendar date precedes an employee's joining date.
 */

const formatLocalYYYYMMDD = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isValidCalendarParts = (yearStr, monthStr, dayStr) => {
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
};

/**
 * Normalizes a date string or Date instance to "YYYY-MM-DD".
 * Preserves date-only strings and UTC-midnight ISO strings without timezone shift.
 */
export const normalizeJoiningDateStr = (rawDate) => {
  if (!rawDate) return null;

  if (rawDate instanceof Date) {
    return formatLocalYYYYMMDD(rawDate);
  }

  if (typeof rawDate !== "string") return null;
  const trimmed = rawDate.trim();
  if (!trimmed) return null;

  // Date-only ("2026-11-26") or UTC-midnight ISO ("2026-11-26T00:00:00.000Z")
  const isoDateMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.0+)?Z?$)/i
  );
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return isValidCalendarParts(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return isValidCalendarParts(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  const parsed = new Date(trimmed);
  return formatLocalYYYYMMDD(parsed);
};

/**
 * Extracts the active joining date ("YYYY-MM-DD") from an employee or support-admin record.
 * Prioritizes explicit joining date fields over account createdAt.
 */
export const getEmployeeJoiningDateStr = (employee) => {
  if (!employee || typeof employee !== "object") return null;

  let currentExpJoiningDate = null;
  if (Array.isArray(employee.experienceDetails) && employee.experienceDetails.length > 0) {
    for (let i = employee.experienceDetails.length - 1; i >= 0; i--) {
      const exp = employee.experienceDetails[i];
      if (!exp) continue;
      const lastWorking = typeof exp.lastWorkingDate === "string"
        ? exp.lastWorkingDate.trim().toLowerCase()
        : exp.lastWorkingDate;
      if ((lastWorking === "present" || !lastWorking) && exp.joiningDate) {
        currentExpJoiningDate = exp.joiningDate;
        break;
      }
    }
  }

  const candidates = [
    currentExpJoiningDate,
    employee.joiningDate,
    employee.joining_date,
    employee.createdAt,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeJoiningDateStr(candidate);
    if (normalized) return normalized;
  }

  return null;
};

/**
 * Returns true when dateStr ("YYYY-MM-DD") is strictly earlier than joiningDateStr ("YYYY-MM-DD").
 */
export const isDateBeforeJoining = (dateStr, joiningDateStr) => {
  if (!dateStr || !joiningDateStr) return false;
  return dateStr < joiningDateStr;
};

/**
 * Returns true only when a day has a punch-in and is not classified as Absent
 * (e.g. Full Day, Half Day, or Working..). Prevents < halfDayHours days from
 * being counted as both Present and Absent.
 */
export const isCountedAsPresent = (punchIn, workedStatus, apiStatus) => {
  if (!punchIn) return false;
  const statusUpper = typeof apiStatus === "string" ? apiStatus.toUpperCase() : "";
  if (statusUpper === "ABSENT") return false;
  if (typeof workedStatus === "string" && workedStatus.includes("Absent")) return false;
  return true;
};
