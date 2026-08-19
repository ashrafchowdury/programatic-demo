import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionKey, stateFileFor } from "./session";

describe("sessionKey", () => {
  it("separates cloud from local, which is the whole point", () => {
    // One shared file used to lose whichever host was not captured last:
    // storageState() records localStorage only for origins that run visited.
    assert.notEqual(
      sessionKey("https://eu.cloud.agenta.ai/w/x/apps"),
      sessionKey("http://localhost:3000/w/x/apps"),
    );
  });

  it("keeps the port, so two local instances do not collide", () => {
    assert.equal(sessionKey("http://localhost:3000/"), "localhost-3000");
    assert.equal(sessionKey("http://localhost:3001/"), "localhost-3001");
  });

  it("ignores path, query and scheme — a host is a host", () => {
    const a = sessionKey("https://app.example.com/one?x=1");
    assert.equal(a, sessionKey("https://app.example.com/two"));
    assert.equal(a, sessionKey("http://app.example.com/"));
    assert.equal(a, "app.example.com");
  });

  it("produces a safe filename", () => {
    for (const url of [
      "https://eu.cloud.agenta.ai/",
      "http://localhost:3000/",
      "https://[::1]:8080/",
    ]) {
      const key = sessionKey(url);
      assert.doesNotMatch(key, /[/\\:?*"<>|]/, url);
      assert.ok(key.length > 0, url);
    }
  });

  it("puts each host's snapshot in its own file under .sessions", () => {
    const cloud = stateFileFor("https://eu.cloud.agenta.ai/");
    const local = stateFileFor("http://localhost:3000/");
    assert.notEqual(cloud, local);
    assert.match(cloud, /\.sessions\/eu\.cloud\.agenta\.ai\.json$/);
    assert.match(local, /\.sessions\/localhost-3000\.json$/);
  });
});
