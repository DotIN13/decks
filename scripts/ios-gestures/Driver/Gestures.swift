import XCTest

/**
 * Plays a list of finger gestures on Mobile Safari, in the simulator, through the system's own touch
 * path: Safari's scrolling, its momentum and its pinch run as they do under a real finger, which a
 * desktop browser's touch emulation does not have.
 *
 * The list is JSON at $GESTURES (default /tmp/ios-gestures/script.json), points in the screen's
 * points from its top-left corner:
 *   { "do": "drag", "from": [x, y], "to": [x, y], "press": 0.05, "velocity": 800, "hold": 0 }
 *     a finger down, held `press` s, moved to `to` at `velocity` points a second, held `hold` s, lifted:
 *     a slow pan, a flick (fast, hold 0), or an item dragged (press past the hold time to pick it up).
 *   { "do": "tap", "at": [x, y] }
 *   { "do": "pinch", "scale": 2.0, "velocity": 1.0 }   two fingers on the page's middle
 *   { "do": "wait", "s": 1.0 }
 * Each step's start is written to $GESTURES_LOG (default /tmp/ios-gestures/log.txt), in seconds since
 * 1970, so a recording in the page can be lined up with it.
 */
final class Gestures: XCTestCase {
	/*
	 * XCUITest waits for the app to go idle before every gesture, and Safari is not idle while a page
	 * coasts: a flick meant to land on a moving canvas landed seconds later, on a still one. The wait
	 * is XCUIApplicationProcess's, replaced here by one that returns at once.
	 */
	override class func setUp() {
		super.setUp()
		guard let cls = NSClassFromString("XCUIApplicationProcess") else { return }
		for name in ["waitForQuiescenceIncludingAnimationsIdle:", "waitForQuiescenceIncludingAnimationsIdle:isPreEvent:"] {
			let selector = NSSelectorFromString(name)
			guard let method = class_getInstanceMethod(cls, selector) else { continue }
			let none: @convention(block) (AnyObject, Bool, Bool) -> Void = { _, _, _ in }
			method_setImplementation(method, imp_implementationWithBlock(none))
		}
	}

	func testPlay() throws {
		let env = ProcessInfo.processInfo.environment
		let path = env["GESTURES"] ?? "/tmp/ios-gestures/script.json"
		let logPath = env["GESTURES_LOG"] ?? "/tmp/ios-gestures/log.txt"
		let data = try Data(contentsOf: URL(fileURLWithPath: path))
		let steps = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
		let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
		safari.activate()
		let page = safari.webViews.firstMatch
		XCTAssert(page.waitForExistence(timeout: 10), "no page open in Safari")
		let origin = safari.coordinate(withNormalizedOffset: .zero)
		let at = { (p: Any?) -> XCUICoordinate in
			let xy = (p as? [Double]) ?? [0, 0]
			return origin.withOffset(CGVector(dx: xy[0], dy: xy[1]))
		}
		var log = ""
		for step in steps {
			let kind = step["do"] as? String ?? ""
			log += "\(Date().timeIntervalSince1970) \(kind)\n"
			switch kind {
			case "drag":
				let velocity = XCUIGestureVelocity(rawValue: CGFloat(step["velocity"] as? Double ?? 800))
				at(step["from"]).press(forDuration: step["press"] as? Double ?? 0.05, thenDragTo: at(step["to"]), withVelocity: velocity, thenHoldForDuration: step["hold"] as? Double ?? 0)
			case "tap":
				at(step["at"]).tap()
			case "pinch":
				page.pinch(withScale: CGFloat(step["scale"] as? Double ?? 2), velocity: CGFloat(step["velocity"] as? Double ?? 1))
			case "wait":
				Thread.sleep(forTimeInterval: step["s"] as? Double ?? 1)
			default:
				XCTFail("unknown step \(kind)")
			}
		}
		log += "\(Date().timeIntervalSince1970) end\n"
		try? FileManager.default.createDirectory(atPath: (logPath as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
		try log.write(toFile: logPath, atomically: true, encoding: .utf8)
	}
}
