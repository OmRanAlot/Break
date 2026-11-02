# Restricted-site reflection gate

Reflections are stored only in the app's private Room database (`reflections.db`). Android backup is disabled in the manifest and the feature has no network or synchronization path. Only the matched blocklist domain is stored; attempted URLs are never persisted.

The accessibility overlay has no cancel, back, or “return home” action and dismisses only after a valid database insert. Android does not allow an app to absolutely disable OS-level controls (for example force-stop, service disablement, or some system navigation). If a user returns to a still-restricted page while the content filter and accessibility service are active, interception runs again and reopens the gate.
