import { describe, it, expect } from "vitest";
import { describeNoteDraft } from "../index";
import { MAX_NOTE_LENGTH } from "~/lib/notes";

describe("describeNoteDraft", () => {
  it("cannot save an empty box when there is no Note yet", () => {
    const draft = describeNoteDraft("", null);
    expect(draft).toMatchObject({
      empty: true,
      unsaved: false,
      canSave: false,
    });
  });

  it("can save new text when there is no Note yet", () => {
    const draft = describeNoteDraft("Position beats length", null);
    expect(draft).toMatchObject({
      length: 21,
      unsaved: true,
      canSave: true,
    });
  });

  it("has nothing to save when the text matches the saved Note", () => {
    const draft = describeNoteDraft("Same words", "Same words");
    expect(draft).toMatchObject({ unsaved: false, canSave: false });
  });

  it("ignores surrounding whitespace, as the server trims before storing", () => {
    const draft = describeNoteDraft("  Same words \n", "Same words");
    expect(draft).toMatchObject({ length: 10, unsaved: false, canSave: false });
  });

  it("cannot save a box cleared to whitespace over an existing Note", () => {
    const draft = describeNoteDraft("   ", "Something");
    expect(draft).toMatchObject({ empty: true, unsaved: true, canSave: false });
  });

  it("allows exactly the limit and refuses one character over", () => {
    const atLimit = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH), null);
    expect(atLimit).toMatchObject({
      length: MAX_NOTE_LENGTH,
      limit: MAX_NOTE_LENGTH,
      tooLong: false,
      canSave: true,
    });

    const overLimit = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH + 1), null);
    expect(overLimit).toMatchObject({ tooLong: true, canSave: false });
  });
});
