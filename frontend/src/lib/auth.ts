const SESSION_KEY = 'lldoc_authenticated'

function getRequiredPassword() {
  return import.meta.env.VITE_APP_PASSWORD || ''
}

export function isAuthenticated() {
  const password = getRequiredPassword()
  if (!password) return true
  return sessionStorage.getItem(SESSION_KEY) === 'true'
}

export function authenticate(password: string): boolean {
  if (password === getRequiredPassword()) {
    sessionStorage.setItem(SESSION_KEY, 'true')
    return true
  }
  return false
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY)
}

export function hasPasswordProtection() {
  return !!getRequiredPassword()
}
