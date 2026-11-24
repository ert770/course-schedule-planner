// This affects only the local interface; all backend identity and consent checks remain in force.
export function canSkipControlledBrowserSetup(user, isDevelopment) {
  return isDevelopment === true && user?.controlledBrowserMock === true;
}
