/** Public login-change metadata only; never include credentials in this event. */
export interface AuthChangedEvent {
  loggedIn: boolean
  reason: 'email-code' | 'password' | 'oauth' | 'refresh' | 'logout'
}
