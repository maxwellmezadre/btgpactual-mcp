import { describe, expect, test } from "bun:test";
import { isProfileLocked } from "../src/browser/launch.js";

describe("launch", () => {
  test("recognises Chrome refusing a profile held by another process", () => {
    // Verbatim from Playwright when a second process opened browser-profile/.
    const held = new Error(
      "Failed to create a ProcessSingleton for your profile directory. This usually means that the profile is already in use by another instance of Chromium.",
    );
    expect(isProfileLocked(held)).toBe(true);
    expect(isProfileLocked(new Error("Executable doesn't exist at /Applications/Google Chrome.app"))).toBe(false);
    expect(isProfileLocked(undefined)).toBe(false);
  });
});
