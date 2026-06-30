import ExpoModulesCore
import CoreLocation

// MARK: - Module
//
// Wraps the iOS 17+ Core Location modern API:
//   - CLBackgroundActivitySession keeps background-location authority alive
//     while we hold the reference. It MUST be started from the foreground.
//   - CLLocationUpdate.liveUpdates() is an AsyncSequence of LocationUpdate
//     values that auto-resumes when movement returns after a stationary
//     pause — the documented advantage over the legacy CLLocationManager
//     path that expo-location currently uses.
//   - The system can relaunch the app after termination if a session was
//     active. That's the behaviour our existing four-paths setup can't get.
//
// We emit `onLocationUpdate`, `onStateChange`, and `onError` events. The JS
// side hooks these into the same provenance pipeline as the existing
// expo-location task so source/fix_age_ms/app_state instrumentation keeps
// working with `source: 'modern_bg'`.

public class ModernLocationModule: Module {

    // Held strong for the lifetime of the active session. Type-erased to
    // satisfy the iOS 15 deployment target — only used inside #available
    // blocks below.
    private var sessionStorage: Any?
    private var updateTask: Task<Void, Never>?

    public func definition() -> ModuleDefinition {
        Name("ModernLocation")

        Events("onLocationUpdate", "onStateChange", "onError")

        // Returns true if the modern API is available on this device.
        Function("isAvailable") { () -> Bool in
            if #available(iOS 17.0, *) { return true }
            return false
        }

        // Start the background activity session and begin the live updates
        // stream. Must be called from the foreground (Core Location enforces
        // this; calling from background throws under the hood). Idempotent —
        // calling twice returns started=false on the second call.
        AsyncFunction("startBackgroundSession") { () -> [String: Any] in
            if #available(iOS 17.0, *) {
                return self.start()
            } else {
                throw Exception(name: "ModernLocationUnsupported",
                                description: "CLLocationUpdate.liveUpdates requires iOS 17.0 or newer")
            }
        }

        // Stop the session and cancel the live updates task. Safe to call
        // even if not running.
        AsyncFunction("stopBackgroundSession") { () -> Void in
            self.stop()
        }
    }

    @available(iOS 17.0, *)
    private func start() -> [String: Any] {
        if sessionStorage != nil {
            return ["started": false, "reason": "already_started"]
        }

        // Start the session FIRST so background authority is granted before
        // the stream begins. The session keeps authority for as long as we
        // hold it; invalidate() releases it.
        let session = CLBackgroundActivitySession()
        sessionStorage = session

        // Live updates stream. Uses Task so it survives across actor hops
        // and the cancellation handle gives us clean teardown.
        updateTask = Task { [weak self] in
            guard let self = self else { return }
            do {
                let updates = CLLocationUpdate.liveUpdates()
                for try await update in updates {
                    if Task.isCancelled { break }

                    // Update.isStationary signals iOS thinks the device is
                    // stationary. The audit noted: on the modern API this
                    // is informational, not a "we suspend you until you
                    // foreground again" event. We surface it as a state
                    // change so the JS side can log it but do nothing else.
                    self.sendEvent("onStateChange", [
                        "state": update.isStationary ? "stationary" : "active"
                    ])

                    if let location = update.location {
                        self.sendEvent("onLocationUpdate", [
                            "latitude": location.coordinate.latitude,
                            "longitude": location.coordinate.longitude,
                            // Match JS Date.now() units: ms since epoch.
                            "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
                            "horizontalAccuracy": location.horizontalAccuracy,
                            "verticalAccuracy": location.verticalAccuracy,
                            "speed": location.speed,
                            "course": location.course,
                            "altitude": location.altitude,
                            "isStationary": update.isStationary
                        ])
                    }

                    // The authorizationDenied / authorizationDeniedGlobally
                    // / authorizationRestricted properties on LocationUpdate
                    // were added in iOS 18. We can't read them at iOS 17.
                    // If authorization is revoked mid-stream the stream just
                    // stops delivering updates, which is fine — JS observes
                    // a stale-tracking signal via its existing path-fired
                    // instrumentation and we don't need to surface it from
                    // here at iOS 17. Revisit when bumping the deployment
                    // target.
                }
            } catch {
                self.sendEvent("onError", [
                    "code": "stream_error",
                    "message": error.localizedDescription
                ])
            }
        }

        return ["started": true]
    }

    private func stop() {
        updateTask?.cancel()
        updateTask = nil
        if #available(iOS 17.0, *) {
            (sessionStorage as? CLBackgroundActivitySession)?.invalidate()
        }
        sessionStorage = nil
    }

    deinit {
        // Belt-and-suspenders. If the JS side forgets to call stop, we still
        // invalidate the session when the module is torn down (e.g. app
        // termination, hot reload) so we don't leak the blue bar.
        stop()
    }
}
