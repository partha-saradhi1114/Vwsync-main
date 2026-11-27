import { describe, it, expect } from "vitest";
import {
  normalizeJoiningDateStr,
  getEmployeeJoiningDateStr,
  isDateBeforeJoining,
} from "../src/utils/attendanceDateUtils";

describe("attendanceDateUtils", () => {
  describe("normalizeJoiningDateStr", () => {
    it("preserves YYYY-MM-DD and UTC-midnight ISO strings without shifting dates", () => {
      expect(normalizeJoiningDateStr("2026-11-26")).toBe("2026-11-26");
      expect(normalizeJoiningDateStr("2026-11-26T00:00:00.000Z")).toBe("2026-11-26");
      expect(normalizeJoiningDateStr("2026-11-26T00:00:00Z")).toBe("2026-11-26");
    });

    it("normalizes DD/MM/YYYY and DD-MM-YYYY strings", () => {
      expect(normalizeJoiningDateStr("26/11/2026")).toBe("2026-11-26");
      expect(normalizeJoiningDateStr("26-11-2026")).toBe("2026-11-26");
    });

    it("returns null for invalid or empty inputs", () => {
      expect(normalizeJoiningDateStr("")).toBeNull();
      expect(normalizeJoiningDateStr(null)).toBeNull();
      expect(normalizeJoiningDateStr(undefined)).toBeNull();
      expect(normalizeJoiningDateStr("2026-02-30")).toBeNull();
      expect(normalizeJoiningDateStr("not-a-date")).toBeNull();
    });
  });

  describe("getEmployeeJoiningDateStr", () => {
    it("reads joiningDate from current experienceDetails (lastWorkingDate === 'Present')", () => {
      const emp = {
        createdAt: "2026-11-20T10:00:00.000Z",
        experienceDetails: [
          { company: "Prev Corp", joiningDate: "2023-01-01", lastWorkingDate: "2025-12-31" },
          { company: "Current Corp", joiningDate: "2026-11-26", lastWorkingDate: "Present" },
        ],
      };
      expect(getEmployeeJoiningDateStr(emp)).toBe("2026-11-26");
    });

    it("uses top-level joiningDate when experienceDetails has no active entry", () => {
      const emp = {
        joiningDate: "2026-11-26",
        createdAt: "2026-11-20T10:00:00.000Z",
        experienceDetails: [
          { company: "Prev Corp", joiningDate: "2023-01-01", lastWorkingDate: "2025-12-31" },
        ],
      };
      expect(getEmployeeJoiningDateStr(emp)).toBe("2026-11-26");
    });

    it("falls back to createdAt only when explicit joiningDate fields are missing", () => {
      const supportAdmin = {
        createdAt: "2026-11-26T05:00:00.000Z",
      };
      expect(getEmployeeJoiningDateStr(supportAdmin)).toBe("2026-11-26");
    });

    it("returns null for missing or invalid employee object", () => {
      expect(getEmployeeJoiningDateStr(null)).toBeNull();
      expect(getEmployeeJoiningDateStr({})).toBeNull();
    });
  });

  describe("isDateBeforeJoining", () => {
    it("excludes days before joining date and keeps joining date and later days", () => {
      const joiningDate = "2026-11-26";
      expect(isDateBeforeJoining("2026-11-01", joiningDate)).toBe(true);
      expect(isDateBeforeJoining("2026-11-25", joiningDate)).toBe(true);
      expect(isDateBeforeJoining("2026-11-26", joiningDate)).toBe(false);
      expect(isDateBeforeJoining("2026-11-27", joiningDate)).toBe(false);
    });

    it("returns false when joiningDate is null so legacy records are unaffected", () => {
      expect(isDateBeforeJoining("2026-11-01", null)).toBe(false);
    });
  });
});
