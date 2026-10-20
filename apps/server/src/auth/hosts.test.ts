import assert from "node:assert/strict";
import { test } from "node:test";
import { extraHosts, hostAllowed, hostName } from "./hosts.ts";

test("addresses, localhost and tailnet names are answered, whatever the port", () => {
	for (const host of ["127.0.0.1", "127.0.0.1:4329", "192.168.1.20:80", "100.101.102.103", "[::1]", "[::1]:4329", "[fd7a:115c:a1e0::1]:443", "localhost", "localhost:4329", "decks.localhost:5173", "mac.tail1234.ts.net", "mac.tail1234.ts.net:8443", "LOCALHOST"]) {
		assert.ok(hostAllowed(host), host);
	}
});

test("any other name is refused unless it is listed, and no Host at all passes", () => {
	assert.ok(hostAllowed(undefined));
	for (const host of ["evil.example", "evil.example:4329", "127.0.0.1.evil.example", "localhost.evil.example", "ts.net.evil.example", "a b", "[nothex]"]) {
		assert.ok(!hostAllowed(host), host);
	}
	const extra = extraHosts({ DECKS_HOSTS: " decks.home.arpa, *.lan ,Box.Example." });
	assert.deepEqual(extra, ["decks.home.arpa", "*.lan", "box.example"]);
	assert.ok(hostAllowed("decks.home.arpa:4329", extra));
	assert.ok(hostAllowed("printer.lan", extra));
	assert.ok(hostAllowed("box.example", extra));
	assert.ok(!hostAllowed("lan", extra));
	assert.ok(!hostAllowed("other.home.arpa", extra));
});

test("the bind host counts when it is a name, not when it is an address", () => {
	assert.deepEqual(extraHosts({}, "0.0.0.0"), []);
	assert.deepEqual(extraHosts({}, "::"), []);
	assert.deepEqual(extraHosts({}, "mybox"), ["mybox"]);
	assert.ok(hostAllowed("mybox:4329", extraHosts({}, "mybox")));
});

test("a Host is read without its port or brackets", () => {
	assert.equal(hostName("Example.com:80"), "example.com");
	assert.equal(hostName("example.com."), "example.com");
	assert.equal(hostName("[::1]:4329"), "::1");
	assert.equal(hostName("x/y"), undefined);
});
