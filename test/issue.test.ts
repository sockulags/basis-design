import assert from "node:assert/strict";
import { test } from "node:test";
import { issueKey, issueViewId } from "../shared/issue.ts";
import { viewInstruction } from "../server/brief.ts";

test("a view for an issue takes the key as its id, in kebab-case", () => {
  assert.equal(issueKey(" WEB-12 "), "WEB-12");
  assert.equal(issueViewId("WEB-12"), "web-12");
  assert.equal(issueKey("sockulags/portvakt#42"), "sockulags/portvakt#42");
  assert.equal(issueViewId("sockulags/portvakt#42"), "sockulags-portvakt-42");
  for (const bad of ["", "#42", "WEB 12", "../x", "WEB-12/", "a".repeat(65), "WEB-12; rm"]) {
    assert.equal(issueKey(bad), null, bad);
  }
});

test("the New view turn names the view for its issue", () => {
  const plain = viewInstruction("views", "SignIn", "");
  assert.doesNotMatch(plain, /issue/);
  const named = viewInstruction("views", "SignIn", "The sign-in page", "WEB-12");
  assert.match(named, /for the issue WEB-12/);
  assert.match(named, /`id: "web-12"`/);
  assert.match(named, /title that starts with the key \("WEB-12 "/);
});
