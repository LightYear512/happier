# Interactive Simulator Session

> Status: draft Happier plan, 2026-05-26.
>
> This plan covers the product path where an AI agent starts a real iOS or
> Android simulator and a user remotely previews and operates that simulator
> through Happier. It complements, but does not replace, the dev preview relay
> plan in [dev-preview-in-app.md](./dev-preview-in-app.md).

## Decision Summary

- The user-facing feature is an interactive simulator session, not a video-only
  preview and not a remote simulator replacement.
- A real Android Emulator or iOS Simulator runs on the session machine. Happier
  relays the screen stream down to the user and input events back to the
  simulator host.
- User control, AI control, and system lifecycle operations are mutually
  exclusive. Every input event must be authorized by a control lease.
- Control leases are enforced by the simulator session agent, not only by UI
  disabled states. Stale clients, parallel browser tabs, and AI runners all go
  through the same lease validator.
- Browser clicks are sent as normalized input coordinates. The simulator agent
  owns conversion to platform-specific device coordinates using explicit screen
  geometry metadata.
- The v1 UI should open inside the existing session details pane as a Simulator
  tab. A larger full-screen workspace can be added later without changing the
  session protocol.
- Native app connectivity remains a separate native dev session manifest:
  interactive simulator sessions control the device, while native dev manifests
  tell the app how to reach Metro, API, HMR, logs, and control targets.
- Android should ship first with an `adb` screenshot/input bridge. The production
  quality Android path can later use scrcpy or WebRTC for lower latency.
- iOS requires a macOS runner. Product input should go through XCTest,
  WebDriverAgent, or Appium-style pointer actions rather than fragile macOS
  window-coordinate automation.

## Problem

When AI finishes a feature, the user often needs more than an automated e2e
result. They may ask to start an iOS or Android simulator and manually try the
product before accepting the work. A video stream alone is insufficient because
the user must be able to tap, type, swipe, reload, rotate, and inspect the app.

The feature must support two related workflows:

- AI e2e mode: AI controls a real simulator while the user watches progress,
  steps, logs, and artifacts.
- User preview mode: AI prepares the simulator environment, then gives control
  to the user for manual product validation through Happier.

## Goals

- Start and manage a real Android Emulator or iOS Simulator on the session
  machine.
- Install and launch the target app or development client.
- Stream the simulator screen to the Happier UI.
- Relay user input from the UI back to the simulator host.
- Support tap, swipe, text input, key events, app reload, rotation, and session
  termination in the first complete product loop.
- Keep AI, user, and system control paths deterministic through a lease-based
  owner model.
- Record screenshots, optional video, input timeline, and diagnostic logs for
  review.
- Compose with native dev manifests when the app needs Metro, API, HMR, logs, or
  workspace services.

## Non-goals

- Replacing iOS Simulator, Android Emulator, Xcode, Android Studio, or native
  build infrastructure.
- Running iOS simulators without a macOS host.
- Native-code hot reload. Native changes still require a new build or install.
- Performance benchmarking. Relay latency and development bundles make this a
  preview and validation surface, not a benchmark environment.
- Public unauthenticated device sharing.
- Letting AI and the user control the same simulator at the same time.

## Industry Baseline

The `plan-review` skill's benchmark registry does not currently include mobile
simulator relay or remote mobile control systems, so this plan carries the
relevant references locally.

| System | Concrete mechanism | Happier design consequence |
| --- | --- | --- |
| scrcpy | Android screen mirroring and control over ADB or TCP/IP, with keyboard and mouse input. | Android should not invent a long-term control stack from scratch. An `adb` bridge is acceptable for MVP, while scrcpy/WebRTC is the quality target for low-latency interactive control. |
| Android Debug Bridge | `adb shell input` can inject tap, swipe, text, and key events; `adb exec-out screencap` can capture screenshots. | Android MVP can be built with platform tools already present in most emulator environments. |
| WebDriverAgent / XCTest / Appium | iOS automation drivers expose pointer and keyboard actions against simulator apps. | iOS input should be sent through automation drivers with simulator semantics, not through macOS window coordinates. |
| noVNC / websockify | Browser client relays a remote screen and input over WebSocket to a host-side control service. | Happier should model screen-down and input-up channels explicitly and keep relay transport separate from platform input injection. |
| Expo Dev Client / React Native Metro | The app runtime loads bundles and HMR from a development server. | Device control is separate from app development connectivity; native dev manifests remain the source of truth for Metro and API targets. |

## Session Model

Interactive simulator sessions, native dev sessions, and e2e run sessions are
separate contracts that may be created together.

```text
Interactive Simulator Session
  Owns screen stream, input bridge, control lease, lifecycle, artifacts.

Native Dev Session Manifest
  Owns Metro, API, HMR, logs, and app-internal development connectivity.

E2E Run Session
  Owns AI test steps, assertions, runner state, and e2e artifacts.
```

The user sees one entry point:

```text
Start Interactive Preview
```

Internally, Happier may create all required sessions:

```text
Happier UI
  | screen frames, status, logs
  | input events, control commands
  v
Relay
  v
Simulator Session Agent
  +-- screen capture
  +-- input injection
  +-- control lease manager
  +-- app lifecycle manager
  +-- artifact recorder
  v
Android Emulator / iOS Simulator
  v
Native App
  v
Native Dev Manifest targets: Metro / API / HMR / logs
```

## Protocol Draft

```ts
type SimulatorPlatform = "android" | "ios";

type SimulatorSessionMode =
  | "idle"
  | "ai_control"
  | "user_control"
  | "system_locked"
  | "ended";

type ControlOwner = "ai" | "user" | "system";

type ControlLease = {
  id: string;
  owner: ControlOwner;
  holderId: string;
  sessionId: string;
  acquiredAt: string;
  expiresAt: string;
  reason:
    | "e2e"
    | "manual-preview"
    | "install"
    | "restart"
    | "reload"
    | "rotate"
    | "debug";
  generation: number;
};

type ScreenGeometry = {
  deviceWidth: number;
  deviceHeight: number;
  orientation: "portrait" | "landscape";
  pixelRatio: number;
  contentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  inputCoordinateSpace: "devicePixels";
};

type InteractiveSimulatorSession = {
  schemaVersion: 1;
  sessionId: string;
  platform: SimulatorPlatform;
  deviceName: string;
  appId: string;
  mode: SimulatorSessionMode;
  generation: number;
  controlLease?: ControlLease;
  screen: {
    streamUrl: string;
    geometry: ScreenGeometry;
  };
  input: {
    supportsTap: boolean;
    supportsSwipe: boolean;
    supportsText: boolean;
    supportsKeyEvents: boolean;
    supportsRotation: boolean;
    supportsClipboard: boolean;
  };
  nativeDevSessionId?: string;
  e2eRunSessionId?: string;
  expiresAt: string;
};
```

Input events use normalized coordinates. The UI must not send platform device
pixels directly. The authenticated input connection supplies the holder identity;
clients do not choose a `holderId` inside each input payload.

```ts
type NormalizedPoint = {
  x: number; // 0..1 across the visible device content rect
  y: number; // 0..1 across the visible device content rect
};

type SimulatorInputEvent =
  | {
      type: "tap";
      point: NormalizedPoint;
      leaseId: string;
      generation: number;
    }
  | {
      type: "swipe";
      from: NormalizedPoint;
      to: NormalizedPoint;
      durationMs: number;
      leaseId: string;
      generation: number;
    }
  | {
      type: "text";
      value: string;
      leaseId: string;
      generation: number;
    }
  | {
      type: "key";
      key: "back" | "home" | "enter";
      leaseId: string;
      generation: number;
    }
  | {
      type: "rotate";
      orientation: "portrait" | "landscape";
      leaseId: string;
      generation: number;
    }
  | {
      type: "reloadApp";
      leaseId: string;
      generation: number;
    };
```

Rules:

- The agent rejects input events without a valid active lease.
- The agent rejects input events when the authenticated connection identity does
  not match the active lease holder.
- The agent rejects input events when the event generation does not match the
  current session generation.
- The agent increments generation after simulator restart, app reinstall, app
  data reset, or any lifecycle operation that invalidates the current screen and
  input state.
- The agent rejects user input while `mode` is `ai_control` or `system_locked`.
- System operations such as install, reset, restart, reload, and rotation acquire
  a system lease before mutating simulator or app state.
- The relay never derives simulator authority from a visible stream URL.
- Every accepted input event is appended to the session timeline.

The lease validator checks all of these fields before injecting input:

```text
lease id
session id
holder id
owner
generation
expiration
current session mode
```

UI disabled states are only a convenience. The simulator session agent is the
authority that accepts or rejects input.

Read-only actions such as opening logs, viewing artifacts, or taking a snapshot
of the already-streamed frame do not require a control lease. Any command that
changes simulator or app state does require a lease.

## Control State Machine

```text
Idle
  -> System_Locked: create simulator, install app, reset state
  -> AI_Control: start e2e run
  -> User_Control: user starts manual preview

AI_Control
  -> User_Control: user pauses AI and takes control
  -> System_Locked: runner requests restart or reinstall
  -> Ended

User_Control
  -> AI_Control: user returns control to AI
  -> System_Locked: user requests reload/reinstall/reset
  -> Ended

System_Locked
  -> Idle
  -> AI_Control
  -> User_Control
  -> Ended
```

The UI should make ownership explicit:

```text
Mode          AI Running
Owner         AI

[Pause AI & Take Control]
```

```text
Mode          Manual Control
Owner         You

[Return Control to AI]
[End Session]
```

Control handoff must happen at action boundaries. A user request to pause AI and
take control follows this sequence:

```text
1. UI requests user control for manual preview.
2. The session agent asks the AI/e2e runner to pause at the next safe point.
3. A safe point is the end of a discrete user or runner action: tap, swipe, text
   entry, assertion wait, or completed reload. Install, restart, reset, and
   in-progress reload are system-locked and cannot be interrupted.
4. The agent revokes the AI lease and issues a user lease.
5. The UI enables input only after receiving the user lease.
```

If the runner cannot pause safely within the configured timeout, the UI shows a
recoverable state:

```text
Could not pause AI safely.

[Try Again]
[Force Stop Run]
```

Returning control to AI revokes the user lease and records a timeline marker. A
strict e2e runner should restart from a checkpoint or rerun rather than blindly
continuing from a state that the user may have changed.

## Android Implementation Path

### MVP

Use Android platform tooling:

- Start emulator through the existing runner environment.
- Install and launch the app.
- Stream screen frames through `adb exec-out screencap` or an equivalent bounded
  screenshot loop.
- Inject input with `adb shell input tap`, `swipe`, `text`, and `keyevent`.
- Persist the latest screenshot and timeline for failures and final review.

This path is enough to validate product value:

- User can see the app.
- User can tap, swipe, and type.
- AI can pause and grant control.
- Artifacts are available after the session.

### Production Quality

Upgrade the screen and input transport:

- Use scrcpy or a WebRTC pipeline for lower latency and smoother frame delivery.
- Keep the same Happier session protocol so the UI and control lease model do not
  change.
- Add clipboard, multi-touch gestures, audio only if a concrete workflow needs
  them.

## iOS Implementation Path

iOS requires a macOS host.

### MVP

- Boot an iOS Simulator on a macOS runner.
- Install and launch the app or development client.
- Capture screen frames with simulator screenshot or host capture APIs.
- Inject input through XCTest, WebDriverAgent, or Appium-style pointer actions.
- Avoid product dependence on macOS window coordinates, Simulator window focus,
  or AppleScript-style screen clicks.

### Production Quality

- Replace screenshot polling with a lower-latency screen capture and WebRTC
  stream.
- Expand keyboard, paste, rotation, and gesture support through the same
  automation driver boundary.
- Keep platform-specific logic inside the simulator agent provider for iOS.

## Native Dev Manifest Composition

Interactive simulator sessions do not solve app connectivity by themselves. If
the app needs Metro, API, HMR, logs, or workspace-local services, the simulator
session should attach a native dev session manifest.

```text
Interactive Simulator Session
  Controls the device and streams the screen.

Native Dev Session Manifest
  Configures the app's development service endpoints.
```

Example sequence:

```text
1. User asks: "Start an iOS simulator. I want to test it myself."
2. Happier starts or selects a macOS simulator host.
3. Happier creates a native dev session manifest if the app needs Metro/API/HMR.
4. Happier installs and launches the app.
5. Happier opens the details pane Simulator tab.
6. The control lease is granted to the user.
7. User taps, types, and swipes through the relay.
8. Session records artifacts and input timeline.
```

## UI Contract

The user should not see separate low-level relay resources first. The v1 surface
is a Simulator tab in the existing session details pane, opened from a structured
message or resource card. This keeps the native simulator preview aligned with
the web relay preview without requiring a new top-level workspace.

```text
Details
  Files
  Preview
  Terminal
  Logs
  Simulator
```

The Simulator tab contains the live surface, compact state, and basic controls:

```text
Simulator

Device        iPhone 15 Simulator
App           Happier
Mode          Manual Control
Owner         You
Path          Relay

[ live simulator surface ]

Metro         Connected
API           Healthy
HMR           Ready
Recorder      On

[Reload] [Home] [Rotate] [Keyboard] [End Session]
```

The tab can offer an `Open Full Screen` affordance later, but the first usable
version should fit inside the details pane.

When AI is running e2e:

```text
Interactive Preview

Mode          AI Running
Owner         AI
Current Step  Tap "Create Session"

[ live simulator surface ]

[Pause AI & Take Control]
[Open Logs]
[Stop Run]
```

Failure states must be actionable:

```text
Simulator input rejected
The user control lease expired.

[Request Control]
[View Details]
```

```text
iOS simulator unavailable
This session is not running on a macOS host.

[Switch Host]
[Use Android]
[View Requirements]
```

## Security Requirements

- Interactive control requires explicit user authorization.
- Input channel tokens are separate from screen stream URLs.
- Control leases are short-lived and scoped to one session, holder, and owner.
- Control leases include session generation so restart, reinstall, and reset
  invalidate stale input from old browser tabs or delayed network packets.
- Session end revokes stream and input tokens.
- All accepted input events are written to an audit timeline.
- Logs and artifacts follow the same redaction rules as other session outputs.
- Public unauthenticated access is out of scope.
- The simulator environment should be disposable for CI and remote runner use.

## Test And Validation Matrix

Implementation must follow RED-GREEN-REFACTOR for behavior-changing work. The
plan itself is documentation only; these are the required implementation tests.

### Unit Tests

- Control lease acquisition, renewal, expiration, and rejection.
- User input rejected during `ai_control` and `system_locked`.
- AI input rejected during `user_control`.
- Normalized coordinate mapping with portrait, landscape, letterbox, and high-DPI
  geometry.
- Input event schema rejects missing or stale lease ids.
- Session end revokes stream and input authority.

### Android Integration Tests

- Start emulator, install app, launch app.
- Stream at least one frame and expose screen geometry.
- Relay tap, swipe, text, and back key events.
- Record input timeline and final screenshot.
- Reject input after lease expiry.

### iOS Integration Tests

- Boot simulator on macOS runner, install app, launch app.
- Stream at least one frame and expose screen geometry.
- Relay tap and text input through the selected automation driver.
- Reject product configuration that attempts window-coordinate automation as the
  primary input path.

### E2E Product Tests

- AI runs a test while the user watches.
- User pauses AI, takes control, interacts, and returns control.
- User starts manual preview directly after build completion.
- Session handles simulator restart without accepting stale input leases.
- Final artifacts include screenshot, optional recording, logs, and input
  timeline.

## Phased Delivery

### Phase 1: Android Interactive MVP

- Android emulator lifecycle.
- Screenshot or MJPEG/WebSocket screen stream.
- `adb shell input` bridge for tap, swipe, text, and key events.
- Control lease manager.
- Basic UI preview panel with owner state and core controls.
- Artifact capture for latest screenshot and input timeline.

### Phase 2: Native Dev Session Composition

- Attach Metro/API/HMR manifest to the simulator session when needed.
- Show Metro, API, and HMR target health in the interactive preview panel.
- Reload app and reconnect development services from the same UI.

### Phase 3: iOS Simulator MVP

- macOS runner support.
- iOS Simulator lifecycle.
- Screenshot stream or host capture.
- XCTest/WebDriverAgent/Appium input bridge.
- Same UI and control lease protocol as Android.

### Phase 4: Low-Latency And Collaboration

- Android scrcpy or WebRTC streaming.
- iOS lower-latency capture.
- Clipboard and richer gesture support.
- User feedback capture tied to screenshots and timeline positions.

## Open Decisions

- Which Android low-latency transport to standardize on after MVP: scrcpy
  integration, a custom WebRTC bridge, or both.
- Which iOS automation driver should be the canonical product dependency:
  WebDriverAgent, Appium, or a project-owned XCTest harness.
- Whether manual user sessions should run development builds with HMR by default
  or fixed e2e builds by default. The likely product split is development
  preview with HMR and acceptance e2e with fixed builds.

## Exit Criteria

- A user can ask Happier to start an Android emulator and manually operate the
  app through the relay.
- A user can see whether AI, user, or system currently owns control.
- AI and user input cannot race because every input path is lease-gated.
- The simulator screen and input coordinate mapping remain correct after
  rotation and resize.
- The app can optionally connect to current workspace Metro/API/HMR targets via a
  native dev manifest.
- The session produces review artifacts sufficient for product acceptance:
  screenshot, optional video, logs, and input timeline.
