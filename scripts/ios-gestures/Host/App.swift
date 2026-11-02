import SwiftUI

/// Only a host for the UI test, which drives Mobile Safari: nothing of its own is tested.
@main
struct GestureHost: App {
	var body: some Scene { WindowGroup { Text("Gesture host") } }
}
